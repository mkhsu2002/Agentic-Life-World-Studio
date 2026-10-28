import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { processJob } from "../src/server/jobs";
import { getWorld } from "../src/server/repository";
import { frameworkHash } from "../src/server/world-framework";
import { frameworkWorld } from "./fixtures/world-framework";
import type { Env } from "../src/server/env";

let sqlite: DatabaseSync, env: Env;
let objects: Map<string, Uint8Array>;
let failSql: RegExp | undefined, failStorage: RegExp | undefined;
const encoder = new TextEncoder();
class Statement {
  values: unknown[] = [];
  constructor(public sql: string) {}
  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }
  execute() {
    if (failSql?.test(this.sql)) {
      failSql = undefined;
      throw new Error("injected D1 failure");
    }
    const q = sqlite.prepare(this.sql);
    if (/^\s*SELECT/i.test(this.sql))
      return {
        results: q.all(...(this.values as never[])),
        meta: { changes: 0 },
      };
    const r = q.run(...(this.values as never[]));
    return { results: [], meta: { changes: Number(r.changes) } };
  }
  async run() {
    return this.execute();
  }
  async all() {
    return this.execute();
  }
  async first() {
    return this.execute().results[0] || null;
  }
}
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  for (const name of [
    "0001_studio",
    "0002_job_keys",
    "0003_active_jobs",
    "0004_import_dialogue",
    "0005_world_framework",
  ])
    sqlite.exec(readFileSync(`migrations/${name}.sql`, "utf8"));
  objects = new Map([["text0", encoder.encode("A room contains a stone.")]]);
  failSql = failStorage = undefined;
  env = {
    DB: {
      prepare: (sql: string) => new Statement(sql),
      batch: async (statements: Statement[]) => {
        sqlite.exec("BEGIN");
        try {
          const results = statements.map((s) => s.execute());
          sqlite.exec("COMMIT");
          return results;
        } catch (e) {
          sqlite.exec("ROLLBACK");
          throw e;
        }
      },
    },
    STORAGE: {
      get: async (key: string) => {
        const value = objects.get(key);
        return value
          ? {
              text: async () => new TextDecoder().decode(value),
              json: async () => JSON.parse(new TextDecoder().decode(value)),
              arrayBuffer: async () => value.slice().buffer,
            }
          : null;
      },
      put: async (key: string, value: string | Uint8Array) => {
        if (failStorage?.test(key)) {
          failStorage = undefined;
          throw new Error("injected R2 failure");
        }
        objects.set(
          key,
          typeof value === "string" ? encoder.encode(value) : value.slice(),
        );
      },
      delete: async (key: string) => {
        objects.delete(key);
      },
    },
    JOBS: { send: vi.fn() },
    MODEL_API_KEY: "test",
  } as unknown as Env;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sqlite.close();
});

async function seed(kind: "import" | "visual") {
  const w = frameworkWorld();
  w.styles = [
    {
      id: "style",
      name: "Ink",
      description: "Ink",
      medium: "ink",
      palette: ["gray"],
      lighting: "soft",
      materials: [],
      forbidden: [],
      evidence: [],
    },
  ];
  if (kind === "import") {
    w.status = "reading";
    delete w.framework;
  } else
    w.frameworkApproval = {
      revision: 1,
      hash: await frameworkHash(w),
      approvedAt: "now",
    };
  sqlite
    .prepare(
      "INSERT INTO sources(id,title,kind,sha256,char_count,segment_count,processed_count,created_at) VALUES('s','Source','text','hash',24,1,0,'now')",
    )
    .run();
  sqlite
    .prepare(
      "INSERT INTO worlds(id,source_id,revision,document_json,created_at,updated_at) VALUES('w','s',1,?,'now','now')",
    )
    .run(JSON.stringify(w));
  sqlite
    .prepare(
      "INSERT INTO segments(id,source_id,ordinal,start_offset,end_offset,text_key,status) VALUES('seg0','s',0,0,24,'text0','queued')",
    )
    .run();
  const payload =
    kind === "import"
      ? { analysisVersion: "0.03" }
      : { revision: 1, styleId: "style", elementId: "e", feedback: "" };
  sqlite
    .prepare(
      "INSERT INTO jobs(id,world_id,kind,status,stage,total,payload_json,created_at,updated_at) VALUES('job','w',?,'queued','start',8,?,'now','now')",
    )
    .run(kind, JSON.stringify(payload));
}
function model() {
  const fetcher = vi.fn(async (url: string) =>
    url.includes("/images/")
      ? Response.json({
          data: [
            {
              b64_json: Buffer.from([137, 80, 78, 71, 1, 2, 3]).toString(
                "base64",
              ),
            },
          ],
        })
      : Response.json({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify(
                  url.includes("completions") &&
                    sqlite.prepare("SELECT kind FROM jobs").get()?.kind ===
                      "visual"
                    ? { verdict: "pass", issues: [] }
                    : {
                        elements: [],
                        facts: [],
                        warnings: [],
                        worldOverview: "A room",
                      },
                ),
              },
            },
          ],
          usage: { prompt_tokens: 13, completion_tokens: 7 },
        }),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
