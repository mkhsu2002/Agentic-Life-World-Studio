import type { Env } from "./env";
import type { StudioAttachment } from "../shared/conversation";
import { newId, now, sha256, DomainError, splitSegments } from "./domain";
import { validateSourceUrl, normalizeText, googleDocument } from "./ingest";
export type SourceRow = {
  id: string;
  name: string;
  kind: string;
  url: string | null;
  storage_key: string;
  content_hash: string;
  char_count: number;
  status: string;
  metadata_json: string;
};
export function imageBytes(dataUrl: string) {
  const m =
    /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(
      dataUrl,
    );
  if (!m)
    throw new DomainError(
      "IMAGE_FORMAT",
      "圖片請使用 PNG、JPEG 或 WebP。",
      422,
    );
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  } catch {
    throw new DomainError("IMAGE_FORMAT", "圖片資料不完整。", 422);
  }
  return validateImageBytes(bytes, m[1]);
}
function validateImageBytes(bytes: Uint8Array, contentType: string) {
  if (bytes.length > 5 * 1024 * 1024)
    throw new DomainError("IMAGE_TOO_LARGE", "每張圖片需在 5 MB 以內。", 422);
  const valid =
    contentType === "image/png"
      ? bytes[0] === 137 &&
        bytes[1] === 80 &&
        bytes[2] === 78 &&
        bytes[3] === 71
      : contentType === "image/jpeg"
        ? bytes[0] === 255 && bytes[1] === 216
        : contentType === "image/webp"
          ? bytes[0] === 82 &&
            bytes[1] === 73 &&
            bytes[8] === 87 &&
            bytes[9] === 69
          : false;
  if (!valid)
    throw new DomainError("IMAGE_FORMAT", "圖片格式與檔案內容不符。", 422);
  return { bytes, contentType };
}
async function originalImage(env: Env, cid: string, key: string) {
  if (!key.startsWith(`studio/${cid}/uploads/`) || key.includes(".."))
    throw new DomainError(
      "ORIGINAL_NOT_OWNED",
      "原始圖片不屬於這段對話。",
      422,
    );
  const head = await env.STORAGE.head(key);
  if (!head || head.customMetadata?.conversationId !== cid)
    throw new DomainError(
      "ORIGINAL_NOT_OWNED",
      "找不到這段對話的原始圖片。",
      422,
    );
  if (head.size > 5 * 1024 * 1024)
    throw new DomainError("IMAGE_TOO_LARGE", "每張圖片需在 5 MB 以內。", 422);
  const object = await env.STORAGE.get(key);
  if (!object)
    throw new DomainError("ORIGINAL_NOT_OWNED", "原始圖片暫時無法讀取。", 422);
  const bytes = new Uint8Array(await object.arrayBuffer()),
    type =
      head.customMetadata?.contentType ||
      (bytes[0] === 137
        ? "image/png"
        : bytes[0] === 255
          ? "image/jpeg"
          : "image/webp");
  return validateImageBytes(bytes, type);
}

