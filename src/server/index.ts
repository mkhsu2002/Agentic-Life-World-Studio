import { usage } from "./usage";
import { Hono } from "hono";
import { z } from "zod";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import type { Env, JobMessage } from "./env";
import type {
  WorldDraft,
  SourceKind,
  Locale,
  Translation,
  PublicWorld,
} from "../shared/contracts";
import { locales } from "../shared/contracts";
import {
  DomainError,
  newId,
  now,
  sha256,
  splitSegments,
  assertRevision,
  revised,
  decisionKey,
  translationHash,
  validateConfirmation,
  validateLocale,
} from "./domain";
import {
  getWorld,
  saveWorld,
  sourceInfo,
  jobs,
  audit,
  messages,
  releases,
  enqueue,
  auditStatement,
  deliverOutbox,
} from "./repository";
import { authenticated, login, logout, validateOrigin } from "./auth";
import { normalizeText, fetchPublicText, googleDocument } from "./ingest";
import { consumeJobs } from "./jobs";
import { callJson } from "./meta";
import { siteRoutes } from "./sites";
import { COPILOT } from "./prompts";
const app = new Hono<{ Bindings: Env }>();
app.use(
  "/api/*",
  bodyLimit({
    maxSize: 5 * 1024 * 1024,
    onError: (c) =>
      c.json(
        {
          error: { code: "REQUEST_TOO_LARGE", message: "Request exceeds 5 MB" },
        },
        413,
      ),
  }),
);
app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      workerSrc: ["'self'", "blob:"],
      fontSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
    referrerPolicy: "same-origin",
  }),
);
app.use("/api/*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) validateOrigin(c);
  const p = c.req.path;
  if (
    p === "/api/session" ||
    p === "/api/login" ||
    p === "/api/health" ||
    p.startsWith("/api/public/")
  )
    return next();
  if (!(await authenticated(c)))
    return c.json(
      { error: { code: "UNAUTHORIZED", message: "Sign in to Studio" } },
      401,
    );
  await next();
});
app.use("/api/*", async (c, next) => {
  const key = c.req.header("Idempotency-Key");
  if (
    !key ||
    ["GET", "HEAD", "OPTIONS"].includes(c.req.method) ||
    ["/api/login", "/api/logout"].includes(c.req.path)
  )
    return next();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(key))
    throw new DomainError(
      "INVALID_OPERATION_KEY",
      "Invalid operation key",
      422,
    );
  const hash = await sha256(
    c.req.method + c.req.path + (await c.req.raw.clone().text()),
  );
  const existing = await c.env.DB.prepare(
    "SELECT body_hash,response_json FROM operation_keys WHERE key=?",
  )
    .bind(key)
    .first<{ body_hash: string; response_json: string }>();
  if (existing) {
    if (existing.body_hash !== hash)
      throw new DomainError("IDEMPOTENCY_CONFLICT");
    const stored = JSON.parse(existing.response_json) as {
      pending?: boolean;
      body?: unknown;
      status?: number;
    };
    if (stored.pending)
      throw new DomainError(
        "OPERATION_IN_PROGRESS",
        "This operation is already being processed",
      );
    return c.json(stored.body, stored.status as 200);
  }
  const reserved = await c.env.DB.prepare(
    "INSERT OR IGNORE INTO operation_keys(key,body_hash,response_json,created_at) VALUES(?,?,?,?)",
  )
    .bind(key, hash, JSON.stringify({ pending: true }), now())
    .run();
  if (!reserved.meta.changes) throw new DomainError("OPERATION_IN_PROGRESS");
  await next();
  const body = await c.res
    .clone()
    .json()
    .catch(() => ({}));
  await c.env.DB.prepare(
    "UPDATE operation_keys SET response_json=? WHERE key=?",
  )
    .bind(JSON.stringify({ status: c.res.status, body }), key)
    .run();
});
app.onError((e, c) => {
  if (e instanceof DomainError)
    return c.json(
      { error: { code: e.code, message: e.message } },
      e.status as 400,
    );
  if (e instanceof z.ZodError)
    return c.json(
      {
        error: {
          code: "VALIDATION_FAILED",
          message: e.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        },
      },
      422,
    );
  console.error("request failed", String(e).slice(0, 300));
  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message:
          "The operation could not be completed. Your saved work is preserved.",
      },
    },
    500,
  );
});
app.get("/api/health", async (c) => {
  const schema = await c.env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('sources','worlds','elements','terms','jobs','audit','releases')",
  ).all();
  return c.json({
    status: schema.results.length === 7 ? "ok" : "schema_missing",
    version: "0.01",
    revision: c.env.BUILD_REVISION || "local",
    environment: c.env.ENVIRONMENT,
    contract: "utsp-studio/0.01",
  });
});
app.get("/api/session", async (c) =>
  c.json({ authenticated: await authenticated(c) }),
);
app.post("/api/login", async (c) => {
  const body = z
    .object({ password: z.string().max(512) })
    .parse(await c.req.json());
  await login(c, body.password);
  return c.json({ authenticated: true });
});
app.post("/api/logout", (c) => {
  logout(c);
  return c.json({ authenticated: false });
});
app.get("/api/overview", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT document_json FROM worlds ORDER BY updated_at DESC LIMIT 40",
  ).all<{ document_json: string }>();
  return c.json({
    worlds: results.map((r) => JSON.parse(r.document_json)),
    jobs: await jobs(c.env),
    audit: await audit(c.env),
    version: "0.01",
    capabilities: {
      meta: Boolean(c.env.MODEL_API_KEY),
      image: Boolean(c.env.MODEL_API_KEY),
      google: Boolean(c.env.GOOGLE_SERVICE_ACCOUNT),
    },
  });
});
app.post("/api/sources", async (c) => {
  const body = z
    .object({
      title: z.string().min(1).max(200),
      kind: z.enum(["text", "url", "docx", "pdf", "google-doc"]),
      text: z.string().max(1000000).optional(),
      url: z.string().url().max(2048).optional(),
    })
    .parse(await c.req.json());
  let text = body.text,
    title = body.title;
  if (!text && body.url) {
    if (body.url.includes("docs.google.com/document/")) {
      const doc = await googleDocument(c.env, body.url);
      text = doc.text;
      title = body.title || doc.title;
    } else text = await fetchPublicText(body.url);
  }
  if (!text?.trim())
    throw new DomainError(
      "SOURCE_EMPTY",
      "Provide source text or an accessible source URL",
      422,
    );
  text = normalizeText(text);
  if (new TextEncoder().encode(text).length > 4 * 1024 * 1024)
    throw new DomainError("SOURCE_TOO_LARGE", "Source exceeds 4 MB", 422);
  if (!c.env.MODEL_API_KEY)
    throw new DomainError(
      "META_NOT_CONFIGURED",
      "Connect model access before importing",
      503,
    );
  const id = newId("source"),
    worldId = newId("world"),
    stamp = now(),
    hash = await sha256(text),
    segments = splitSegments(text);
  const world: WorldDraft = {
    id: worldId,
    title,
    revision: 1,
    recordVersion: 1,
    status: "reading",
    sourceId: id,
    summary: "",
    era: "",
    geography: "",
    ecology: "",
    rules: [],
    elements: [],
    questions: [],
    styles: [],
    selectedStyleId: null,
    visualApproval: null,
    mode: "mixed",
    translations: {},
    previews: [],
    createdAt: stamp,
    updatedAt: stamp,
  };
  await c.env.STORAGE.put(`sources/${id}/original.txt`, text, {
    httpMetadata: { contentType: "text/plain;charset=utf-8" },
  });
  const statements = [
    c.env.DB.prepare(
      "INSERT INTO sources(id,title,kind,url,sha256,char_count,segment_count,created_at) VALUES(?,?,?,?,?,?,?,?)",
    ).bind(
      id,
      title,
      body.kind,
      body.url || null,
      hash,
      Array.from(text).length,
      segments.length,
      stamp,
    ),
    c.env.DB.prepare(
      "INSERT INTO worlds(id,source_id,revision,document_json,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    ).bind(worldId, id, 1, JSON.stringify(world), stamp, stamp),
  ];
  for (const s of segments) {
    const sid = `${id}_${s.id}`,
      key = `sources/${id}/${s.id}.txt`;
    await c.env.STORAGE.put(key, s.text);
    statements.push(
      c.env.DB.prepare(
        "INSERT INTO segments(id,source_id,ordinal,start_offset,end_offset,text_key) VALUES(?,?,?,?,?,?)",
      ).bind(sid, id, Number(s.id.split("_")[1]) - 1, s.start, s.end, key),
    );
  }
  statements.push(
    auditStatement(
      c.env,
      worldId,
      "source.imported",
      `Source persisted in ${segments.length} segments`,
    ),
  );
  await c.env.DB.batch(statements);
  const jobId = await enqueue(
    c.env,
    worldId,
    "import",
    {},
    segments.length + 1,
  );
  return c.json({ worldId, jobId }, 202);
});
app.get("/api/worlds/:id", async (c) => {
  const w = await getWorld(c.env, c.req.param("id"));
  return c.json({
    world: w,
    source: await sourceInfo(c.env, w.sourceId),
    jobs: await jobs(c.env, w.id),
    audit: await audit(c.env, w.id),
    messages: await messages(c.env, w.id),
    releases: await releases(c.env, w.id, new URL(c.req.url).origin),
  });
});
app.get("/api/worlds/:id/source", async (c) => {
  const w = await getWorld(c.env, c.req.param("id"));
  const source = await c.env.STORAGE.get(`sources/${w.sourceId}/original.txt`);
  if (!source)
    throw new DomainError("SOURCE_NOT_FOUND", "Source text missing", 404);
  return c.text(await source.text());
});
app.patch("/api/worlds/:id", async (c) => {
  const b = z
    .object({
      revision: z.number().int(),
      answers: z.record(z.string(), z.string().min(1).max(4000)).optional(),
      selectedStyleId: z.string().optional(),
      mode: z.enum(["landscape", "ecology", "mixed"]).optional(),
    })
    .parse(await c.req.json());
  const w = await getWorld(c.env, c.req.param("id"));
  assertRevision(w, b.revision);
  if (w.status === "reading") throw new DomainError("SOURCE_INCOMPLETE");
  const next = revised(w);
  if (b.answers)
    for (const [id, answer] of Object.entries(b.answers)) {
      const q = next.questions.find((q) => q.id === id);
      if (!q)
        throw new DomainError(
          "QUESTION_NOT_FOUND",
          "Unknown confirmation question",
          422,
        );
      q.answer = answer;
    }
  if (b.selectedStyleId) {
    if (!next.styles.some((s) => s.id === b.selectedStyleId))
      throw new DomainError("STYLE_NOT_FOUND");
    next.selectedStyleId = b.selectedStyleId;
  }
  if (b.mode) next.mode = b.mode;
  if (b.answers) next.resolvedDecisions = undefined;
  await saveWorld(
    c.env,
    next,
    w.revision,
    "world.revised",
    "Author updated world settings",
  );
  if (b.answers && next.questions.every((q) => q.answer?.trim()))
    await enqueue(c.env, w.id, "resolve", {
      revision: next.revision,
      decisionKey: decisionKey(next),
    });
  return c.json({ world: next });
});
app.patch("/api/worlds/:id/elements/:elementId", async (c) => {
  const b = z
    .object({
      revision: z.number().int(),
      name: z.string().min(1).max(300),
      definition: z.string().min(1).max(5000),
      features: z.record(z.string(), z.string().min(1).max(5000)),
    })
    .parse(await c.req.json());
  const w = await getWorld(c.env, c.req.param("id"));
  assertRevision(w, b.revision);
  if (w.status === "reading") throw new DomainError("SOURCE_INCOMPLETE");
  const next = revised(w);
  const element = next.elements.find((e) => e.id === c.req.param("elementId"));
  if (!element)
    throw new DomainError("ELEMENT_NOT_FOUND", "Element not found", 404);
  element.names.en = b.name;
  element.definition = b.definition;
  for (const [id, text] of Object.entries(b.features)) {
    const feature = element.features.find((f) => f.id === id);
    if (!feature) throw new DomainError("FEATURE_NOT_FOUND");
    if (feature.text !== text) {
      feature.text = text;
      feature.origin = "user";
    }
  }
  await saveWorld(
    c.env,
    next,
    w.revision,
    "element.calibrated",
    "Author calibrated element naming and features",
  );
  return c.json({ world: next });
});
app.post("/api/worlds/:id/chat", async (c) => {
  const b = z
    .object({
      revision: z.number().int(),
      message: z.string().min(1).max(8000),
    })
    .parse(await c.req.json());
  const w = await getWorld(c.env, c.req.param("id"));
  assertRevision(w, b.revision);
  if (w.status === "reading") throw new DomainError("SOURCE_INCOMPLETE");
  const schema = z.object({
    assistant: z.string(),
    proposed: z
      .object({
        summary: z.string(),
        era: z.string(),
        geography: z.string(),
        ecology: z.string(),
        rules: z.array(z.string()),
      })
      .nullable(),
  });
  const result = await usage(
    c.env,
    { world_id: w.id },
    "studio_chat",
    "muse-spark-1.3",
    async () =>
      callJson(
        c.env.MODEL_API_KEY,
        COPILOT,
        {
          world: w,
          history: (await messages(c.env, w.id)).slice(-12),
          message: b.message,
        },
        schema,
      ),
  );
  const next = result.value.proposed
    ? { ...revised(w), ...result.value.proposed }
    : w;
  const stmts = [
    c.env.DB.prepare(
      "INSERT INTO messages(id,world_id,role,content,created_at) VALUES(?,?,?,?,?)",
    ).bind(newId("message"), w.id, "user", b.message, now()),
    c.env.DB.prepare(
      "INSERT INTO messages(id,world_id,role,content,created_at) VALUES(?,?,?,?,?)",
    ).bind(newId("message"), w.id, "assistant", result.value.assistant, now()),
  ];
  await saveWorld(
    c.env,
    next,
    w.revision,
    "studio.conversation",
    result.value.proposed
      ? "World interpretation revised through conversation"
      : "Source-grounded conversation recorded",
    stmts,
  );
  return c.json({ world: next, assistant: result.value.assistant });
});
app.post("/api/worlds/:id/visual-previews", async (c) => {
  const b = z
    .object({
      revision: z.number().int(),
      styleId: z.string(),
      elementId: z.string(),
      feedback: z.string().max(4000).default(""),
    })
    .parse(await c.req.json());
  const w = await getWorld(c.env, c.req.param("id"));
  assertRevision(w, b.revision);
  if (
    w.questions.some((q) => !q.answer?.trim()) ||
    (w.questions.length && w.resolvedDecisions !== decisionKey(w))
  )
    throw new DomainError(
      "SETTINGS_NOT_RESOLVED",
      "Complete and apply the world decisions before visual calibration",
    );
  if (
    !w.elements.some((e) => e.id === b.elementId) ||
    !w.styles.some((s) => s.id === b.styleId)
  )
    throw new DomainError("VISUAL_TARGET_INVALID");
  const jobId = await enqueue(c.env, w.id, "visual", b);
  return c.json({ jobId }, 202);
});
app.post("/api/worlds/:id/visual-approval", async (c) => {
  const b = z
    .object({ revision: z.number().int(), previewId: z.string() })
    .parse(await c.req.json());
  const w = await getWorld(c.env, c.req.param("id"));
  assertRevision(w, b.revision);
  const p = w.previews.find((p) => p.id === b.previewId);
  if (!p || p.revision !== w.revision || p.review.verdict !== "pass")
    throw new DomainError("VISUAL_REVIEW_REQUIRED");
  if (w.selectedStyleId !== p.styleId)
    throw new DomainError(
      "STYLE_MISMATCH",
      "Select this style before approving its current preview",
    );
  w.visualApproval = {
    previewId: p.id,
    revision: w.revision,
    approvedAt: now(),
  };
  await saveWorld(
    c.env,
    w,
    b.revision,
    "visual.approved",
    "Author approved visual calibration",
    [
      c.env.DB.prepare(
        "INSERT INTO approvals(id,world_id,kind,revision,content_hash,created_at) VALUES(?,?,?,?,?,?)",
      ).bind(
        newId("approval"),
        w.id,
        "visual",
        w.revision,
        await sha256(JSON.stringify(p)),
        now(),
      ),
    ],
  );
  return c.json({ world: w });
});
app.post("/api/worlds/:id/confirm", async (c) => {
  const b = z.object({ revision: z.number().int() }).parse(await c.req.json());
  const w = await getWorld(c.env, c.req.param("id"));
  assertRevision(w, b.revision);
  const s = await sourceInfo(c.env, w.sourceId);
  validateConfirmation(w, s.processedCount, s.segmentCount);
  w.status = "confirmed";
  await saveWorld(
    c.env,
    w,
    b.revision,
    "world.confirmed",
    "Author confirmed the world settings",
    [
      c.env.DB.prepare(
        "INSERT INTO approvals(id,world_id,kind,revision,content_hash,created_at) VALUES(?,?,?,?,?,?)",
      ).bind(
        newId("approval"),
        w.id,
        "world",
        w.revision,
        await sha256(JSON.stringify(w)),
        now(),
      ),
    ],
  );
  return c.json({ world: w });
});
app.post("/api/worlds/:id/translations", async (c) => {
  const b = z
    .object({ revision: z.number().int(), locale: z.enum(locales) })
    .parse(await c.req.json());
  const w = await getWorld(c.env, c.req.param("id"));
  assertRevision(w, b.revision);
  if (w.status === "reading") throw new DomainError("SOURCE_INCOMPLETE");
  const jobId = await enqueue(
    c.env,
    w.id,
    "translate",
    {
      ...b,
      translationHash: await translationHash(w.translations[b.locale]),
    },
    Math.max(1, Math.ceil(w.elements.length / 8)) + 1,
  );
  return c.json({ jobId }, 202);
});
const translationInput = z.object({
  locale: z.enum(locales),
  status: z.enum(["draft", "review", "approved", "stale"]),
  sourceRevision: z.number().int(),
  title: z.string().min(1).max(300),
  tagline: z.string().min(1).max(1000),
  introduction: z.string().min(1).max(12000),
  elements: z.record(
    z.string(),
    z.object({
      name: z.string().min(1).max(300),
      definition: z.string().min(1).max(5000),
      features: z.record(z.string(), z.string().min(1).max(5000)),
    }),
  ),
  issues: z.array(z.string()),
  approvedAt: z.string().nullable(),
});
app.patch("/api/worlds/:id/translations/:locale", async (c) => {
  const b = z
    .object({ revision: z.number().int(), translation: translationInput })
    .parse(await c.req.json());
  const locale = z.enum(locales).parse(c.req.param("locale"));
  const w = await getWorld(c.env, c.req.param("id"));
  assertRevision(w, b.revision);
  if (b.translation.locale !== locale) throw new DomainError("LOCALE_MISMATCH");
  const t: Translation = {
    ...b.translation,
    sourceRevision: w.revision,
    status: "draft",
    issues: ["Calibrated text needs a fresh semantic review"],
    approvedAt: null,
  };
  w.translations[locale] = t;
  await saveWorld(
    c.env,
    w,
    b.revision,
    "translation.calibrated",
    `${locale} translation edited by author`,
  );
  return c.json({ world: w });
});
app.post("/api/worlds/:id/translations/:locale/review", async (c) => {
  const b = z.object({ revision: z.number().int() }).parse(await c.req.json());
  const locale = z.enum(locales).parse(c.req.param("locale"));
  const w = await getWorld(c.env, c.req.param("id"));
  assertRevision(w, b.revision);
  return c.json(
    {
      jobId: await enqueue(
        c.env,
        w.id,
        "translation_review",
        {
          revision: w.revision,
          locale,
          translationHash: await translationHash(w.translations[locale]),
        },
        Math.max(1, Math.ceil(w.elements.length / 8)) + 1,
      ),
    },
    202,
  );
});
app.post("/api/worlds/:id/translations/:locale/approve", async (c) => {
  const b = z.object({ revision: z.number().int() }).parse(await c.req.json());
  const locale = z.enum(locales).parse(c.req.param("locale"));
  const w = await getWorld(c.env, c.req.param("id"));
  assertRevision(w, b.revision);
  const t = w.translations[locale];
  if (!t || t.status !== "review")
    throw new DomainError("TRANSLATION_REVIEW_REQUIRED");
  validateLocale(w, t);
  t.status = "approved";
  t.approvedAt = now();
  await saveWorld(
    c.env,
    w,
    b.revision,
    "translation.approved",
    `${locale} translation approved`,
    [
      c.env.DB.prepare(
        "INSERT INTO approvals(id,world_id,kind,revision,content_hash,created_at) VALUES(?,?,?,?,?,?)",
      ).bind(
        newId("approval"),
        w.id,
        `locale:${locale}`,
        w.revision,
        await sha256(JSON.stringify(t)),
        now(),
      ),
    ],
  );
  return c.json({ world: w });
});
app.post("/api/jobs/:id/retry", async (c) => {
  const job = await c.env.DB.prepare(
    "SELECT id,world_id,status FROM jobs WHERE id=?",
  )
    .bind(c.req.param("id"))
    .first<{ id: string; world_id: string; status: string }>();
  if (!job || job.status !== "failed")
    throw new DomainError("JOB_NOT_RETRYABLE");
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE jobs SET status='queued',error=NULL,lease_until=NULL,updated_at=? WHERE id=?",
    ).bind(now(), job.id),
    c.env.DB.prepare(
      "INSERT INTO outbox(id,job_id,created_at) VALUES(?,?,?)",
    ).bind(newId("outbox"), job.id, now()),
    auditStatement(
      c.env,
      job.world_id,
      "job.retry",
      "Retry requested from saved checkpoint",
    ),
  ]);
  await deliverOutbox(c.env);
  return c.json({ jobId: job.id }, 202);
});
app.route("/api", siteRoutes);
app.get("/media/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT world_id,object_key,content_type FROM assets WHERE id=?",
  )
    .bind(id)
    .first<{ world_id: string; object_key: string; content_type: string }>();
  if (!row) return c.notFound();
  if (!(await authenticated(c))) {
    const { results } = await c.env.DB.prepare(
      "SELECT content_json FROM releases WHERE world_id=? AND status='active'",
    )
      .bind(row.world_id)
      .all<{ content_json: string }>();
    if (
      !results.some((r) =>
        Object.values(
          JSON.parse(r.content_json) as Record<string, PublicWorld>,
        ).some((p) => p.imageUrl === `/media/${id}`),
      )
    )
      return c.notFound();
  }
  const obj = await c.env.STORAGE.get(row.object_key);
  if (!obj) return c.notFound();
  return new Response(obj.body, {
    headers: {
      "Content-Type": row.content_type,
      "Cache-Control": "private,max-age=60",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
app.all("/api/*", (c) =>
  c.json({ error: { code: "NOT_FOUND", message: "API route not found" } }, 404),
);
app.all("*", async (c) => {
  const response = await c.env.ASSETS.fetch(c.req.raw);
  const headers = new Headers(response.headers);
  if (!/^\/(en|zh-Hant|ja)\/worlds\//.test(c.req.path))
    headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
export default {
  fetch: app.fetch,
  queue: consumeJobs,
  scheduled: async (
    _event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) => {
    ctx.waitUntil(deliverOutbox(env));
  },
} satisfies ExportedHandler<Env, JobMessage>;
export { app };
