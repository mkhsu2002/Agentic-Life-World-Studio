import { Hono } from "hono";
import { z } from "zod";
import type { WorldDraft } from "../shared/contracts";
import type { Env } from "./env";
import { assertRevision, DomainError, now, revised, sha256 } from "./domain";
import { getWorld, saveWorld } from "./repository";

import {
  MAX_SOURCE_IMAGES,
  MAX_SOURCE_IMAGE_BYTES,
  MAX_SOURCE_IMAGE_TOTAL_BYTES,
} from "../shared/source-image-limits";
export {
  MAX_SOURCE_IMAGES,
  MAX_SOURCE_IMAGE_BYTES,
  MAX_SOURCE_IMAGE_TOTAL_BYTES,
} from "../shared/source-image-limits";
const totalLimit = () =>
  new DomainError(
    "SOURCE_IMAGE_TOTAL_TOO_LARGE",
    "原作參考圖合計不可超過 15 MB，請縮小圖片後重試。",
    422,
  );
export type ValidatedSourceImage = {
  label: string;
  bytes: Uint8Array;
  contentType: "image/png" | "image/jpeg" | "image/webp";
  sha256: string;
};
const invalidImage = () =>
  new DomainError(
    "SOURCE_IMAGE_INVALID",
    "請選擇有效的 PNG、JPEG 或 WebP 圖片。",
    422,
  );
function imageType(
  bytes: Uint8Array,
): ValidatedSourceImage["contentType"] | null {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value))
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  return null;
}
export async function validateSourceImageInputs(
  input: unknown,
): Promise<ValidatedSourceImage[]> {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw invalidImage();
  if (input.length > MAX_SOURCE_IMAGES)
    throw new DomainError(
      "SOURCE_IMAGE_LIMIT",
      "每個世界最多可加入 6 張原作參考圖。",
      422,
    );
  const result: ValidatedSourceImage[] = [];
  let totalBytes = 0;
  for (const value of input) {
    if (
      !value ||
      typeof value !== "object" ||
      typeof value.label !== "string" ||
      !value.label.trim() ||
      value.label.length > 200 ||
      typeof value.dataUrl !== "string"
    )
      throw invalidImage();
    const match =
      /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(
        value.dataUrl,
      );
    if (!match) throw invalidImage();
    if (match[2].length > Math.ceil(MAX_SOURCE_IMAGE_BYTES / 3) * 4)
      throw new DomainError(
        "SOURCE_IMAGE_TOO_LARGE",
        "每張原作參考圖不可超過 5 MB。",
        422,
      );
    let bytes: Uint8Array;
    try {
      const binary = atob(match[2]);
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    } catch {
      throw invalidImage();
    }
    if (bytes.length > MAX_SOURCE_IMAGE_BYTES)
      throw new DomainError(
        "SOURCE_IMAGE_TOO_LARGE",
        "每張原作參考圖不可超過 5 MB。",
        422,
      );
    totalBytes += bytes.length;
    if (totalBytes > MAX_SOURCE_IMAGE_TOTAL_BYTES) throw totalLimit();
    const contentType = imageType(bytes);
    if (!contentType || contentType !== match[1] || bytes.length === 0)
      throw invalidImage();
    const hash = await sha256(bytes.buffer as ArrayBuffer);
    if (!result.some((image) => image.sha256 === hash))
      result.push({
        label: value.label.trim(),
        bytes,
        contentType,
        sha256: hash,
      });
  }
  return result;
}

/** Prepare private object storage and append DB statements to the caller's atomic world transaction. */
export async function sourceImageStatements(
  env: Env,
  w: WorldDraft,
  images: ValidatedSourceImage[],
): Promise<D1PreparedStatement[]> {
  const existing = w.sourceImages || [];
  const pending = images.filter(
    (image, index) =>
      !existing.some((saved) => saved.sha256 === image.sha256) &&
      images.findIndex((candidate) => candidate.sha256 === image.sha256) ===
        index,
  );
  if (existing.length + pending.length > MAX_SOURCE_IMAGES)
    throw new DomainError(
      "SOURCE_IMAGE_LIMIT",
      "每個世界最多可加入 6 張原作參考圖。",
      422,
    );
  const currentData = existing.length ? await sourceImageData(env, w) : [];
  const currentBytes = currentData.reduce((total, url) => {
    const base64 = url.split(",")[1];
    return (
      total +
      (base64.length * 3) / 4 -
      (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0)
    );
  }, 0);
  if (
    currentBytes +
      pending.reduce((total, image) => total + image.bytes.length, 0) >
    MAX_SOURCE_IMAGE_TOTAL_BYTES
  )
    throw totalLimit();
  const statements: D1PreparedStatement[] = [];
  for (const image of pending) {
    const identity = await sha256(`${w.id}:${image.sha256}`);
    const id = `source_image_${identity}`,
      assetId = `asset_source_${identity}`,
      stamp = now();
    const objectKey = `source-images/${identity}`;
    await env.STORAGE.put(objectKey, image.bytes, {
      httpMetadata: { contentType: image.contentType },
    });
    statements.push(
      env.DB.prepare(
        "INSERT INTO assets(id,world_id,object_key,content_type,sha256,created_at) VALUES(?,?,?,?,?,?)",
      ).bind(assetId, w.id, objectKey, image.contentType, image.sha256, stamp),
      env.DB.prepare(
        "INSERT INTO source_images(id,world_id,asset_id,label,sha256,created_at) VALUES(?,?,?,?,?,?)",
      ).bind(id, w.id, assetId, image.label, image.sha256, stamp),
    );
    existing.push({
      id,
      assetId,
      label: image.label,
      sha256: image.sha256,
      status: "available",
    });
  }
  w.sourceImages = existing;
  return statements;
}

