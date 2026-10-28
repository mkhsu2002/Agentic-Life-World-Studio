import type { StudioAttachment } from "../shared/conversation";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_REFERENCES = 6;
export type ConversationFileResult = {
  source: StudioAttachment;
  references: StudioAttachment[];
  warnings: string[];
};
function dataUrl(bytes: Uint8Array, contentType: string) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${contentType};base64,${btoa(binary)}`;
}
function encodedSize(url: string) {
  const data = url.slice(url.indexOf(",") + 1);
  return (
    Math.floor((data.length * 3) / 4) -
    (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0)
  );
}
function canvasImage(canvas: HTMLCanvasElement) {
  for (const quality of [0.9, 0.75, 0.55]) {
    const url = canvas.toDataURL("image/jpeg", quality);
    if (url.startsWith("data:image/") && encodedSize(url) <= MAX_IMAGE_BYTES)
      return url;
  }
  const smaller = document.createElement("canvas");
  try {
    smaller.width = Math.max(1, Math.round(canvas.width / 2));
    smaller.height = Math.max(1, Math.round(canvas.height / 2));
    const context = smaller.getContext("2d");
    if (!context) throw new Error("無法讀取圖片畫面。");
    context.drawImage(canvas, 0, 0, smaller.width, smaller.height);
    const url = smaller.toDataURL("image/jpeg", 0.75);
    if (!url.startsWith("data:image/") || encodedSize(url) > MAX_IMAGE_BYTES)
      throw new Error("圖片仍超過 5 MB，請另外上傳縮小後的版本。");
    return url;
  } finally {
    smaller.width = smaller.height = 0;
  }
}
async function embeddedImage(bytes: Uint8Array, contentType: string) {
  if (
    ["image/png", "image/jpeg", "image/webp"].includes(contentType) &&
    bytes.length <= MAX_IMAGE_BYTES
  )
    return dataUrl(bytes, contentType);
  if (
    ![
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
      "image/bmp",
    ].includes(contentType)
  )
    throw new Error("此內嵌圖片格式目前無法讀取。");
  const bitmap = await createImageBitmap(
    new Blob([bytes as Uint8Array<ArrayBuffer>], { type: contentType }),
  );
  const canvas = document.createElement("canvas");
  try {
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("無法讀取圖片畫面。");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvasImage(canvas);
  } finally {
    bitmap.close();
    canvas.width = canvas.height = 0;
  }
}
export async function readConversationFile(
  file: File,
): Promise<ConversationFileResult> {
  if (file.size > 25 * 1024 * 1024)
    throw new Error("單一文件最多 25 MB，較大的作品可分卷提供。");
  const references: StudioAttachment[] = [],
    warnings: string[] = [];
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (
    file.type.startsWith("image/") ||
    ["png", "jpg", "jpeg", "webp"].includes(ext || "")
  ) {
    const type =
      file.type ||
      (ext === "png"
        ? "image/png"
        : ext === "webp"
          ? "image/webp"
          : "image/jpeg");
    if (!["image/png", "image/jpeg", "image/webp"].includes(type))
      throw new Error("圖片請使用 PNG、JPEG 或 WebP。");
    if (file.size > MAX_IMAGE_BYTES)
      throw new Error("單張圖片最多 5 MB，請縮小後再上傳。");
    return {
      source: {
        name: file.name,
        kind: "image",
        dataUrl: dataUrl(new Uint8Array(await file.arrayBuffer()), type),
      },
      references,
      warnings,
    };
  }
  let text = "";
  if (ext === "docx") {
    const imported = await import("mammoth/mammoth.browser");
    const mammoth = imported.default || imported;
    const arrayBuffer = await file.arrayBuffer();
    text = (await mammoth.extractRawText({ arrayBuffer })).value;
    let queue = Promise.resolve(),
      skipped = 0,
      unreadable = 0;
    const hashes = new Set<string>();
    try {
      await mammoth.convertToHtml(
        { arrayBuffer },
        {
          externalFileAccess: false,
          convertImage: mammoth.images.imgElement((image) => {
            const item = queue.then(async () => {
              if (references.length >= MAX_REFERENCES) {
                skipped++;
                return;
              }
              try {
                const bytes = new Uint8Array(await image.readAsArrayBuffer());
                const hash = Array.from(
                  new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
                  (b) => b.toString(16).padStart(2, "0"),
                ).join("");
                if (hashes.has(hash)) return;
                hashes.add(hash);
                const url = await embeddedImage(bytes, image.contentType);
                references.push({
                  name: `${file.name}｜內嵌圖片 ${references.length + 1}`,
                  kind: "image",
                  dataUrl: url,
                });
              } catch {
                unreadable++;
              }
            });
            queue = item;
            return item.then(() => ({ src: "" }));
          }),
        },
      );
    } catch {
      warnings.push(
        "原稿文字已取得，但部分內嵌圖片未能完整擷取；請另外補傳重要參考圖。",
      );
    }
    if (skipped)
      warnings.push(
        `已擷取 ${references.length} 張內嵌參考圖，另有 ${skipped} 張尚未納入；請續補最重要的代表圖，每批最多六張。`,
      );
    if (unreadable)
      warnings.push(
        `有 ${unreadable} 張內嵌圖片未能讀取；原稿文字仍保留，請另外提供 PNG、JPEG 或 WebP 版本。`,
      );
  } else if (ext === "pdf") {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    const task = pdfjs.getDocument({
      data: await file.arrayBuffer(),
      useSystemFonts: true,
    });
    let imagePages = 0,
      failedPages = 0;
    try {
      const pdf = await task.promise,
        pages: string[] = [];
      const imageOps = new Set(
        [
          pdfjs.OPS.paintImageXObject,
          pdfjs.OPS.paintInlineImageXObject,
          pdfjs.OPS.paintImageMaskXObject,
          pdfjs.OPS.paintImageMaskXObjectGroup,
          pdfjs.OPS.paintInlineImageXObjectGroup,
          pdfjs.OPS.paintImageXObjectRepeat,
          pdfjs.OPS.paintImageMaskXObjectRepeat,
        ].filter((op) => typeof op === "number"),
      );
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        try {
          const content = await page.getTextContent();
          pages.push(
            content.items
              .map((i) => ("str" in i ? i.str + (i.hasEOL ? "\n" : " ") : ""))
              .join(""),
          );
          try {
            const operators = await page.getOperatorList();
            if (!operators.fnArray.some((op) => imageOps.has(op))) continue;
            imagePages++;
            if (imagePages > MAX_REFERENCES) continue;
            const base = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({
              scale: Math.min(1.5, 1800 / Math.max(base.width, base.height)),
            });
            const canvas = document.createElement("canvas");
            try {
              canvas.width = Math.ceil(viewport.width);
              canvas.height = Math.ceil(viewport.height);
              if (!canvas.getContext("2d"))
                throw new Error("無法讀取頁面畫面。");
              await page.render({ canvas, viewport, background: "#ffffff" })
                .promise;
              references.push({
                name: `${file.name}｜第 ${n} 頁原頁擷取`,
                kind: "image",
                dataUrl: canvasImage(canvas),
              });
            } finally {
              canvas.width = canvas.height = 0;
            }
          } catch {
            failedPages++;
          }
        } finally {
          page.cleanup();
        }
      }
      text = pages.join("\n\n");
      if (imagePages > MAX_REFERENCES)
        warnings.push(
          `已擷取前六個含圖片頁，另有 ${imagePages - MAX_REFERENCES} 個含圖片頁尚未納入；全文文字仍保留，請續補重要代表圖。`,
        );
      if (failedPages)
        warnings.push(
          `有 ${failedPages} 頁的圖片未能擷取；請另外上傳這些頁面的重要參考圖。`,
        );
    } finally {
      await task.destroy();
    }
  } else if (["txt", "md"].includes(ext || "")) text = await file.text();
  else throw new Error("文件請使用 DOCX、PDF、TXT 或 Markdown。");
  if (!text.trim())
    throw new Error(
      "這份文件沒有取得可讀文字，尚未完整讀取原稿。請提供文字版，或完成掃描文字辨識後再上傳。",
    );
  return {
    source: { name: file.name, kind: "text", text },
    references,
    warnings,
  };
}