export async function prepareAttachments(
  env: Env,
  cid: string,
  attachments: StudioAttachment[],
) {
  const prepared: Record<string, unknown>[] = [];
  let images = 0;
  for (const a of attachments) {
    if (a.kind === "image") {
      if (++images > 6)
        throw new DomainError(
          "IMAGE_BATCH_LIMIT",
          "每批最多上傳六張圖片。",
          422,
        );
      if (!a.dataUrl && !a.originalKey)
        throw new DomainError("IMAGE_EMPTY", "請重新選擇圖片。", 422);
      if (a.dataUrl) imageBytes(a.dataUrl);
      else await originalImage(env, cid, a.originalKey!);
    }
    if (a.originalKey) {
      const prefix = `studio/${cid}/uploads/`;
      if (!a.originalKey.startsWith(prefix) || a.originalKey.includes(".."))
        throw new DomainError(
          "ORIGINAL_NOT_OWNED",
          "原始檔案不屬於這段對話。",
          422,
        );
      const file = await env.STORAGE.head(a.originalKey);
      if (!file || file.customMetadata?.conversationId !== cid)
        throw new DomainError(
          "ORIGINAL_NOT_OWNED",
          "找不到這段對話的原始檔案。",
          422,
        );
    }
    if (a.kind === "text" && !(a.text || "").trim())
      throw new DomainError("SOURCE_EMPTY", "這份檔案沒有可讀取的文字。", 422);
    if (a.kind === "url") validateSourceUrl(a.url || "");
    if ((a.text?.length || 0) > 4_000_000)
      throw new DomainError(
        "SOURCE_TOO_LARGE",
        "這份文字超過單次接收範圍，請分卷上傳。",
        422,
      );
  }
  for (const a of attachments) {
    const id = newId("source"),
      key = `studio/${cid}/input/${id}`;
    await env.STORAGE.put(key, JSON.stringify(a));
    prepared.push({ id, key, name: a.name, kind: a.kind });
  }
  return prepared;
}
export async function storeSource(
  env: Env,
  cid: string,
  name: string,
  text: string,
  url: string | null = null,
  status = "ready",
  metadata: Record<string, unknown> = {},
) {
  const normalized = normalizeText(text),
    hash = await sha256(normalized || `${url}:${status}`),
    id = newId("source"),
    key = `studio/${cid}/sources/${id}.txt`;
  await env.STORAGE.put(key, normalized);
  await env.DB.prepare(
    "INSERT OR IGNORE INTO studio_sources(id,conversation_id,name,kind,url,storage_key,content_hash,char_count,status,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  )
    .bind(
      id,
      cid,
      name,
      url ? "url" : "text",
      url,
      key,
      hash,
      Array.from(normalized).length,
      status,
      JSON.stringify(metadata),
      now(),
    )
    .run();
  return id;
}
export async function storeReference(
  env: Env,
  cid: string,
  name: string,
  dataUrl: string,
) {
  const { bytes, contentType } = imageBytes(dataUrl);
  return storeReferenceBytes(env, cid, name, bytes, contentType);
}
async function storeReferenceBytes(
  env: Env,
  cid: string,
  name: string,
  bytes: Uint8Array,
  contentType: string,
) {
  const hash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>),
      ),
      (b) => b.toString(16).padStart(2, "0"),
    ).join(""),
    id = "asset_" + (await sha256(cid + contentType + hash)).slice(0, 32),
    key = `studio/${cid}/references/${id}`;
  await env.STORAGE.put(key, bytes, { httpMetadata: { contentType } });
  await env.DB.prepare(
    "INSERT INTO studio_assets(id,conversation_id,kind,name,content_type,storage_key,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at,name=excluded.name",
  )
    .bind(id, cid, "reference", name, contentType, key, now())
    .run();
  return id;
}