function retry() {
  sqlite.prepare("UPDATE import_reviews SET status='resolved'").run();
  sqlite.prepare("UPDATE jobs SET status='queued',lease_until=NULL").run();
}
const ledger = () =>
  sqlite.prepare("SELECT * FROM usage_ledger ORDER BY created_at,id").all();

it("keeps a reading result before an incurred-ledger failure and reconciles the original reservation", async () => {
  await seed("import");
  const fetcher = model();
  failSql = /UPDATE usage_ledger SET status='incurred'/;
  await processJob(env, "job");
  expect(objects.has("jobs/job/segment-0-candidate.json")).toBe(true);
  const original = ledger()[0];
  expect(original).toMatchObject({ status: "uncertain" });
  retry();
  await processJob(env, "job");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(ledger()).toEqual([
    expect.objectContaining({
      id: original.id,
      status: "incurred",
      input_tokens: 13,
      output_tokens: 7,
    }),
  ]);
  expect(sqlite.prepare("SELECT status FROM segments").get()).toMatchObject({
    status: "done",
  });
});

it("recovers the reading checkpoint after the segment transaction fails", async () => {
  await seed("import");
  const fetcher = model();
  failSql = /UPDATE segments SET result_json/;
  await processJob(env, "job");
  const original = ledger()[0];
  retry();
  await processJob(env, "job");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(ledger()).toEqual([
    expect.objectContaining({
      id: original.id,
      status: "incurred",
      input_tokens: 13,
      output_tokens: 7,
    }),
  ]);
});

it.each([/UPDATE usage_ledger SET status='incurred'/, /INSERT INTO assets/])(
  "recovers the same generated image and asset row after %s fails",
  async (failure) => {
    await seed("visual");
    const fetcher = model();
    failSql = failure;
    await processJob(env, "job");
    expect(objects.has("jobs/job/visual-asset.json")).toBe(true);
    const checkpoint = JSON.parse(
      new TextDecoder().decode(objects.get("jobs/job/visual-asset.json")),
    );
    const original = ledger()[0];
    expect((await getWorld(env, "w")).previews).toHaveLength(0);
    retry();
    await processJob(env, "job");
    expect(
      fetcher.mock.calls.filter(([url]) => url.includes("/images/")),
    ).toHaveLength(1);
    expect(sqlite.prepare("SELECT id,object_key FROM assets").all()).toEqual([
      { id: checkpoint.assetId, object_key: checkpoint.objectKey },
    ]);
    expect(ledger().filter((r) => r.stage === "visual_generation")).toEqual([
      expect.objectContaining({ id: original.id, status: "incurred" }),
    ]);
    const w = await getWorld(env, "w");
    expect(w.previews).toHaveLength(1);
    expect(w.visualApproval).toBeNull();
    expect(
      sqlite.prepare("SELECT COUNT(*) AS n FROM releases").get(),
    ).toMatchObject({ n: 0 });
  },
);

it("keeps uncertain usage when saving the model result to R2 fails", async () => {
  await seed("import");
  model();
  failStorage = /candidate.json$/;
  await processJob(env, "job");
  expect(ledger()).toEqual([expect.objectContaining({ status: "uncertain" })]);
  expect(objects.has("jobs/job/segment-0-candidate.json")).toBe(false);
  expect(sqlite.prepare("SELECT status FROM segments").get()).toMatchObject({
    status: "queued",
  });
});

it("does not reuse a visual checkpoint for changed semantic inputs", async () => {
  await seed("visual");
  const fetcher = model();
  failSql = /UPDATE usage_ledger SET status='incurred'/;
  await processJob(env, "job");
  sqlite
    .prepare(
      "UPDATE jobs SET payload_json=json_set(payload_json,'$.feedback','different')",
    )
    .run();
  retry();
  await processJob(env, "job");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect((await getWorld(env, "w")).previews).toHaveLength(0);
  expect(sqlite.prepare("SELECT status FROM jobs").get()).toMatchObject({
    status: "failed",
  });
});

it("recovers visual QA without another model call after the world-save transaction fails", async () => {
  await seed("visual");
  const fetcher = model();
  failSql = /UPDATE worlds SET revision/;
  await processJob(env, "job");
  expect((await getWorld(env, "w")).previews).toHaveLength(0);
  retry();
  await processJob(env, "job");
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(ledger()).toHaveLength(2);
  expect((await getWorld(env, "w")).previews).toHaveLength(1);
});

