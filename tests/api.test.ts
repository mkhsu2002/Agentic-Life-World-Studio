import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { app } from "../src/server/index";
import { saveWorld, getWorld } from "../src/server/repository";
import type { Env } from "../src/server/env";
import type { WorldDraft } from "../src/shared/contracts";
let sqlite: DatabaseSync, env: Env;
class Statement {
  values: unknown[] = [];
  constructor(public sql: string) {}
  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }
  execute() {
    const query = sqlite.prepare(this.sql);
    if (/^\s*(SELECT|PRAGMA)/i.test(this.sql)) {
      const results = query.all(...(this.values as never[]));
      return { success: true, results, meta: { changes: 0 } };
    }
    const result = query.run(...(this.values as never[]));
    return {
      success: true,
      results: [],
      meta: { changes: Number(result.changes) },
    };
  }
  async run() {
    return this.execute();
  }
  async all() {
    return this.execute();
  }
  async first(column?: string) {
    const result = this.execute().results[0] as
      Record<string, unknown> | undefined;
    return column ? result?.[column] : result || null;
  }
}
const fixture = (): WorldDraft => ({
  id: "w",
  recordVersion: 1,
  title: "A source world",
  revision: 1,
  status: "draft",
  sourceId: "s",
  summary: "Source-supported summary",
  era: "unknown",
  geography: "unknown",
  ecology: "unknown",
  rules: [],
  elements: [
    {
      id: "e",
      kind: "place",
      sourceName: "Source Place",
      names: { en: "Source Place", "zh-Hant": "來源地", ja: "場所" },
      definition: "A place",
      features: [],
      aliases: [],
    },
  ],
  questions: [],
  styles: [],
  selectedStyleId: null,
  visualApproval: null,
  mode: "landscape",
  translations: {},
  previews: [],
  createdAt: "now",
  updatedAt: "now",
});
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync("migrations/0001_studio.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0002_job_keys.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0003_active_jobs.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0004_import_dialogue.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0005_world_framework.sql", "utf8"));
  const db = {
    prepare: (sql: string) => new Statement(sql),
    batch: async (statements: Statement[]) => {
      sqlite.exec("BEGIN");
      try {
        const out = statements.map((s) => s.execute());
        sqlite.exec("COMMIT");
        return out;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  };
  env = {
    DB: db as unknown as D1Database,
    STORAGE: {} as R2Bucket,
    JOBS: {} as Queue,
    ASSETS: { fetch: async () => new Response("app") } as unknown as Fetcher,
    MODEL_API_KEY: "",
    STUDIO_PASSWORD: "test-password",
    SESSION_SECRET: "test-session-secret-at-least-32-bytes",
    ENVIRONMENT: "test",
    BUILD_REVISION: "test",
  };
  sqlite
    .prepare(
      "INSERT INTO sources(id,title,kind,sha256,char_count,segment_count,created_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run("s", "Source", "text", "0".repeat(64), 10, 1, "now");
  sqlite
    .prepare(
      "INSERT INTO worlds(id,source_id,revision,document_json,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    )
    .run("w", "s", 1, JSON.stringify(fixture()), "now", "now");
});
afterEach(() => {
  vi.unstubAllGlobals();
  sqlite.close();
});
async function cookie() {
  return (
    "world_studio_session=" +
    (await new SignJWT({ sub: "owner" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("world-studio")
      .setAudience("studio-owner")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(env.SESSION_SECRET)))
  );
}
it("rejects private source reads without a valid session", async () => {
  const res = await app.request("/api/worlds/w", {}, env);
  expect(res.status).toBe(401);
});
it("rejects cross-origin writes before mutating data", async () => {
  const res = await app.request(
    "https://studio.test/api/worlds/w",
    {
      method: "PATCH",
      headers: {
        Cookie: await cookie(),
        Origin: "https://evil.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ revision: 1, mode: "mixed" }),
    },
    env,
  );
  expect(res.status).toBe(403);
  expect((await getWorld(env, "w")).revision).toBe(1);
});
it("atomically updates world, element registry, terms and audit", async () => {
  const w = await getWorld(env, "w");
  w.elements[0].definition = "Updated feature definition";
  w.revision = 2;
  await saveWorld(env, w, 1, "world.updated", "Updated");
  expect((await getWorld(env, "w")).revision).toBe(2);
  const row = sqlite
    .prepare("SELECT document_json FROM elements WHERE id=?")
    .get("e") as { document_json: string };
  expect(JSON.parse(row.document_json).definition).toBe(
    "Updated feature definition",
  );
  expect(
    (sqlite.prepare("SELECT COUNT(*) AS n FROM terms").get() as { n: number })
      .n,
  ).toBe(3);
  expect(
    (sqlite.prepare("SELECT COUNT(*) AS n FROM audit").get() as { n: number })
      .n,
  ).toBe(1);
});
it("rejects concurrent metadata writes even when content revision is unchanged", async () => {
  const a = await getWorld(env, "w"),
    b = await getWorld(env, "w");
  a.mode = "ecology";
  await saveWorld(env, a, 1, "a", "first");
  b.mode = "mixed";
  await expect(saveWorld(env, b, 1, "b", "stale")).rejects.toMatchObject({
    code: "REVISION_CONFLICT",
  });
  expect((await getWorld(env, "w")).mode).toBe("ecology");
  expect(
    (sqlite.prepare("SELECT COUNT(*) AS n FROM audit").get() as { n: number })
      .n,
  ).toBe(1);
  expect(
    (
      sqlite.prepare("SELECT COUNT(*) AS n FROM mutation_guards").get() as {
        n: number;
      }
    ).n,
  ).toBe(0);
});
it("serves only active public editions and does not expose source data", async () => {
  const res = await app.request("/api/public/en/unpublished", {}, env);
  expect(res.status).toBe(404);
  expect(await res.text()).not.toContain("Source-supported summary");
});
it("requires fresh semantic review after editing a translation", async () => {
  const w = await getWorld(env, "w");
  w.translations.en = {
    locale: "en",
    status: "approved",
    sourceRevision: 1,
    title: "World",
    tagline: "Discover",
    introduction: "A world",
    elements: { e: { name: "Place", definition: "A place", features: {} } },
    issues: [],
    approvedAt: "now",
  };
  await saveWorld(env, w, 1, "seed", "seed");
  const t = { ...w.translations.en, title: "Changed" };
  const res = await app.request(
    "/api/worlds/w/translations/en",
    {
      method: "PATCH",
      headers: { Cookie: await cookie(), "Content-Type": "application/json" },
      body: JSON.stringify({ revision: 1, translation: t }),
    },
    env,
  );
  expect(res.status).toBe(200);
  const updated = await getWorld(env, "w");
  expect(updated.translations.en?.status).toBe("draft");
  expect(updated.translations.en?.issues.length).toBeGreaterThan(0);
});

it("rejects a stale website preview when another world now owns the slug", async () => {
  const w = await getWorld(env, "w");
  w.status = "confirmed";
  w.selectedStyleId = "style";
  w.styles = [
    {
      id: "style",
      name: "Style",
      description: "A style",
      medium: "illustration",
      palette: ["#223344"],
      lighting: "soft",
      materials: [],
      forbidden: [],
      evidence: [],
    },
  ];
  w.previews = [
    {
      id: "preview",
      styleId: "style",
      elementId: "e",
      assetId: "asset",
      revision: 1,
      feedback: "",
      review: { verdict: "pass", notes: [] },
      createdAt: "now",
    },
  ];
  w.visualApproval = { previewId: "preview", revision: 1, approvedAt: "now" };
  w.translations.en = {
    locale: "en",
    status: "approved",
    sourceRevision: 1,
    title: "World",
    tagline: "Discover",
    introduction: "A world",
    elements: { e: { name: "Place", definition: "A place", features: {} } },
    issues: [],
    approvedAt: "now",
  };
  const { frameworkFixture } = await import("./fixtures/world-framework");
  const { frameworkHash } = await import("../src/server/world-framework");
  w.framework = frameworkFixture();
  w.frameworkApproval = {
    hash: await frameworkHash(w),
    revision: w.revision,
    approvedAt: "now",
  };
  await saveWorld(env, w, 1, "seed", "seed");
  sqlite.prepare("UPDATE sources SET processed_count=1 WHERE id=?").run("s");
  const auth = { Cookie: await cookie(), "Content-Type": "application/json" };
  const candidate = await app.request(
    "/api/worlds/w/site-previews",
    {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ revision: 1, slug: "shared", locales: ["en"] }),
    },
    env,
  );
  expect(candidate.status).toBe(201);
  const { preview } = (await candidate.json()) as { preview: { id: string } };
  sqlite
    .prepare(
      "INSERT INTO worlds(id,source_id,revision,document_json,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    )
    .run(
      "other",
      "s",
      1,
      JSON.stringify({ ...fixture(), id: "other" }),
      "now",
      "now",
    );
  sqlite
    .prepare(
      "INSERT INTO releases(id,world_id,slug,revision,status,locales_json,content_json,hash,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "active-other",
      "other",
      "shared",
      1,
      "active",
      '["en"]',
      "{}",
      "hash",
      "now",
    );
  const response = await app.request(
    "/api/worlds/w/releases",
    {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        revision: 1,
        slug: "shared",
        locales: ["en"],
        previewId: preview.id,
      }),
    },
    env,
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    error: { code: "SLUG_UNAVAILABLE" },
  });
  expect(
    (
      sqlite
        .prepare("SELECT status FROM releases WHERE id=?")
        .get("active-other") as { status: string }
    ).status,
  ).toBe("active");
});