/** Retrieve only persisted images owned by this world; retrieval alone is not model review. */
export async function sourceImageData(
  env: Env,
  w: WorldDraft,
): Promise<string[]> {
  if ((w.sourceImages?.length || 0) > MAX_SOURCE_IMAGES)
    throw new DomainError("SOURCE_IMAGE_LIMIT");
  const result: string[] = [];
  let totalBytes = 0;
  for (const image of w.sourceImages || []) {
    const asset = await env.DB.prepare(
      "SELECT a.object_key,a.content_type,a.sha256 FROM source_images s JOIN assets a ON a.id=s.asset_id WHERE s.id=? AND s.world_id=? AND s.asset_id=? AND s.sha256=? AND a.world_id=?",
    )
      .bind(image.id, w.id, image.assetId, image.sha256, w.id)
      .first<{ object_key: string; content_type: string; sha256: string }>();
    if (!asset || asset.sha256 !== image.sha256)
      throw new DomainError(
        "SOURCE_IMAGE_MISSING",
        "原作參考圖暫時無法讀取，請重新上傳後重試。",
        409,
      );
    const stored = await env.STORAGE.get(asset.object_key);
    if (!stored)
      throw new DomainError(
        "SOURCE_IMAGE_MISSING",
        "原作參考圖暫時無法讀取，請重新上傳後重試。",
        409,
      );
    const bytes = new Uint8Array(await stored.arrayBuffer());
    totalBytes += bytes.length;
    if (totalBytes > MAX_SOURCE_IMAGE_TOTAL_BYTES) throw totalLimit();
    if (
      bytes.length > MAX_SOURCE_IMAGE_BYTES ||
      imageType(bytes) !== asset.content_type ||
      (await sha256(bytes.buffer as ArrayBuffer)) !== image.sha256
    )
      throw invalidImage();
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    result.push(`data:${asset.content_type};base64,${btoa(binary)}`);
  }
  return result;
}

export const sourceImageRoutes = new Hono<{ Bindings: Env }>();
sourceImageRoutes.post("/worlds/:id/source-images", async (c) => {
  const body = z
    .object({
      revision: z.number().int().positive(),
      recordVersion: z.number().int().positive(),
      image: z.unknown(),
    })
    .parse(await c.req.json());
  const w = await getWorld(c.env, c.req.param("id"));
  assertRevision(w, body.revision);
  if (w.recordVersion !== body.recordVersion)
    throw new DomainError("REVISION_CONFLICT");
  const images = await validateSourceImageInputs([body.image]);
  const existing = w.sourceImages?.find(
    (image) => image.sha256 === images[0].sha256,
  );
  if (existing) {
    const asset = await c.env.DB.prepare(
      "SELECT a.object_key,a.content_type,a.sha256 FROM source_images s JOIN assets a ON a.id=s.asset_id WHERE s.id=? AND s.world_id=? AND s.asset_id=? AND s.sha256=? AND a.world_id=?",
    )
      .bind(existing.id, w.id, existing.assetId, existing.sha256, w.id)
      .first<{ object_key: string; content_type: string; sha256: string }>();
    const objectKey = `source-images/${await sha256(`${w.id}:${images[0].sha256}`)}`;
    if (
      !asset ||
      asset.sha256 !== images[0].sha256 ||
      asset.content_type !== images[0].contentType ||
      asset.object_key !== objectKey
    )
      throw new DomainError(
        "SOURCE_IMAGE_MISSING",
        "無法確認此原作參考圖的儲存資料，請重新整理後重試。",
        409,
      );
    await c.env.STORAGE.put(objectKey, images[0].bytes, {
      httpMetadata: { contentType: images[0].contentType },
    });
    await saveWorld(
      c.env,
      w,
      w.revision,
      "image.restored",
      "已重新保存原作參考圖。",
    );
    return c.json({ world: w }, 200);
  }
  const updated = revised(w);
  if (w.status === "reading") updated.status = "reading";
  delete updated.framework;
  delete updated.brief;
  const statements = await sourceImageStatements(c.env, updated, images);
  await saveWorld(
    c.env,
    updated,
    w.revision,
    "source.image_added",
    "已保存原作參考圖，等待重新檢視世界。",
    statements,
  );
  return c.json({ world: updated }, 201);
});
