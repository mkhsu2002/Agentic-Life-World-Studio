import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "./env";
import { locales } from "../shared/contracts";
import type {
  WorldDraft,
  Translation,
  Locale,
  PublicWorld,
} from "../shared/contracts";
import {
  DomainError,
  assertRevision,
  validateConfirmation,
  validateLocale,
  newId,
  now,
  sha256,
} from "./domain";
import { getWorld, sourceInfo, auditStatement } from "./repository";
export const siteRoutes = new Hono<{ Bindings: Env }>();
const siteInput = z.object({
  revision: z.number().int(),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(63),
  locales: z.array(z.enum(locales)).min(1),
});
async function ready(
  env: Env,
  id: string,
  revision: number,
  enabled: Locale[],
) {
  const w = await getWorld(env, id);
  assertRevision(w, revision);
  if (w.status !== "confirmed") throw new DomainError("WORLD_NOT_CONFIRMED");
  const source = await sourceInfo(env, w.sourceId);
  validateConfirmation(w, source.processedCount, source.segmentCount);
  if (!enabled.includes("en")) throw new DomainError("ENGLISH_REQUIRED");
  for (const locale of enabled) {
    const t = w.translations[locale];
    if (!t || t.status !== "approved")
      throw new DomainError(
        "TRANSLATION_NOT_APPROVED",
        `${locale} needs calibration approval`,
      );
    validateLocale(w, t);
  }
  return w;
}
function publicData(
  w: WorldDraft,
  t: Translation,
  id: string,
  slug: string,
  enabled: Locale[],
  stamp: string,
): PublicWorld {
  const p = w.previews.find((p) => p.id === w.visualApproval?.previewId);
  return {
    releaseId: id,
    slug,
    revision: w.revision,
    locale: t.locale,
    locales: enabled,
    title: t.title,
    tagline: t.tagline,
    introduction: t.introduction,
    elements: w.elements.map((e) => ({
      id: e.id,
      kind: e.kind,
      name: t.elements[e.id].name,
      definition: t.elements[e.id].definition,
      features: e.features.map((f) => t.elements[e.id].features[f.id]),
    })),
    imageUrl: p ? `/media/${p.assetId}` : null,
    palette: w.styles.find((s) => s.id === w.selectedStyleId)?.palette || [],
    createdAt: stamp,
  };
}
type ReleaseRow = {
  id: string;
  world_id: string;
  slug: string;
  revision: number;
  status: string;
  locales_json: string;
  content_json: string;
  hash: string;
  created_at: string;
};
siteRoutes.post("/worlds/:id/site-previews", async (c) => {
  const b = siteInput.parse(await c.req.json());
  const enabled = [...new Set(b.locales)];
  const w = await ready(c.env, c.req.param("id"), b.revision, enabled);
  const occupied = await c.env.DB.prepare(
    "SELECT world_id FROM releases WHERE slug=? AND status='active'",
  )
    .bind(b.slug)
    .first<{ world_id: string }>();
  if (occupied && occupied.world_id !== w.id)
    throw new DomainError("SLUG_UNAVAILABLE");
  const id = newId("release"),
    stamp = now();
  const content = Object.fromEntries(
    enabled.map((l) => [
      l,
      publicData(w, w.translations[l]!, id, b.slug, enabled, stamp),
    ]),
  );
  const hash = await sha256(JSON.stringify(content));
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO releases(id,world_id,slug,revision,status,locales_json,content_json,hash,created_at) VALUES(?,?,?,?,'preview',?,?,?,?)",
    ).bind(
      id,
      w.id,
      b.slug,
      w.revision,
      JSON.stringify(enabled),
      JSON.stringify(content),
      hash,
      stamp,
    ),
    auditStatement(
      c.env,
      w.id,
      "site.preview_created",
      "Website preview created",
      { previewId: id, hash },
    ),
  ]);
  return c.json(
    {
      preview: {
        id,
        url: `${new URL(c.req.url).origin}/preview/${id}/en`,
        hash,
        revision: w.revision,
        locales: enabled,
      },
    },
    201,
  );
});
siteRoutes.get("/site-previews/:id/:locale", async (c) => {
  const locale = z.enum(locales).parse(c.req.param("locale"));
  const row = await c.env.DB.prepare("SELECT * FROM releases WHERE id=?")
    .bind(c.req.param("id"))
    .first<ReleaseRow>();
  if (!row)
    throw new DomainError("PREVIEW_NOT_FOUND", "Preview not found", 404);
  const content = JSON.parse(row.content_json) as Record<string, PublicWorld>;
  if (!content[locale])
    throw new DomainError(
      "LOCALE_NOT_FOUND",
      "This language is not part of this preview",
      404,
    );
  await c.env.DB.batch([
    auditStatement(
      c.env,
      row.world_id,
      "site.preview_read",
      `${locale} website preview inspected`,
      { previewId: row.id, locale, hash: row.hash },
    ),
  ]);
  return c.json(content[locale]);
});
siteRoutes.post("/worlds/:id/releases", async (c) => {
  const b = siteInput
    .extend({ previewId: z.string() })
    .parse(await c.req.json());
  const enabled = [...new Set(b.locales)];
  const w = await ready(c.env, c.req.param("id"), b.revision, enabled);
  const occupied = await c.env.DB.prepare(
    "SELECT world_id FROM releases WHERE slug=? AND status='active'",
  )
    .bind(b.slug)
    .first<{ world_id: string }>();
  if (occupied && occupied.world_id !== w.id)
    throw new DomainError("SLUG_UNAVAILABLE");
  const row = await c.env.DB.prepare(
    "SELECT * FROM releases WHERE id=? AND world_id=? AND status='preview'",
  )
    .bind(b.previewId, w.id)
    .first<ReleaseRow>();
  if (
    !row ||
    row.revision !== w.revision ||
    row.slug !== b.slug ||
    JSON.stringify([...JSON.parse(row.locales_json)].sort()) !==
      JSON.stringify([...enabled].sort())
  )
    throw new DomainError(
      "SITE_PREVIEW_STALE",
      "Create a preview of the current settings before publishing",
    );
  const content = JSON.parse(row.content_json) as Record<string, PublicWorld>;
  if ((await sha256(row.content_json)) !== row.hash)
    throw new DomainError("SITE_PREVIEW_INVALID");
  for (const locale of enabled) {
    const expected = publicData(
      w,
      w.translations[locale]!,
      row.id,
      b.slug,
      enabled,
      row.created_at,
    );
    if (JSON.stringify(expected) !== JSON.stringify(content[locale]))
      throw new DomainError(
        "SITE_PREVIEW_STALE",
        "The preview no longer matches calibrated content",
      );
  }
  const viewed = await c.env.DB.prepare(
    "SELECT id FROM audit WHERE world_id=? AND type='site.preview_read' AND json_extract(data_json,'$.previewId')=? AND json_extract(data_json,'$.locale')='en' LIMIT 1",
  )
    .bind(w.id, row.id)
    .first();
  if (!viewed)
    throw new DomainError(
      "SITE_PREVIEW_NOT_VIEWED",
      "Open the English website preview before publishing",
    );
  const claim = await c.env.DB.prepare(
    "UPDATE releases SET status='verifying' WHERE id=? AND status='preview'",
  )
    .bind(row.id)
    .run();
  if (claim.meta.changes !== 1)
    throw new DomainError(
      "RELEASE_IN_PROGRESS",
      "This preview is already being published",
    );
  await c.env.DB.batch([
    auditStatement(
      c.env,
      w.id,
      "release.verifying",
      "Checking public content and artwork before activation",
      { releaseId: row.id },
    ),
  ]);
  const origin = new URL(c.req.url).origin;
  try {
    const response = await fetch(`${origin}/api/public/readback/${row.id}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("public_readback_status");
    const result = (await response.json()) as {
      releaseId: string;
      hash: string;
      content: Record<string, PublicWorld>;
    };
    if (
      result.releaseId !== row.id ||
      result.hash !== row.hash ||
      (await sha256(JSON.stringify(result.content))) !== row.hash
    )
      throw new Error("public_content_mismatch");
    const image = content.en.imageUrl;
    if (!image) throw new Error("artwork_missing");
    const assetId = image.split("/").pop()!;
    const imageResponse = await fetch(
      `${origin}/api/public/artwork/${row.id}/${assetId}`,
      { cache: "no-store" },
    );
    if (
      !imageResponse.ok ||
      !imageResponse.headers.get("content-type")?.startsWith("image/")
    )
      throw new Error("public_artwork_status");
    const imageBytes = await imageResponse.arrayBuffer();
    if (
      (await sha256(imageBytes)) !== imageResponse.headers.get("X-Asset-SHA256")
    )
      throw new Error("public_artwork_hash");
    const html = await fetch(`${origin}/preview/${row.id}/en`, {
      cache: "no-store",
    });
    const text = await html.text();
    if (!html.ok || !text.includes('id="root"') || !text.includes("/assets/"))
      throw new Error("renderer_missing");
    const guard = newId("guard");
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO mutation_guards(id,valid) VALUES(?,(SELECT CASE WHEN revision=? AND lock_version=? AND NOT EXISTS (SELECT 1 FROM releases WHERE slug=? AND status='active' AND world_id!=?) AND EXISTS (SELECT 1 FROM releases WHERE id=? AND status='verifying') THEN 1 ELSE 0 END FROM worlds WHERE id=?))",
      ).bind(guard, w.revision, w.recordVersion, b.slug, w.id, row.id, w.id),
      c.env.DB.prepare(
        "UPDATE releases SET status='superseded' WHERE slug=? AND world_id=? AND status='active'",
      ).bind(b.slug, w.id),
      c.env.DB.prepare(
        "UPDATE releases SET status='active' WHERE id=? AND status='verifying'",
      ).bind(row.id),
      auditStatement(
        c.env,
        w.id,
        "release.active",
        `World website published: /en/worlds/${b.slug}`,
        { releaseId: row.id, hash: row.hash },
      ),
      c.env.DB.prepare("DELETE FROM mutation_guards WHERE id=?").bind(guard),
    ]);
  } catch (error) {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE releases SET status='failed' WHERE id=? AND status='verifying'",
      ).bind(row.id),
      auditStatement(
        c.env,
        w.id,
        "release.failed",
        "Public verification failed; previous website retained",
        { reason: String(error).slice(0, 150) },
      ),
    ]);
    throw new DomainError(
      "DEPLOYMENT_VERIFICATION_FAILED",
      "Public readback failed. The previous release is preserved.",
      502,
    );
  }
  return c.json(
    {
      release: {
        id: row.id,
        worldId: w.id,
        slug: b.slug,
        revision: w.revision,
        status: "active",
        locales: enabled,
        url: `${origin}/en/worlds/${b.slug}`,
        hash: row.hash,
        createdAt: row.created_at,
      },
    },
    201,
  );
});
siteRoutes.get("/public/readback/:id", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT * FROM releases WHERE id=? AND status IN ('verifying','active')",
  )
    .bind(c.req.param("id"))
    .first<ReleaseRow>();
  if (!row) throw new DomainError("NOT_FOUND", "Not found", 404);
  return c.json({
    releaseId: row.id,
    hash: row.hash,
    content: JSON.parse(row.content_json),
  });
});
siteRoutes.get("/public/artwork/:release/:asset", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT content_json FROM releases WHERE id=? AND status IN ('verifying','active')",
  )
    .bind(c.req.param("release"))
    .first<{ content_json: string }>();
  const assetId = c.req.param("asset");
  if (
    !row ||
    !Object.values(
      JSON.parse(row.content_json) as Record<string, PublicWorld>,
    ).some((p) => p.imageUrl === `/media/${assetId}`)
  )
    throw new DomainError("NOT_FOUND", "Not found", 404);
  const a = await c.env.DB.prepare(
    "SELECT object_key,content_type,sha256 FROM assets WHERE id=?",
  )
    .bind(assetId)
    .first<{ object_key: string; content_type: string; sha256: string }>();
  const object = a ? await c.env.STORAGE.get(a.object_key) : null;
  if (!a || !object) throw new DomainError("NOT_FOUND", "Not found", 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": a.content_type,
      "X-Asset-SHA256": a.sha256,
      "Cache-Control": "no-store",
    },
  });
});
siteRoutes.get("/public/:locale/:slug", async (c) => {
  const locale = z.enum(locales).parse(c.req.param("locale"));
  const row = await c.env.DB.prepare(
    "SELECT content_json FROM releases WHERE slug=? AND status='active'",
  )
    .bind(c.req.param("slug"))
    .first<{ content_json: string }>();
  const content = row
    ? (JSON.parse(row.content_json) as Record<string, PublicWorld>)
    : null;
  if (!content?.[locale])
    return c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "This world or language edition is not published yet.",
        },
      },
      404,
    );
  return c.json(content[locale]);
});