it("replays a mutation key without creating another audit entry", async () => {
  const headers = {
    Cookie: await cookie(),
    "Content-Type": "application/json",
    "Idempotency-Key": "operation_test_001",
  };
  const request = {
    method: "PATCH",
    headers,
    body: JSON.stringify({ revision: 1, mode: "ecology" }),
  };
  const first = await app.request("/api/worlds/w", request, env),
    again = await app.request("/api/worlds/w", request, env);
  expect(first.status).toBe(200);
  expect(again.status).toBe(200);
  expect((await getWorld(env, "w")).revision).toBe(2);
  expect(
    (sqlite.prepare("SELECT COUNT(*) AS n FROM audit").get() as { n: number })
      .n,
  ).toBe(1);
});

it("blocks setting chat during incomplete import without using the provider", async () => {
  const w = await getWorld(env, "w");
  w.status = "reading";
  await saveWorld(env, w, 1, "seed", "seed");
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const response = await app.request(
    "/api/worlds/w/chat",
    {
      method: "POST",
      headers: { Cookie: await cookie(), "Content-Type": "application/json" },
      body: JSON.stringify({ revision: 1, message: "Change the era" }),
    },
    env,
  );
  expect(response.status).toBe(409);
  expect(fetcher).not.toHaveBeenCalled();
  expect((await getWorld(env, "w")).status).toBe("reading");
});

it.each([false, true])(
  "records chat consumption independently of provider success: failure=%s",
  async (failure) => {
    env.MODEL_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        failure
          ? Response.json(
              { error: { code: "test_unavailable" } },
              { status: 503 },
            )
          : Response.json({
              choices: [
                {
                  finish_reason: "stop",
                  message: {
                    content: JSON.stringify({
                      assistant: "Source-grounded reply",
                      proposed: null,
                    }),
                  },
                },
              ],
              usage: { prompt_tokens: 100, completion_tokens: 30 },
            }),
      ),
    );
    const response = await app.request(
      "/api/worlds/w/chat",
      {
        method: "POST",
        headers: { Cookie: await cookie(), "Content-Type": "application/json" },
        body: JSON.stringify({ revision: 1, message: "Explain this place" }),
      },
      env,
    );
    expect(response.status).toBe(failure ? 502 : 200);
    const ledger = sqlite.prepare("SELECT * FROM usage_ledger").all() as {
      status: string;
      input_tokens: number;
      output_tokens: number;
    }[];
    expect(ledger).toHaveLength(1);
    expect(ledger[0].status).toBe(failure ? "uncertain" : "incurred");
    if (!failure)
      expect(ledger[0]).toMatchObject({ input_tokens: 100, output_tokens: 30 });
  },
);