export async function sourceTexts(env: Env, cid: string) {
  const rows = await env.DB.prepare(
    "SELECT * FROM studio_sources WHERE conversation_id=? AND status!='unavailable' ORDER BY created_at,id",
  )
    .bind(cid)
    .all<SourceRow>();
  const result = [];
  for (const r of rows.results) {
    const obj = await env.STORAGE.get(r.storage_key);
    if (!obj)
      throw new DomainError(
        "SOURCE_STORAGE_MISSING",
        "原稿暫時無法讀取，已保存的設定不受影響。",
        503,
      );
    result.push({ ...r, text: await obj.text() });
  }
  return result;
}
export async function referenceData(
  env: Env,
  cid: string,
  offset = 0,
  limit = 2,
) {
  const rows = await env.DB.prepare(
    "SELECT * FROM studio_assets WHERE conversation_id=? AND kind='reference' ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?",
  )
    .bind(cid, Math.min(2, Math.max(1, limit)), offset)
    .all<{ storage_key: string; content_type: string }>();
  const data: string[] = [];
  for (const r of rows.results) {
    const o = await env.STORAGE.get(r.storage_key);
    if (!o)
      throw new DomainError(
        "REFERENCE_MISSING",
        "參考圖片暫時無法讀取，請稍後重試。",
        503,
      );
    const bytes = new Uint8Array(await o.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    data.push(`data:${r.content_type};base64,${btoa(binary)}`);
  }
  return data;
}
export function readingParts(
  sources: { id: string; name: string; text: string }[],
  maxChars = 120000,
) {
  return sources.flatMap((s) =>
    splitSegments(s.text, maxChars).map((p, i) => ({
      sourceId: s.id,
      name: s.name,
      part: i + 1,
      text: p.text,
    })),
  );
}
function decode(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}
export function extractPage(html: string, url: string) {
  const title = decode(
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || url,
  );
  const stripped = html
    .replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(p|div|h[1-6]|li|article|section)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  const links = [
    ...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi),
  ].flatMap((m) => {
    try {
      const u = new URL(decode(m[1]), url);
      u.hash = "";
      if (
        u.origin !== new URL(url).origin ||
        /\.(png|jpe?g|webp|gif|svg|zip|pdf|mp4|css|js)(?:$|\?)/i.test(u.href)
      )
        return [];
      return [u.href];
    } catch {
      return [];
    }
  });
  const images = [
    ...html.matchAll(/<img\b[^>]*src\s*=\s*["']([^"']+)["']/gi),
  ].flatMap((m) => {
    try {
      return [new URL(decode(m[1]), url).href];
    } catch {
      return [];
    }
  });
  return {
    title,
    text: normalizeText(decode(stripped)),
    links: [...new Set(links)],
    images: [...new Set(images)],
  };
}
async function safeFetch(url: string, accept: string, maxBytes: number) {
  let current = validateSourceUrl(url);
  for (let n = 0; n < 4; n++) {
    const dns = await fetch(
      `https://dns.google/resolve?name=${encodeURIComponent(current.hostname)}&type=A`,
      { signal: AbortSignal.timeout(15000) },
    );
    const answer = (await dns.json()) as {
      Answer?: { type: number; data: string }[];
    };
    if (
      (answer.Answer || []).some(
        (a) =>
          a.type === 1 &&
          /^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(
            a.data,
          ),
      )
    )
      throw new DomainError("URL_NOT_ALLOWED", "此網址不能作為公開來源。", 422);
    const r = await fetch(current, {
      redirect: "manual",
      headers: { Accept: accept },
      signal: AbortSignal.timeout(20000),
    });
    if (r.status >= 300 && r.status < 400) {
      current = validateSourceUrl(
        new URL(r.headers.get("location") || "", current).href,
      );
      continue;
    }
    if (!r.ok)
      throw new DomainError(
        "SOURCE_FETCH_FAILED",
        `來源回覆 HTTP ${r.status}`,
        422,
      );
    const reader = r.body?.getReader();
    if (!reader) throw new DomainError("SOURCE_EMPTY");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel();
        throw new DomainError(
          "SOURCE_TOO_LARGE",
          "來源超過單頁讀取範圍。",
          422,
        );
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const b of chunks) {
      bytes.set(b, offset);
      offset += b.length;
    }
    return {
      bytes,
      url: current.href,
      contentType: r.headers.get("content-type") || "",
    };
  }
  throw new DomainError("SOURCE_REDIRECT_LIMIT");
}
export type CrawlState = {
  queue: string[];
  visited: string[];
  origin: string;
  rootPath: string;
  complete: boolean;
  limited: boolean;
  imageCount: number;
  maxPages?: number;
  overflowKey?: string;
  overflowCount?: number;
};
export async function crawlBatch(env: Env, cid: string, state: CrawlState) {
  let overflow: string[] = [];
  if (state.overflowKey) {
    const object = await env.STORAGE.get(state.overflowKey);
    if (!object)
      throw new DomainError(
        "CRAWL_FRONTIER_MISSING",
        "網站待讀清單暫時無法取得，已保存的內容不受影響。",
        503,
      );
    overflow = JSON.parse(await object.text());
  }
  while (overflow.length && state.queue.length < 1000) {
    const next = overflow.shift()!;
    if (!state.visited.includes(next) && !state.queue.includes(next))
      state.queue.push(next);
  }
  const overflowSet = new Set(overflow);
  const batch = state.queue
    .splice(
      0,
      Math.min(5, Math.max(0, (state.maxPages || 100) - state.visited.length)),
    )
    .filter((u) => !state.visited.includes(u));
  for (const url of batch) {
    if (state.visited.length >= (state.maxPages || 100)) {
      state.limited = true;
      break;
    }
    state.visited.push(url);
    try {
      const r = await safeFetch(url, "text/html,text/plain", 4 * 1024 * 1024);
      if (new URL(r.url).origin !== state.origin)
        throw new DomainError("SOURCE_SCOPE_REDIRECT");
      const isHtml = r.contentType.includes("html"),
        raw = new TextDecoder().decode(r.bytes),
        p = isHtml
          ? extractPage(raw, r.url)
          : { title: r.url, text: normalizeText(raw), links: [], images: [] };
      await storeSource(env, cid, p.title, p.text, r.url, "ready", {
        snapshot: true,
      });
      for (const link of p.links) {
        if (
          new URL(link).pathname.startsWith(state.rootPath) &&
          !state.visited.includes(link) &&
          !state.queue.includes(link) &&
          !overflowSet.has(link)
        ) {
          if (state.queue.length < 1000) state.queue.push(link);
          else {
            overflow.push(link);
            overflowSet.add(link);
          }
        }
      }
      for (const image of p.images.slice(0, 6 - state.imageCount)) {
        try {
          const img = await safeFetch(
            image,
            "image/png,image/jpeg,image/webp",
            5 * 1024 * 1024,
          );
          if (
            !["image/png", "image/jpeg", "image/webp"].includes(
              img.contentType.split(";")[0],
            )
          )
            continue;
          let binary = "";
          for (let i = 0; i < img.bytes.length; i += 8192)
            binary += String.fromCharCode(...img.bytes.subarray(i, i + 8192));
          await storeReference(
            env,
            cid,
            image,
            `data:${img.contentType.split(";")[0]};base64,${btoa(binary)}`,
          );
          state.imageCount++;
        } catch {
          /* Keep text sources available when a website image cannot be read. */
        }
      }
    } catch (e) {
      await storeSource(env, cid, url, "", url, "unavailable", {
        reason: e instanceof DomainError ? e.code : "SOURCE_UNAVAILABLE",
      });
    }
  }
  if (overflow.length || state.overflowKey) {
    state.overflowKey ||= `studio/${cid}/crawl-frontiers/${newId("frontier")}.json`;
    await env.STORAGE.put(state.overflowKey, JSON.stringify(overflow));
  }
  state.overflowCount = overflow.length;
  state.complete =
    (state.queue.length === 0 && overflow.length === 0) ||
    state.visited.length >= (state.maxPages || 100);
  if ((state.queue.length || overflow.length) && state.complete)
    state.limited = true;
  return state;
}
export async function ingestPrepared(
  env: Env,
  cid: string,
  prepared: Record<string, unknown>[],
  crawl?: CrawlState,
) {
  if (crawl) return crawlBatch(env, cid, crawl);
  for (const p of prepared) {
    const o = await env.STORAGE.get(String(p.key));
    if (!o)
      throw new DomainError(
        "INPUT_MISSING",
        "上傳內容暫時無法讀取，請稍後重試。",
        503,
      );
    const a = JSON.parse(await o.text()) as StudioAttachment;
    if (a.kind === "text") {
      await storeSource(env, cid, a.name, a.text || "");
    } else if (a.kind === "image") {
      if (a.dataUrl) await storeReference(env, cid, a.name, a.dataUrl);
      else if (a.originalKey) {
        const image = await originalImage(env, cid, a.originalKey);
        await storeReferenceBytes(
          env,
          cid,
          a.name,
          image.bytes,
          image.contentType,
        );
      } else throw new DomainError("IMAGE_EMPTY", "請重新選擇圖片。", 422);
    } else if (a.url) {
      if (a.url.includes("docs.google.com/document/")) {
        const doc = await googleDocument(env, a.url);
        await storeSource(env, cid, doc.title || a.name, doc.text, a.url);
        await env.DB.prepare(
          "INSERT INTO studio_events(conversation_id,type,content,data_json,created_at) VALUES(?,?,?,?,?)",
        )
          .bind(
            cid,
            "assistant",
            "目前連線已取得文件文字；畫風參考請另外上傳代表圖片。",
            "{}",
            now(),
          )
          .run();
      } else {
        const u = validateSourceUrl(a.url);
        return crawlBatch(env, cid, {
          queue: [u.href],
          visited: [],
          origin: u.origin,
          rootPath: u.pathname.endsWith("/")
            ? u.pathname
            : u.pathname.slice(0, u.pathname.lastIndexOf("/") + 1),
          complete: false,
          limited: false,
          imageCount: 0,
        });
      }
    }
  }
  return null;
}

export async function sourceManifest(env: Env, cid: string) {
  return (
    await env.DB.prepare(
      "SELECT * FROM studio_sources WHERE conversation_id=? AND status!='unavailable' ORDER BY created_at,id",
    )
      .bind(cid)
      .all<SourceRow>()
  ).results;
}
