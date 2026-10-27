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