it("grants one publisher exclusive ownership of a website preview", async () => {
  const w = await getWorld(env, "w");
  w.status = "confirmed";
  w.selectedStyleId = "style";
  w.styles = [
    {
      id: "style",
      name: "Style",
      description: "A style",
      medium: "illustration",
      palette: ["#223344"],
      lighting: "soft",
      materials: [],
      forbidden: [],
      evidence: [],
    },
  ];
  w.previews = [
    {
      id: "preview",
      styleId: "style",
      elementId: "e",
      assetId: "asset",
      revision: 1,
      feedback: "",
      review: { verdict: "pass", notes: [] },
      createdAt: "now",
    },
  ];
  w.visualApproval = { previewId: "preview", revision: 1, approvedAt: "now" };
  w.translations.en = {
    locale: "en",
    status: "approved",
    sourceRevision: 1,
    title: "World",
    tagline: "Discover",
    introduction: "A world",
    elements: { e: { name: "Place", definition: "A place", features: {} } },
    issues: [],
    approvedAt: "now",
  };
  const { frameworkFixture } = await import("./fixtures/world-framework");
  const { frameworkHash } = await import("../src/server/world-framework");
  w.framework = frameworkFixture();
  w.frameworkApproval = {
    hash: await frameworkHash(w),
    revision: w.revision,
    approvedAt: "now",
  };
  await saveWorld(env, w, 1, "seed", "seed");
  sqlite.prepare("UPDATE sources SET processed_count=1 WHERE id=?").run("s");

  const auth = { Cookie: await cookie(), "Content-Type": "application/json" };
  const candidate = await app.request(
    "/api/worlds/w/site-previews",
    {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ revision: 1, slug: "parallel", locales: ["en"] }),
    },
    env,
  );
  const { preview } = (await candidate.json()) as { preview: { id: string } };
  await app.request(
    `/api/site-previews/${preview.id}/en`,
    { headers: auth },
    env,
  );
  const { sha256 } = await import("../src/server/domain");
  const image = new Uint8Array([1, 2, 3, 4]);
  const hash = await sha256(image.buffer);
  let unblock!: () => void, started!: () => void;
  const startedPromise = new Promise<void>((r) => (started = r)),
    gate = new Promise<void>((r) => (unblock = r));
  let reads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/readback/")) {
        reads++;
        if (reads > 1)
          return new Response("transient readback failure", { status: 503 });
        started();
        await gate;
        return app.request(url, {}, env);
      }
      if (url.includes("/artwork/"))
        return new Response(image, {
          headers: { "Content-Type": "image/png", "X-Asset-SHA256": hash },
        });
      return new Response(
        '<div id="root"></div><script src="/assets/app.js"></script>',
      );
    }),
  );
  const request = {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      revision: 1,
      slug: "parallel",
      locales: ["en"],
      previewId: preview.id,
    }),
  };
  const first = app.request(
    "https://studio.test/api/worlds/w/releases",
    request,
    env,
  );
  const second = app.request(
    "https://studio.test/api/worlds/w/releases",
    request,
    env,
  );
  await startedPromise;
  unblock();
  const responses = await Promise.all([first, second]);
  expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
  expect(reads).toBe(1);
  expect(
    sqlite.prepare("SELECT status FROM releases WHERE id=?").get(preview.id),
  ).toMatchObject({ status: "active" });
  expect((await app.request("/api/public/en/parallel", {}, env)).status).toBe(
    200,
  );
});

