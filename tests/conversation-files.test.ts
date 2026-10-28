import { afterEach, it, expect, vi } from "vitest";
import { readConversationFile } from "../src/client/conversation-files";
const mammoth = vi.hoisted(() => ({
  extractRawText: vi.fn(),
  convertToHtml: vi.fn(),
  images: { imgElement: (fn: unknown) => fn },
}));
vi.mock("mammoth/mammoth.browser", () => ({ ...mammoth, default: mammoth }));
const pdf = vi.hoisted(() => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: "" },
  OPS: {
    paintImageXObject: 85,
    paintInlineImageXObject: 86,
    paintImageMaskXObject: 87,
    paintImageMaskXObjectGroup: 88,
    paintInlineImageXObjectGroup: 89,
    paintImageXObjectRepeat: 90,
    paintImageMaskXObjectRepeat: 91,
  },
}));
vi.mock("pdfjs-dist", () => pdf);
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({
  default: "/test-worker.mjs",
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function png(marker = 1) {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, marker]);
  return bytes.buffer;
}
it("preserves ordinary text in the new source-and-references contract", async () => {
  const file = new File(["完整原稿\n最後禁止事項。"], "story.txt", {
    type: "text/plain",
  });
  const result = await readConversationFile(file);
  expect(result.source).toEqual({
    name: "story.txt",
    kind: "text",
    text: "完整原稿\n最後禁止事項。",
  });
  expect(result.references).toEqual([]);
  expect(result.warnings).toEqual([]);
});
it("extracts actual DOCX embedded image bytes with mammoth convertImage while retaining all original text", async () => {
  mammoth.extractRawText.mockResolvedValue({
    value: "第一章\n全文最後一段。",
    messages: [],
  });
  mammoth.convertToHtml.mockImplementation(async (_input, options) => {
    const a = await options.convertImage({
      contentType: "image/png",
      readAsArrayBuffer: async () => png(1),
    });
    expect(a.src).toBe("");
    return { value: "<p>ignored html</p>", messages: [] };
  });
  const r = await readConversationFile(new File(["doc"], "story.docx"));
  expect(r.source.text).toContain("全文最後一段");
  expect(r.references).toHaveLength(1);
  expect(r.references[0].dataUrl).toBe(
    "data:image/png;base64," + Buffer.from(png(1)).toString("base64"),
  );
});
it("caps DOCX references at six and explicitly reports other pictures", async () => {
  mammoth.extractRawText.mockResolvedValue({ value: "所有文字", messages: [] });
  mammoth.convertToHtml.mockImplementation(async (_input, options) => {
    for (let i = 0; i < 8; i++)
      await options.convertImage({
        contentType: "image/png",
        readAsArrayBuffer: async () => png(i),
      });
    return { value: "", messages: [] };
  });
  const r = await readConversationFile(new File(["doc"], "story.docx"));
  expect(r.references).toHaveLength(6);
  expect(r.warnings.join(" ")).toContain("2");
  expect(r.warnings.join(" ")).toContain("尚未");
});
it("does not discard all text when an embedded image cannot be decoded", async () => {
  mammoth.extractRawText.mockResolvedValue({
    value: "文字仍然完整",
    messages: [],
  });
  mammoth.convertToHtml.mockImplementation(async (_input, options) => {
    await options.convertImage({
      contentType: "image/x-emf",
      readAsArrayBuffer: async () => png(),
    });
    return { value: "", messages: [] };
  });
  const r = await readConversationFile(new File(["doc"], "story.docx"));
  expect(r.source.text).toBe("文字仍然完整");
  expect(r.references).toEqual([]);
  expect(r.warnings.join(" ")).toContain("圖片");
});
it("requests PDF page rendering on a DOM canvas for six image pages and reports the remainder (mock contract only)", async () => {
  const canvases: any[] = [],
    render = vi.fn().mockImplementation(() => ({ promise: Promise.resolve() }));
  vi.stubGlobal("document", {
    createElement: () => {
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({}),
        toDataURL: () => "data:image/jpeg;base64,/9j/2Q==",
      };
      canvases.push(canvas);
      return canvas;
    },
  });
  const destroy = vi.fn().mockResolvedValue(undefined);
  pdf.getDocument.mockReturnValue({
    promise: Promise.resolve({
      numPages: 8,
      getPage: async (n: number) => ({
        getTextContent: async () => ({
          items: [{ str: "page " + n, hasEOL: true }],
        }),
        getOperatorList: async () => ({ fnArray: [85], argsArray: [] }),
        getViewport: ({ scale }: { scale: number }) => ({
          width: 600 * scale,
          height: 800 * scale,
        }),
        render,
        cleanup: vi.fn(),
      }),
    }),
    destroy,
  });
  const r = await readConversationFile(new File(["pdf"], "story.pdf"));
  expect(r.source.text).toContain("page 8");
  expect(r.references).toHaveLength(6);
  expect(render).toHaveBeenCalledTimes(6);
  expect(
    render.mock.calls.every(([arg]) => canvases.includes(arg.canvas)),
  ).toBe(true);
  expect(r.warnings.join(" ")).toContain("2");
  expect(destroy).toHaveBeenCalled();
});
it("rejects scan-only PDFs instead of claiming the whole manuscript was read", async () => {
  vi.stubGlobal("document", {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({}),
      toDataURL: () => "data:image/jpeg;base64,/9j/2Q==",
    }),
  });
  pdf.getDocument.mockReturnValue({
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({
        getTextContent: async () => ({ items: [] }),
        getOperatorList: async () => ({ fnArray: [85], argsArray: [] }),
        getViewport: () => ({ width: 600, height: 800 }),
        render: () => ({ promise: Promise.resolve() }),
        cleanup: () => {},
      }),
    }),
    destroy: async () => {},
  });
  await expect(
    readConversationFile(new File(["pdf"], "scan.pdf")),
  ).rejects.toThrow("文字");
});