it("rejects a modern legacy candidate without inventing a successful usage record", async () => {
  await seed("import");
  const fetcher = model();
  objects.set(
    "jobs/job/segment-0-candidate.json",
    encoder.encode(
      JSON.stringify({ output: { elements: [], facts: [], warnings: [] } }),
    ),
  );
  await processJob(env, "job");
  expect(fetcher).not.toHaveBeenCalled();
  expect(ledger()).toHaveLength(0);
  expect(sqlite.prepare("SELECT status FROM segments").get()).toMatchObject({
    status: "queued",
  });
});

it("cannot reconcile a candidate whose original ledger reservation is missing", async () => {
  await seed("import");
  const fetcher = model();
  failSql = /UPDATE usage_ledger SET status='incurred'/;
  await processJob(env, "job");
  sqlite.prepare("DELETE FROM usage_ledger").run();
  retry();
  await processJob(env, "job");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(ledger()).toHaveLength(0);
  expect(sqlite.prepare("SELECT status FROM segments").get()).toMatchObject({
    status: "queued",
  });
});

it("rejects a reading checkpoint when the source input changes", async () => {
  await seed("import");
  const fetcher = model();
  failSql = /UPDATE usage_ledger SET status='incurred'/;
  await processJob(env, "job");
  objects.set("text0", encoder.encode("A different source."));
  retry();
  await processJob(env, "job");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(ledger()).toHaveLength(1);
  expect(sqlite.prepare("SELECT status FROM segments").get()).toMatchObject({
    status: "queued",
  });
});

it.each(["brief", "revision"])(
  "settles and archives an earlier result before reading an author-changed %s request",
  async (change) => {
    await seed("import");
    const fetcher = model();
    failSql = /UPDATE usage_ledger SET status='incurred'/;
    await processJob(env, "job");
    const original = ledger()[0];
    const candidate = JSON.parse(
      new TextDecoder().decode(
        objects.get("jobs/job/segment-0-candidate.json"),
      ),
    );
    const w = await getWorld(env, "w");
    if (change === "brief")
      w.importBrief = {
        timeframe: "A later era",
        scope: "The room",
        visualStyle: "Ink",
        notes: "Author clarification",
        confirmedAt: null,
      };
    else w.revision++;
    sqlite
      .prepare("UPDATE worlds SET revision=?,document_json=? WHERE id='w'")
      .run(w.revision, JSON.stringify(w));
    retry();
    await processJob(env, "job");
    expect(sqlite.prepare("SELECT status FROM segments").get()).toMatchObject({
      status: "done",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(ledger()).toHaveLength(2);
    expect(ledger()).toContainEqual(
      expect.objectContaining({
        id: original.id,
        status: "incurred",
        input_tokens: 13,
        output_tokens: 7,
      }),
    );
    expect(ledger().every((row) => row.status === "incurred")).toBe(true);
    const superseded = [...objects.keys()].filter(
      (key) => key.includes("superseded") && key.includes(candidate.inputHash),
    );
    expect(superseded).toHaveLength(1);
    expect(
      JSON.parse(new TextDecoder().decode(objects.get(superseded[0]))),
    ).toMatchObject({ usageId: original.id, inputHash: candidate.inputHash });
  },
);

it("reconciles visual QA with the original tokens after its ledger update fails", async () => {
  await seed("visual");
  const fetcher = model();
  const respond = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url) => {
    const response = await respond(url);
    if (url.includes("completions"))
      failSql = /UPDATE usage_ledger SET status='incurred'/;
    return response;
  });
  await processJob(env, "job");
  const original = ledger().find((r) => r.stage === "visual_review")!;
  expect(original.status).toBe("uncertain");
  expect(objects.has("jobs/job/visual-review.json")).toBe(true);
  retry();
  await processJob(env, "job");
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(ledger().filter((r) => r.stage === "visual_review")).toEqual([
    expect.objectContaining({
      id: original.id,
      status: "incurred",
      input_tokens: 13,
      output_tokens: 7,
    }),
  ]);
});

it("keeps the generated-image charge uncertain if the durable checkpoint cannot be written", async () => {
  await seed("visual");
  const fetcher = model();
  failStorage = /visual-asset.json$/;
  await processJob(env, "job");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(ledger()).toEqual([
    expect.objectContaining({
      stage: "visual_generation",
      status: "uncertain",
    }),
  ]);
  expect((await getWorld(env, "w")).previews).toHaveLength(0);
  expect(
    sqlite.prepare("SELECT COUNT(*) AS n FROM assets").get(),
  ).toMatchObject({ n: 0 });
});