async function seedImport() {
  const w = await getWorld(env, "w");
  w.status = "reading";
  await saveWorld(env, w, 1, "seed", "seed");
  sqlite
    .prepare(
      "INSERT INTO segments(id,source_id,ordinal,start_offset,end_offset,text_key) VALUES('s1','s',0,0,30,'segment.txt')",
    )
    .run();
  sqlite
    .prepare(
      "INSERT INTO jobs(id,world_id,kind,status,stage,total,payload_json,created_at,updated_at) VALUES('import-job','w','import','queued','reading',2,'{}','now','now')",
    )
    .run();
  const objects = new Map<string, string>([
    ["segment.txt", "The silver bridge spans a dry valley."],
    ["sources/s/original.txt", "The silver bridge spans a dry valley."],
  ]);
  env.STORAGE = {
    get: vi.fn(async (key: string) =>
      objects.has(key)
        ? {
            text: async () => objects.get(key)!,
            json: async () => JSON.parse(objects.get(key)!),
          }
        : null,
    ),
    put: vi.fn(async (key: string, data: string) => {
      objects.set(key, data);
    }),
    delete: vi.fn(async (key: string) => objects.delete(key)),
  } as unknown as R2Bucket;
  env.JOBS = { send: vi.fn(async () => {}) } as unknown as Queue;
  env.MODEL_API_KEY = "test-key";
  return objects;
}
const unsupportedCandidate = () => ({
  elements: [
    {
      key: "bridge",
      kind: "place",
      sourceName: "Bridge",
      englishName: "Bridge",
      definition: "A bridge over water",
      aliases: [],
      features: [
        {
          id: "water",
          text: "A river flows beneath",
          quote: "river flows",
          segmentId: "s1",
          origin: "source",
          locked: false,
        },
      ],
    },
  ],
  facts: [],
  warnings: [],
  guidance: ["請補充你希望採用的年代範圍。"],
});
function modelResult(value: unknown) {
  return Response.json({
    choices: [
      { finish_reason: "stop", message: { content: JSON.stringify(value) } },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 20 },
  });
}
it("turns exhausted evidence repairs into a durable dialogue without counting unread source", async () => {
  await seedImport();
  const fetcher = vi.fn(async () => modelResult(unsupportedCandidate()));
  vi.stubGlobal("fetch", fetcher);
  const { processJob } = await import("../src/server/jobs");
  await processJob(env, "import-job");
  expect(
    sqlite
      .prepare("SELECT status,completed,error FROM jobs WHERE id='import-job'")
      .get(),
  ).toMatchObject({ status: "waiting_user", completed: 0, error: null });
  expect(
    sqlite.prepare("SELECT processed_count FROM sources WHERE id='s'").get(),
  ).toMatchObject({ processed_count: 0 });
  expect(
    sqlite.prepare("SELECT status FROM segments WHERE id='s1'").get(),
  ).toMatchObject({ status: "queued" });
  expect(
    sqlite.prepare("SELECT kind,status FROM import_reviews").get(),
  ).toMatchObject({ kind: "evidence", status: "open" });
  expect(
    sqlite
      .prepare("SELECT COUNT(*) AS n FROM messages WHERE role='assistant'")
      .get(),
  ).toMatchObject({ n: 1 });
  expect(
    sqlite
      .prepare("SELECT COUNT(*) AS n FROM usage_ledger WHERE status='incurred'")
      .get(),
  ).toMatchObject({ n: 3 });
  await processJob(env, "import-job");
  expect(fetcher).toHaveBeenCalledTimes(3);
  const detail = await app.request(
    "/api/worlds/w",
    { headers: { Cookie: await cookie() } },
    env,
  );
  expect(await detail.json()).toMatchObject({
    importReview: {
      kind: "evidence",
      sourceText: "The silver bridge spans a dry valley.",
      problems: [{ id: "element:0:feature:0" }],
    },
  });
});
it("records author decisions, audit and outbox once before continuing the saved import", async () => {
  await seedImport();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => modelResult(unsupportedCandidate())),
  );
  const { processJob } = await import("../src/server/jobs");
  await processJob(env, "import-job");
  const review = sqlite.prepare("SELECT id FROM import_reviews").get() as {
    id: string;
  };
  const auth = { Cookie: await cookie(), "Content-Type": "application/json" };
  const req = {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      revision: 1,
      decisions: {
        "element:0:feature:0": {
          action: "author_confirm",
          text: "A seasonal river once flowed here",
        },
      },
      message: "這是我補充的歷史設定",
    }),
  };
  const first = await app.request(
    `/api/worlds/w/import-reviews/${review.id}/resolve`,
    req,
    env,
  );
  expect(first.status).toBe(202);
  const again = await app.request(
    `/api/worlds/w/import-reviews/${review.id}/resolve`,
    req,
    env,
  );
  expect(again.status).toBe(409);
  expect(
    sqlite
      .prepare("SELECT status,completed FROM jobs WHERE id='import-job'")
      .get(),
  ).toMatchObject({ status: "queued", completed: 1 });
  expect(
    sqlite.prepare("SELECT processed_count FROM sources WHERE id='s'").get(),
  ).toMatchObject({ processed_count: 1 });
  const segment = sqlite
    .prepare("SELECT result_json FROM segments WHERE id='s1'")
    .get() as { result_json: string };
  expect(JSON.parse(segment.result_json).elements[0].features[0]).toMatchObject(
    { origin: "user", quote: "", text: "A seasonal river once flowed here" },
  );
  expect(
    sqlite.prepare("SELECT COUNT(*) AS n FROM outbox").get(),
  ).toMatchObject({ n: 1 });
  expect(
    sqlite
      .prepare(
        "SELECT COUNT(*) AS n FROM audit WHERE type='import.review_resolved'",
      )
      .get(),
  ).toMatchObject({ n: 1 });
  expect(
    sqlite
      .prepare("SELECT COUNT(*) AS n FROM messages WHERE role='user'")
      .get(),
  ).toMatchObject({ n: 1 });
});
it("keeps an import pending when a replacement quote cannot be found", async () => {
  await seedImport();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => modelResult(unsupportedCandidate())),
  );
  const { processJob } = await import("../src/server/jobs");
  await processJob(env, "import-job");
  const review = sqlite.prepare("SELECT id FROM import_reviews").get() as {
    id: string;
  };
  const response = await app.request(
    `/api/worlds/w/import-reviews/${review.id}/resolve`,
    {
      method: "POST",
      headers: { Cookie: await cookie(), "Content-Type": "application/json" },
      body: JSON.stringify({
        revision: 1,
        decisions: {
          "element:0:feature:0": {
            action: "replace_quote",
            quote: "invented words",
          },
        },
      }),
    },
    env,
  );
  expect(response.status).toBe(409);
  expect(
    sqlite.prepare("SELECT status FROM jobs WHERE id='import-job'").get(),
  ).toMatchObject({ status: "waiting_user" });
  expect(
    sqlite.prepare("SELECT COUNT(*) AS n FROM outbox").get(),
  ).toMatchObject({ n: 0 });
});
it("accepts an initial author brief without ending reading or claiming analysis completed", async () => {
  await seedImport();
  const response = await app.request(
    "/api/worlds/w/import-brief",
    {
      method: "PATCH",
      headers: { Cookie: await cookie(), "Content-Type": "application/json" },
      body: JSON.stringify({
        revision: 1,
        brief: {
          timeframe: "Before the flood",
          scope: "Valley landscapes",
          visualStyle: "Ink",
          notes: "Do not add a river",
        },
      }),
    },
    env,
  );
  expect(response.status).toBe(200);
  const w = await getWorld(env, "w");
  expect(w.status).toBe("reading");
  expect(w.revision).toBe(1);
  expect(w.importBrief).toMatchObject({
    timeframe: "Before the flood",
    notes: "Do not add a river",
  });
  expect(w.importBrief?.confirmedAt).toBeTruthy();
  expect(
    sqlite
      .prepare("SELECT COUNT(*) AS n FROM messages WHERE role='user'")
      .get(),
  ).toMatchObject({ n: 1 });
});
it("offers a persistent retry conversation for a provider failure during source reading", async () => {
  await seedImport();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        { error: { code: "temporary_unavailable" } },
        { status: 503 },
      ),
    ),
  );
  const { processJob } = await import("../src/server/jobs");
  await processJob(env, "import-job");
  expect(
    sqlite.prepare("SELECT status FROM jobs WHERE id='import-job'").get(),
  ).toMatchObject({ status: "waiting_user" });
  expect(
    sqlite.prepare("SELECT kind,status FROM import_reviews").get(),
  ).toMatchObject({ kind: "processing", status: "open" });
  expect(sqlite.prepare("SELECT status FROM usage_ledger").get()).toMatchObject(
    { status: "uncertain" },
  );
});

it("requires the initial direction form before compilation and consumes the latest confirmed brief", async () => {
  await seedImport();
  const valid = unsupportedCandidate();
  valid.elements[0].features[0].quote = "silver bridge";
  valid.elements[0].features[0].text = "Silver bridge";
  sqlite
    .prepare("UPDATE segments SET status='done',result_json=? WHERE id='s1'")
    .run(JSON.stringify(valid));
  sqlite.prepare("UPDATE sources SET processed_count=1 WHERE id='s'").run();
  sqlite.prepare("UPDATE jobs SET completed=1 WHERE id='import-job'").run();
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const { processJob } = await import("../src/server/jobs");
  await processJob(env, "import-job");
  expect(fetcher).not.toHaveBeenCalled();
  expect(sqlite.prepare("SELECT kind FROM import_reviews").get()).toMatchObject(
    { kind: "brief" },
  );
  const review = sqlite.prepare("SELECT id FROM import_reviews").get() as {
    id: string;
  };
  const response = await app.request(
    `/api/worlds/w/import-reviews/${review.id}/resolve`,
    {
      method: "POST",
      headers: { Cookie: await cookie(), "Content-Type": "application/json" },
      body: JSON.stringify({
        revision: 1,
        decisions: {},
        brief: {
          timeframe: "Before the flood",
          scope: "Only the valley",
          visualStyle: "Woodcut",
          notes: "Use author notes separately",
        },
      }),
    },
    env,
  );
  expect(response.status).toBe(202);
  const style = {
    id: "s",
    name: "Style",
    description: "Style",
    medium: "woodcut",
    palette: ["#223344"],
    lighting: "soft",
    materials: [],
    forbidden: [],
    evidence: [],
  };
  fetcher.mockImplementation(async () =>
    modelResult({
      title: "Valley",
      summary: "A dry valley with a silver bridge",
      era: "Before the flood",
      geography: "Valley",
      ecology: "Unknown",
      rules: [],
      questions: [],
      styles: [style, { ...style, id: "s2" }, { ...style, id: "s3" }],
    }),
  );
  await processJob(env, "import-job");
  expect(await getWorld(env, "w")).toMatchObject({
    status: "draft",
    era: "Before the flood",
    importBrief: { scope: "Only the valley" },
  });
  const request = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  const context = JSON.parse(
    JSON.parse(String(request[1].body)).messages[1].content,
  );
  expect(context.authorBrief).toMatchObject({
    timeframe: "Before the flood",
    visualStyle: "Woodcut",
  });
  expect(
    sqlite
      .prepare("SELECT status,completed FROM jobs WHERE id='import-job'")
      .get(),
  ).toMatchObject({ status: "succeeded", completed: 2 });
});
it("upgrades a prior failed import into a dialogue using the saved evidence checkpoint without model calls", async () => {
  const objects = await seedImport();
  objects.set(
    "jobs/import-job/segment-0-repair-1.json",
    JSON.stringify({ output: unsupportedCandidate() }),
  );
  sqlite
    .prepare(
      "UPDATE jobs SET status='failed',error='EVIDENCE_QUOTE_INVALID: old failure' WHERE id='import-job'",
    )
    .run();
  sqlite.exec(readFileSync("migrations/0004_import_dialogue.sql", "utf8"));
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const response = await app.request(
    "/api/worlds/w",
    { headers: { Cookie: await cookie() } },
    env,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    importReview: {
      kind: "evidence",
      problems: [{ id: "element:0:feature:0" }],
    },
    jobs: [{ status: "waiting_user", completed: 0 }],
  });
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    sqlite
      .prepare("SELECT COUNT(*) AS n FROM messages WHERE role='assistant'")
      .get(),
  ).toMatchObject({ n: 1 });
});
it("stores clarification from the retry dialogue as author context without silently confirming the initial form", async () => {
  await seedImport();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ error: { code: "temporary" } }, { status: 503 }),
    ),
  );
  const { processJob } = await import("../src/server/jobs");
  await processJob(env, "import-job");
  const review = sqlite.prepare("SELECT id FROM import_reviews").get() as {
    id: string;
  };
  const response = await app.request(
    `/api/worlds/w/import-reviews/${review.id}/resolve`,
    {
      method: "POST",
      headers: { Cookie: await cookie(), "Content-Type": "application/json" },
      body: JSON.stringify({
        revision: 1,
        decisions: {},
        message: "只處理小說正文，附錄保留參考",
      }),
    },
    env,
  );
  expect(response.status).toBe(202);
  expect((await getWorld(env, "w")).importBrief).toMatchObject({
    notes: "只處理小說正文，附錄保留參考",
    confirmedAt: null,
  });
});
it("atomically accepts only one concurrent resolution and emits one continuation", async () => {
  await seedImport();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => modelResult(unsupportedCandidate())),
  );
  const { processJob } = await import("../src/server/jobs");
  await processJob(env, "import-job");
  const review = sqlite.prepare("SELECT id FROM import_reviews").get() as {
    id: string;
  };
  const auth = { Cookie: await cookie(), "Content-Type": "application/json" };
  const request = {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      revision: 1,
      decisions: { "element:0:feature:0": { action: "author_confirm" } },
    }),
  };
  const responses = await Promise.all([
    app.request(
      `/api/worlds/w/import-reviews/${review.id}/resolve`,
      request,
      env,
    ),
    app.request(
      `/api/worlds/w/import-reviews/${review.id}/resolve`,
      request,
      env,
    ),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([202, 409]);
  expect(
    sqlite.prepare("SELECT COUNT(*) AS n FROM outbox").get(),
  ).toMatchObject({ n: 1 });
  expect(
    sqlite
      .prepare(
        "SELECT COUNT(*) AS n FROM audit WHERE type='import.review_resolved'",
      )
      .get(),
  ).toMatchObject({ n: 1 });
});

it("retains candidate evidence in a dialogue when a later repair request fails", async () => {
  await seedImport();
  const first = unsupportedCandidate();
  first.elements[0].features.unshift({
    id: "material",
    text: "Silver bridge",
    quote: "silver bridge",
    segmentId: "s1",
    origin: "source",
    locked: false,
  });
  let calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      ++calls === 1
        ? modelResult(first)
        : Response.json({ error: { code: "temporary" } }, { status: 503 }),
    ),
  );
  const { processJob } = await import("../src/server/jobs");
  await processJob(env, "import-job");
  const response = await app.request(
    "/api/worlds/w",
    { headers: { Cookie: await cookie() } },
    env,
  );
  expect(await response.json()).toMatchObject({
    importReview: {
      kind: "evidence",
      problems: [{ id: "element:0:feature:1" }],
    },
  });
  expect(calls).toBe(2);
});
it("does not allow a delayed queue worker to claim an import now awaiting the author", async () => {
  await seedImport();
  const fetcher = vi.fn(async () => modelResult(unsupportedCandidate()));
  vi.stubGlobal("fetch", fetcher);
  const prepare = env.DB.prepare.bind(env.DB);
  let count = 0,
    release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  env.DB.prepare = ((sql: string) => {
    const stmt = prepare(sql);
    if (sql.includes("SET status='running',lease_until")) {
      const run = stmt.run.bind(stmt);
      stmt.run = (async () => {
        if (++count === 2) await gate;
        return run();
      }) as typeof stmt.run;
    }
    return stmt;
  }) as typeof env.DB.prepare;
  const { processJob } = await import("../src/server/jobs");
  const a = processJob(env, "import-job"),
    b = processJob(env, "import-job");
  await a;
  release();
  await b;
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(
    sqlite.prepare("SELECT status FROM jobs WHERE id='import-job'").get(),
  ).toMatchObject({ status: "waiting_user" });
  expect(
    sqlite.prepare("SELECT processed_count FROM sources WHERE id='s'").get(),
  ).toMatchObject({ processed_count: 0 });
});

it("reuses verified extraction after a storage-stage failure without billing another model call", async () => {
  await seedImport();
  const valid = unsupportedCandidate();
  valid.elements[0].features[0].quote = "silver bridge";
  valid.elements[0].features[0].text = "Silver bridge";
  const fetcher = vi.fn(async () => modelResult(valid));
  vi.stubGlobal("fetch", fetcher);
  const batch = env.DB.batch.bind(env.DB);
  let failed = false;
  env.DB.batch = (async (statements: D1PreparedStatement[]) => {
    if (
      !failed &&
      statements.some((s) =>
        (s as unknown as Statement).sql.startsWith(
          "UPDATE segments SET result_json",
        ),
      )
    ) {
      failed = true;
      throw new Error("transient database write");
    }
    return batch(statements);
  }) as typeof env.DB.batch;
  const { processJob } = await import("../src/server/jobs");
  await processJob(env, "import-job");
  expect(
    sqlite.prepare("SELECT status FROM jobs WHERE id='import-job'").get(),
  ).toMatchObject({ status: "waiting_user" });
  const review = sqlite.prepare("SELECT id FROM import_reviews").get() as {
    id: string;
  };
  const response = await app.request(
    `/api/worlds/w/import-reviews/${review.id}/resolve`,
    {
      method: "POST",
      headers: { Cookie: await cookie(), "Content-Type": "application/json" },
      body: JSON.stringify({ revision: 1, decisions: {} }),
    },
    env,
  );
  expect(response.status).toBe(202);
  await processJob(env, "import-job");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(
    sqlite.prepare("SELECT processed_count FROM sources WHERE id='s'").get(),
  ).toMatchObject({ processed_count: 1 });
  expect(
    sqlite.prepare("SELECT COUNT(*) AS n FROM usage_ledger").get(),
  ).toMatchObject({ n: 1 });
});

it("commits compiled world and import completion together or retains a resumable reading state", async () => {
  await seedImport();
  const w = await getWorld(env, "w");
  w.importBrief = {
    timeframe: "",
    scope: "",
    visualStyle: "",
    notes: "",
    confirmedAt: "now",
  };
  await saveWorld(env, w, 1, "seed-brief", "seed");
  const valid = unsupportedCandidate();
  valid.elements[0].features[0].quote = "silver bridge";
  valid.elements[0].features[0].text = "Silver bridge";
  sqlite
    .prepare("UPDATE segments SET status='done',result_json=? WHERE id='s1'")
    .run(JSON.stringify(valid));
  sqlite.prepare("UPDATE sources SET processed_count=1 WHERE id='s'").run();
  sqlite.prepare("UPDATE jobs SET completed=1 WHERE id='import-job'").run();
  const style = {
    id: "s",
    name: "Style",
    description: "Style",
    medium: "woodcut",
    palette: ["#223344"],
    lighting: "soft",
    materials: [],
    forbidden: [],
    evidence: [],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      modelResult({
        title: "Valley",
        summary: "A dry valley",
        era: "unknown",
        geography: "Valley",
        ecology: "unknown",
        rules: [],
        questions: [],
        styles: [style, { ...style, id: "s2" }, { ...style, id: "s3" }],
      }),
    ),
  );
  const batch = env.DB.batch.bind(env.DB);
  let failed = false;
  env.DB.batch = (async (statements: D1PreparedStatement[]) => {
    if (
      !failed &&
      statements.some((s) =>
        (s as unknown as Statement).sql.includes("SET status='succeeded'"),
      )
    ) {
      failed = true;
      throw new Error("transient completion write");
    }
    return batch(statements);
  }) as typeof env.DB.batch;
  const { processJob } = await import("../src/server/jobs");
  await processJob(env, "import-job");
  expect((await getWorld(env, "w")).status).toBe("reading");
  expect(
    sqlite.prepare("SELECT status FROM jobs WHERE id='import-job'").get(),
  ).toMatchObject({ status: "waiting_user" });
  const review = sqlite.prepare("SELECT id FROM import_reviews").get() as {
    id: string;
  };
  const response = await app.request(
    `/api/worlds/w/import-reviews/${review.id}/resolve`,
    {
      method: "POST",
      headers: { Cookie: await cookie(), "Content-Type": "application/json" },
      body: JSON.stringify({ revision: 1, decisions: {} }),
    },
    env,
  );
  expect(response.status).toBe(202);
});

it("keeps completed-world legacy import failures retryable instead of creating an unresolvable review", async () => {
  await seedImport();
  const w = await getWorld(env, "w");
  w.status = "draft";
  await saveWorld(env, w, 1, "compiled", "compiled");
  sqlite
    .prepare(
      "UPDATE jobs SET status='failed',error='transient completion' WHERE id='import-job'",
    )
    .run();
  sqlite.exec(readFileSync("migrations/0004_import_dialogue.sql", "utf8"));
  expect(
    sqlite.prepare("SELECT COUNT(*) AS n FROM import_reviews").get(),
  ).toMatchObject({ n: 0 });
  expect(
    sqlite.prepare("SELECT status FROM jobs WHERE id='import-job'").get(),
  ).toMatchObject({ status: "failed" });
});

it("does not cache a compilation that lacks the three style directions", async () => {
  const objects = await seedImport();
  const w = await getWorld(env, "w");
  w.importBrief = {
    timeframe: "",
    scope: "",
    visualStyle: "",
    notes: "",
    confirmedAt: "now",
  };
  await saveWorld(env, w, 1, "seed-brief", "seed");
  const valid = unsupportedCandidate();
  valid.elements[0].features[0].quote = "silver bridge";
  valid.elements[0].features[0].text = "Silver bridge";
  sqlite
    .prepare("UPDATE segments SET status='done',result_json=? WHERE id='s1'")
    .run(JSON.stringify(valid));
  sqlite.prepare("UPDATE sources SET processed_count=1 WHERE id='s'").run();
  sqlite.prepare("UPDATE jobs SET completed=1 WHERE id='import-job'").run();
  const style = {
    id: "s",
    name: "Style",
    description: "Style",
    medium: "woodcut",
    palette: ["#223344"],
    lighting: "soft",
    materials: [],
    forbidden: [],
    evidence: [],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      modelResult({
        title: "Valley",
        summary: "A dry valley",
        era: "unknown",
        geography: "Valley",
        ecology: "unknown",
        rules: [],
        questions: [],
        styles: [style, { ...style, id: "s2" }],
      }),
    ),
  );
  const { processJob } = await import("../src/server/jobs");
  await processJob(env, "import-job");
  expect(objects.has("jobs/import-job/compiled-proposal.json")).toBe(false);
  expect(
    sqlite.prepare("SELECT status FROM jobs WHERE id='import-job'").get(),
  ).toMatchObject({ status: "waiting_user" });
});

it("requires explicit exact-content author approval before visual calibration", async () => {
  const { frameworkFixture } = await import("./fixtures/world-framework");
  const { frameworkHash } = await import("../src/server/world-framework");
  const w = await getWorld(env, "w");
  w.framework = frameworkFixture();
  w.styles = [
    {
      id: "style",
      name: "Ink",
      description: "Ink",
      medium: "ink",
      palette: ["#222222"],
      lighting: "soft",
      materials: [],
      forbidden: [],
      evidence: [],
    },
  ];
  w.selectedStyleId = "style";
  await saveWorld(env, w, 1, "seed", "seed");
  const headers = {
    Cookie: await cookie(),
    "Content-Type": "application/json",
  };
  const denied = await app.request(
    "/api/worlds/w/visual-previews",
    {
      method: "POST",
      headers,
      body: JSON.stringify({ revision: 1, styleId: "style", elementId: "e" }),
    },
    env,
  );
  expect(denied.status).toBe(409);
  expect(
    ((await denied.json()) as { error: { code: string } }).error.code,
  ).toBe("FRAMEWORK_NOT_APPROVED");
  sqlite.prepare("UPDATE sources SET processed_count=1 WHERE id='s'").run();
  const stored = await getWorld(env, "w");
  const stale = await app.request(
    "/api/worlds/w/framework-approval",
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        revision: 1,
        recordVersion: stored.recordVersion,
        hash: "0".repeat(64),
      }),
    },
    env,
  );
  expect(stale.status).toBe(409);
  const approved = await app.request(
    "/api/worlds/w/framework-approval",
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        revision: 1,
        recordVersion: stored.recordVersion,
        hash: await frameworkHash(stored),
      }),
    },
    env,
  );
  expect(approved.status).toBe(200);
  expect((await getWorld(env, "w")).status).toBe("draft");
  expect(
    sqlite.prepare("SELECT COUNT(*) AS n FROM world_snapshots").get(),
  ).toMatchObject({ n: 1 });
  expect(
    sqlite
      .prepare("SELECT COUNT(*) AS n FROM approvals WHERE kind='framework'")
      .get(),
  ).toMatchObject({ n: 1 });
  expect(
    sqlite
      .prepare(
        "SELECT COUNT(*) AS n FROM audit WHERE type='framework.approved'",
      )
      .get(),
  ).toMatchObject({ n: 1 });
});

it("cannot confirm a legacy world without reviewing the new framework", async () => {
  const w = await getWorld(env, "w");
  w.selectedStyleId = "s";
  w.visualApproval = { previewId: "p", revision: 1, approvedAt: "now" };
  w.previews = [
    {
      id: "p",
      styleId: "s",
      elementId: "e",
      assetId: "a",
      revision: 1,
      feedback: "",
      review: { verdict: "pass", notes: [] },
      createdAt: "now",
    },
  ];
  await saveWorld(env, w, 1, "seed", "seed");
  sqlite.prepare("UPDATE sources SET processed_count=1 WHERE id='s'").run();
  const res = await app.request(
    "/api/worlds/w/confirm",
    {
      method: "POST",
      headers: { Cookie: await cookie(), "Content-Type": "application/json" },
      body: JSON.stringify({
        revision: 1,
        recordVersion: w.recordVersion,
        hash: "0".repeat(64),
      }),
    },
    env,
  );
  expect(res.status).toBe(409);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
    "FRAMEWORK_REQUIRED",
  );
  expect((await getWorld(env, "w")).status).toBe("draft");
});

it("new world reading retains quote uncertainty for world review instead of stopping on minutiae", async () => {
  await seedImport();
  sqlite
    .prepare("UPDATE jobs SET payload_json=? WHERE id='import-job'")
    .run(JSON.stringify({ analysisVersion: "0.03" }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      modelResult({
        ...unsupportedCandidate(),
        worldOverview: "A bridge in a dry valley; water is not supported.",
      }),
    ),
  );
  const { processJob } = await import("../src/server/jobs");
  await processJob(env, "import-job");
  expect(
    sqlite.prepare("SELECT status FROM jobs WHERE id='import-job'").get(),
  ).toMatchObject({ status: "queued" });
  expect(
    sqlite.prepare("SELECT processed_count FROM sources WHERE id='s'").get(),
  ).toMatchObject({ processed_count: 1 });
  const segment = sqlite
    .prepare("SELECT result_json FROM segments WHERE id='s1'")
    .get() as { result_json: string };
  const result = JSON.parse(segment.result_json);
  expect(result.elements[0].features[0].origin).toBe("inferred");
  expect(result.elements[0].features[0].quote).toBe("");
  expect(result.warnings.join(" ")).toContain("unverified");
  expect(
    sqlite.prepare("SELECT COUNT(*) AS n FROM import_reviews").get(),
  ).toMatchObject({ n: 0 });
});

it("new imports start world architecture without requiring the author to prefill worldbuilding", async () => {
  await seedImport();
  sqlite
    .prepare("UPDATE jobs SET payload_json=? WHERE id='import-job'")
    .run(JSON.stringify({ analysisVersion: "0.03" }));
  const valid = unsupportedCandidate();
  valid.elements[0].features[0].quote = "silver bridge";
  sqlite
    .prepare("UPDATE segments SET status='done',result_json=? WHERE id='s1'")
    .run(JSON.stringify(valid));
  sqlite.prepare("UPDATE sources SET processed_count=1 WHERE id='s'").run();
  const { frameworkFixture } = await import("./fixtures/world-framework");
  const f = frameworkFixture();
  const fetcher = vi.fn(async () =>
    modelResult({
      title: "A valley",
      summary: "A dry valley",
      modules: f.modules,
      anchors: f.anchors,
      issues: [],
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const { processJob } = await import("../src/server/jobs");
  await processJob(env, "import-job");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(
    sqlite.prepare("SELECT stage FROM analysis_checkpoints").get(),
  ).toMatchObject({ stage: "architect" });
  expect(
    sqlite.prepare("SELECT status FROM jobs WHERE id='import-job'").get(),
  ).toMatchObject({ status: "queued" });
  expect(
    sqlite.prepare("SELECT COUNT(*) AS n FROM approvals").get(),
  ).toMatchObject({ n: 0 });
  expect((await getWorld(env, "w")).status).toBe("reading");
});

it("runs staged world agents with original-source fidelity review and leaves every approval to the author", async () => {
  await seedImport();
  sqlite
    .prepare("UPDATE jobs SET payload_json=? WHERE id='import-job'")
    .run(JSON.stringify({ analysisVersion: "0.03" }));
  const valid = unsupportedCandidate();
  valid.elements[0].features[0].quote = "silver bridge";
  valid.elements[0].features[0].text = "Silver bridge";
  valid.guidance = [];
  sqlite
    .prepare("UPDATE segments SET status='done',result_json=? WHERE id='s1'")
    .run(JSON.stringify(valid));
  sqlite.prepare("UPDATE sources SET processed_count=1 WHERE id='s'").run();
  const { frameworkFixture } = await import("./fixtures/world-framework");
  const f = frameworkFixture();
  const contexts: Record<string, unknown>[] = [];
  const fetcher = vi.fn(async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string);
    const c = JSON.parse(body.messages[1].content);
    contexts.push(c);
    if (c.stage === "architect")
      return modelResult({
        title: "Valley",
        summary: "A dry valley",
        modules: f.modules,
        anchors: f.anchors,
        issues: [],
      });
    if (["civilization", "geography", "ecology"].includes(c.stage)) {
      const keys =
        c.stage === "civilization"
          ? ["time", "laws", "civilization"]
          : c.stage === "geography"
            ? ["space", "environment"]
            : ["life"];
      return modelResult({
        modules: f.modules.filter((m) => keys.includes(m.key)),
        anchors: f.anchors,
        extensions:
          c.stage === "geography"
            ? [
                {
                  id: "model-added",
                  module: "environment",
                  title: "Proposed detail",
                  definition: "A bounded detail",
                  reason: "Optional depiction",
                  limits: "Initial place only",
                  decision: "accepted",
                },
              ]
            : [],
      });
    }
    if (c.stage === "visual")
      return modelResult({
        module: f.modules[7],
        visual: f.visual,
        styles: [1, 2, 3].map((i) => ({
          id: `style${i}`,
          name: `Direction ${i}`,
          description: "A proposed depiction",
          medium: "ink",
          palette: ["#222222"],
          lighting: "soft",
          materials: [],
          forbidden: [],
          evidence: [],
        })),
        audience: f.audience,
        exploration: { ...f.exploration, startPlace: c.elements[0].id },
      });
    if (c.stage === "naming")
      return modelResult({ naming: f.naming, relations: [], envelopes: [] });
    return modelResult({ verdict: "pass", notes: [], issues: [] });
  });
  vi.stubGlobal("fetch", fetcher);
  const { processJob } = await import("../src/server/jobs");
  for (let i = 0; i < 9; i++) await processJob(env, "import-job");
  const w = await getWorld(env, "w");
  expect(w.status).toBe("draft");
  expect(w.framework?.modules).toHaveLength(8);
  expect(w.framework?.extensions[0].decision).toBe("pending");
  expect(w.frameworkApproval).toBeNull();
  expect(w.visualApproval).toBeNull();
  expect(
    sqlite.prepare("SELECT COUNT(*) AS n FROM approvals").get(),
  ).toMatchObject({ n: 0 });
  expect(
    sqlite.prepare("SELECT COUNT(*) AS n FROM analysis_checkpoints").get(),
  ).toMatchObject({ n: 7 });
  expect(contexts.find((c) => c.stage === "fidelity:0")?.originalText).toBe(
    "The silver bridge spans a dry valley.",
  );
  expect(fetcher).toHaveBeenCalledTimes(7);
  await processJob(env, "import-job");
  expect(fetcher).toHaveBeenCalledTimes(7);
});

it("keeps AI dialogue proposals in the review framework and invalidates prior approvals", async () => {
  const { frameworkFixture } = await import("./fixtures/world-framework");
  const w = await getWorld(env, "w");
  w.framework = frameworkFixture();
  w.frameworkApproval = { hash: "old", revision: 1, approvedAt: "now" };
  await saveWorld(env, w, 1, "seed", "seed");
  env.MODEL_API_KEY = "test-key";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      modelResult({
        assistant: "已提出新的年代解讀，請審核。",
        proposed: {
          summary: "A new interpretation",
          era: "A relative future",
          geography: "A closed area",
          ecology: "Unknown",
          rules: ["Keep the boundary"],
        },
      }),
    ),
  );
  const response = await app.request(
    "/api/worlds/w/chat",
    {
      method: "POST",
      headers: { Cookie: await cookie(), "Content-Type": "application/json" },
      body: JSON.stringify({
        revision: 1,
        message: "請把年代改為相對未來，提出草案",
      }),
    },
    env,
  );
  expect(response.status).toBe(200);
  const fresh = await getWorld(env, "w");
  expect(fresh.framework?.modules.find((m) => m.key === "time")?.summary).toBe(
    "A relative future",
  );
  expect(fresh.framework?.modules.find((m) => m.key === "time")?.basis).toBe(
    "proposed_extension",
  );
  expect(fresh.frameworkApproval).toBeNull();
  expect(fresh.status).toBe("draft");
});

it("requires a displayed record version for final activation and rejects an outdated visual decision", async () => {
  const { frameworkFixture } = await import("./fixtures/world-framework");
  const { frameworkHash } = await import("../src/server/world-framework");
  const w = await getWorld(env, "w");
  w.framework = frameworkFixture();
  w.selectedStyleId = "style";
  w.styles = [
    {
      id: "style",
      name: "Style",
      description: "Proposed",
      medium: "ink",
      palette: [],
      lighting: "soft",
      materials: [],
      forbidden: [],
      evidence: [],
    },
  ];
  w.previews = [
    {
      id: "p",
      assetId: "a",
      elementId: "e",
      styleId: "style",
      revision: 1,
      feedback: "",
      review: { verdict: "pass", notes: [] },
      createdAt: "now",
    },
  ];
  w.visualApproval = { previewId: "p", revision: 1, approvedAt: "now" };
  const hash = await frameworkHash(w);
  w.frameworkApproval = { hash, revision: 1, approvedAt: "now" };
  await saveWorld(env, w, 1, "seed", "seed");
  sqlite.prepare("UPDATE sources SET processed_count=1 WHERE id='s'").run();
  const headers = {
    Cookie: await cookie(),
    "Content-Type": "application/json",
  };
  const missing = await app.request(
    "/api/worlds/w/confirm",
    { method: "POST", headers, body: JSON.stringify({ revision: 1, hash }) },
    env,
  );
  expect(missing.status).toBe(422);
  const stale = await app.request(
    "/api/worlds/w/confirm",
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        revision: 1,
        recordVersion: w.recordVersion! - 1,
        hash,
      }),
    },
    env,
  );
  expect(stale.status).toBe(409);
  expect((await getWorld(env, "w")).status).toBe("draft");
});

it("returns the freshly compiled world if a job completes during the detail read", async () => {
  const w = await getWorld(env, "w");
  w.status = "reading";
  await saveWorld(env, w, 1, "seed", "seed");
  const prepare = env.DB.prepare.bind(env.DB);
  let finished = false;
  env.DB.prepare = ((sql: string) => {
    const stmt = prepare(sql);
    if (sql.startsWith("SELECT * FROM jobs WHERE world_id")) {
      const all = stmt.all.bind(stmt);
      stmt.all = (async () => {
        if (!finished) {
          finished = true;
          const current = await getWorld(env, "w");
          current.status = "draft";
          await saveWorld(
            env,
            current,
            1,
            "world.compiled",
            "completed while reading",
          );
        }
        return all();
      }) as typeof stmt.all;
    }
    return stmt;
  }) as typeof env.DB.prepare;
  const response = await app.request(
    "/api/worlds/w",
    { headers: { Cookie: await cookie() } },
    env,
  );
  expect(response.status).toBe(200);
  const detail = (await response.json()) as { world: WorldDraft };
  expect(detail.world.status).toBe("draft");
  expect(detail.world.recordVersion).toBe(
    (await getWorld(env, "w")).recordVersion,
  );
});
