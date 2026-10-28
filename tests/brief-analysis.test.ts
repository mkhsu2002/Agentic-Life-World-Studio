import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  briefAnalysisSchemas,
  runBriefAnalysis,
} from "../src/server/brief-analysis";
import { getWorld } from "../src/server/repository";
import { sha256 } from "../src/server/domain";
import { frameworkWorld } from "./fixtures/world-framework";
import type { Env } from "../src/server/env";

let sqlite: DatabaseSync, env: Env, objects: Map<string, string>;
const job = { id: "job", world_id: "w", completed: 0 };
const sourceText =
  "The archive has translucent shelves. Visitors remain anonymous. A visitor dropped a key.";
const quote = "The archive has translucent shelves.";
const brief = () => ({
  version: "world-brief/0.06",
  world: "半透明書架構成可見環境。",
  visual: "依原作外觀採柔和透光的繪畫方向。",
  viewpoint: "不具名觀察者，僅描述所見。",
  time: "時代未交代；不預先揭露後續事件。",
  naming: "保留必要原名，未命名者不擅自命名。",
  boundaries: "限於既有景象；尚未確認的延伸維持未知。",
  decisions: [],
  evidence: [{ section: "world", segmentId: "seg0", quote }],
  referenceStatus: "not_provided",
});
const style = () => ({
  id: "direction",
  name: "透光繪畫",
  description: "保留半透明材質",
  medium: "painting",
  palette: ["pale gray"],
  lighting: "diffused",
  materials: ["translucent surfaces"],
  forbidden: [],
  evidence: [quote],
});
class Statement {
  values: unknown[] = [];
  constructor(public sql: string) {}
  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }
  execute() {
    const q = sqlite.prepare(this.sql);
    if (/^\s*SELECT/i.test(this.sql))
      return {
        success: true,
        results: q.all(...(this.values as never[])),
        meta: { changes: 0 },
      };
    const r = q.run(...(this.values as never[]));
    return { success: true, results: [], meta: { changes: Number(r.changes) } };
  }
  async all() {
    return this.execute();
  }
  async run() {
    return this.execute();
  }
  async first() {
    return this.execute().results[0] || null;
  }
}
function model(
  transform: (stage: string, value: any, context: any) => any = (_s, v) => v,
) {
  const contexts: any[] = [],
    prompts: string[] = [];
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string);
    const content = body.messages[1].content;
    const context = JSON.parse(
      typeof content === "string" ? content : content[0].text,
    );
    contexts.push(context);
    prompts.push(body.messages[0].content);
    const value = context.stage.startsWith("reader:")
      ? {
          notes: context.text.includes(quote)
            ? [{ section: "world", note: "書架的半透明材質影響畫面。", quote }]
            : [],
        }
      : context.stage === "editor"
        ? {
            title: "Translucent Archive",
            summary: "An archive with translucent shelves.",
            brief: brief(),
            terms: [],
          }
        : context.stage === "visual"
          ? { visual: brief().visual, style: style() }
          : { ...context.proposed, brief: context.proposed.brief };
    return Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify(transform(context.stage, value, context)),
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
  });
  vi.stubGlobal("fetch", fetcher);
  return { contexts, prompts, fetcher };
}
const step = async () => runBriefAnalysis(env, job, await getWorld(env, "w"));
async function finish() {
  for (let i = 0; i < 20; i++)
    if ((await step()).done) return getWorld(env, "w");
  throw new Error("brief did not finish");
}
const checkpointCount = () =>
  (
    sqlite.prepare("SELECT COUNT(*) AS n FROM analysis_checkpoints").get() as {
      n: number;
    }
  ).n;
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
  const w = frameworkWorld();
  w.status = "reading";
  sqlite
    .prepare(
      "INSERT INTO sources(id,title,kind,sha256,char_count,segment_count,processed_count,created_at) VALUES('s','Source','text','sourcehash',100,1,0,'now')",
    )
    .run();
  sqlite
    .prepare(
      "INSERT INTO worlds(id,source_id,revision,document_json,created_at,updated_at) VALUES('w','s',1,?,'now','now')",
    )
    .run(JSON.stringify(w));
  sqlite
    .prepare(
      "INSERT INTO jobs(id,world_id,kind,status,stage,total,payload_json,created_at,updated_at) VALUES('job','w','import','queued','reading',5,'{}','now','now')",
    )
    .run();
  sqlite
    .prepare(
      "INSERT INTO segments(id,source_id,ordinal,start_offset,end_offset,text_key,status) VALUES('seg0','s',0,0,100,'text0','pending')",
    )
    .run();
  objects = new Map([["text0", sourceText]]);
  env = {
    DB: {
      prepare: (sql: string) => new Statement(sql),
      batch: async (statements: Statement[]) => {
        sqlite.exec("BEGIN");
        try {
          const result = statements.map((s) => s.execute());
          sqlite.exec("COMMIT");
          return result;
        } catch (e) {
          sqlite.exec("ROLLBACK");
          throw e;
        }
      },
    },
    STORAGE: {
      get: async (key: string) =>
        objects.has(key)
          ? {
              text: async () => objects.get(key)!,
              json: async () => JSON.parse(objects.get(key)!),
            }
          : null,
      put: async (key: string, value: string) => {
        objects.set(key, value);
      },
      delete: async (key: string) => {
        objects.delete(key);
      },
    },
    MODEL_API_KEY: "test",
  } as unknown as Env;
});
afterEach(() => {
  vi.unstubAllGlobals();
  sqlite.close();
});

it("bounds compact notes, six paragraphs, necessary decisions, evidence, terms and one visual direction", () => {
  expect(briefAnalysisSchemas.reader.safeParse({ notes: [] }).success).toBe(
    true,
  );
  expect(
    briefAnalysisSchemas.reader.safeParse({
      notes: Array.from({ length: 7 }, () => ({
        section: "world",
        note: "material",
        quote,
      })),
    }).success,
  ).toBe(false);
  const editor = {
    title: "Archive",
    summary: "An archive.",
    brief: brief(),
    terms: [],
  };
  expect(briefAnalysisSchemas.editor.safeParse(editor).success).toBe(true);
  expect(
    briefAnalysisSchemas.editor.safeParse({
      ...editor,
      brief: { ...brief(), world: "x".repeat(4001) },
    }).success,
  ).toBe(false);
  expect(
    briefAnalysisSchemas.editor.safeParse({
      ...editor,
      brief: {
        ...brief(),
        decisions: Array.from({ length: 6 }, (_, i) => ({
          id: `q${i}`,
          section: "time",
          question: "Choose time",
          suggestion: "Keep current",
          answer: "",
        })),
      },
    }).success,
  ).toBe(false);
  expect(
    briefAnalysisSchemas.visual.safeParse({ visual: "方向", style: style() })
      .success,
  ).toBe(true);
  expect(
    briefAnalysisSchemas.visual.safeParse({
      visual: "方向",
      styles: [style(), style(), style()],
    }).success,
  ).toBe(false);
});
it("reads pending source without encyclopedic extraction and uses at most one model request per invocation", async () => {
  const { contexts, prompts, fetcher } = model();
  for (let i = 0; i < 5; i++) {
    const calls = fetcher.mock.calls.length;
    const result = await step();
    expect(fetcher.mock.calls.length - calls).toBe(i === 4 ? 0 : 1);
    expect(result.done).toBe(i === 4);
  }
  expect(contexts.map((c) => c.stage)).toEqual([
    "reader:0",
    "editor",
    "visual",
    "fidelity",
  ]);
  expect(contexts[0].text).toBe(sourceText);
  expect(contexts[1]).not.toHaveProperty("elements");
  expect(contexts[1].readingNotes[0].notes).toHaveLength(1);
  expect(JSON.stringify(contexts[1])).not.toContain("dropped a key");
  expect(prompts[0]).toContain("public image");
  expect(prompts[0]).toContain("incidental plot");
  const w = await getWorld(env, "w");
  expect(w.brief?.decisions).toEqual([]);
  expect(w.briefApproval).toBeNull();
  expect(w.frameworkApproval).toBeNull();
  expect(w.visualApproval).toBeNull();
  expect(w.framework).toBeUndefined();
  expect(w.elements).toEqual([]);
  expect(w.styles).toHaveLength(1);
  expect(w.selectedStyleId).toBe(w.styles[0].id);
  expect(w.status).toBe("draft");
  expect(
    sqlite.prepare("SELECT processed_count FROM sources").get(),
  ).toMatchObject({ processed_count: 1 });
  expect(
    sqlite.prepare("SELECT status,completed,total FROM jobs").get(),
  ).toMatchObject({ status: "succeeded", completed: 5, total: 5 });
  expect(
    sqlite
      .prepare("SELECT COUNT(*) AS n FROM audit WHERE type='brief.compiled'")
      .get(),
  ).toMatchObject({ n: 1 });
});
it("re-reads legacy done segments and never reuses their old large extraction", async () => {
  sqlite.prepare("UPDATE segments SET status='done',result_json=?").run(
    JSON.stringify({
      elements: Array.from({ length: 150 }, () => ({
        sourceName: "irrelevant",
      })),
    }),
  );
  sqlite.prepare("UPDATE sources SET segment_count=2,processed_count=2").run();
  sqlite
    .prepare(
      "INSERT INTO segments(id,source_id,ordinal,start_offset,end_offset,text_key,result_json,status) VALUES('seg1','s',1,100,200,'text1','{}','done')",
    )
    .run();
  objects.set(
    "text1",
    "A person briefly misplaces a package, with no change to the visible setting.",
  );
  const { contexts, fetcher } = model();
  await finish();
  expect(fetcher).toHaveBeenCalledTimes(5);
  expect(
    contexts.filter((c) => c.stage.startsWith("reader:")).map((c) => c.text),
  ).toEqual([sourceText, objects.get("text1")]);
  const edited = contexts.find((c) => c.stage === "editor");
  expect(edited.readingNotes).toHaveLength(2);
  expect(edited.readingNotes[1].notes).toEqual([]);
  expect(JSON.stringify(edited)).not.toContain("irrelevant");
});
it("always clears AI supplied decision answers, including the independent auditor", async () => {
  model((stage, value) => {
    if (stage === "editor" || stage === "fidelity")
      value.brief.decisions = [
        {
          id: "time",
          section: "time",
          question: "旅程何時開始？",
          suggestion: "維持原作當下",
          answer: "AI 已替作者核准",
        },
      ];
    return value;
  });
  const w = await finish();
  expect(w.brief!.decisions).toHaveLength(1);
  expect(w.brief!.decisions[0].answer).toBe("");
  expect(w.briefApproval).toBeNull();
});
it("independently audits actual original passages without one audit call per segment", async () => {
  const { contexts } = model();
  await finish();
  const audit = contexts.find((c) => c.stage === "fidelity");
  expect(audit.sourcePassages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        segmentId: "seg0",
        originalText: expect.stringContaining(quote),
      }),
    ]),
  );
  expect(audit.proposed.brief.referenceStatus).toBe("not_provided");
  expect(contexts.filter((c) => c.stage.startsWith("fidelity"))).toHaveLength(
    1,
  );
});
it("keeps reader progress after a later malformed response", async () => {
  const { fetcher } = model((stage, v) =>
    stage === "editor" ? { broken: true } : v,
  );
  await step();
  await expect(step()).rejects.toMatchObject({
    code: "MODEL_CONTRACT_INVALID",
  });
  expect(checkpointCount()).toBe(1);
  expect(fetcher).toHaveBeenCalledTimes(2);
  const next = model();
  await finish();
  expect(next.contexts[0].stage).toBe("editor");
});
it("requires exact genuine source attribution before checkpointing notes", async () => {
  model((stage, v) =>
    stage.startsWith("reader:")
      ? {
          notes: [
            {
              section: "world",
              note: "invented",
              quote: "There are exactly nine continents.",
            },
          ],
        }
      : v,
  );
  await expect(step()).rejects.toMatchObject({
    code: "MODEL_CONTRACT_INVALID",
  });
  expect(checkpointCount()).toBe(0);
});
it("reuses a successful R2 result after checkpoint failure without another bill or call", async () => {
  const { fetcher } = model();
  const batch = env.DB.batch.bind(env.DB);
  let fail = true;
  env.DB.batch = (async (statements) => {
    if (fail) {
      fail = false;
      throw new Error("checkpoint unavailable");
    }
    return batch(statements);
  }) as typeof env.DB.batch;
  await expect(step()).rejects.toThrow("checkpoint unavailable");
  expect(checkpointCount()).toBe(0);
  expect([...objects.keys()].some((k) => k.endsWith("/reader:0.json"))).toBe(
    true,
  );
  await step();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(checkpointCount()).toBe(1);
  expect(
    sqlite
      .prepare("SELECT status,input_tokens,output_tokens FROM usage_ledger")
      .all(),
  ).toEqual([{ status: "incurred", input_tokens: 10, output_tokens: 5 }]);
});
it("settles the same usage receipt after a post-model ledger failure", async () => {
  const { fetcher } = model();
  const prepare = env.DB.prepare.bind(env.DB);
  let fail = true;
  env.DB.prepare = ((sql: string) => {
    const statement = prepare(sql) as unknown as Statement;
    if (sql.includes("UPDATE usage_ledger SET status='incurred'")) {
      const run = statement.run.bind(statement);
      statement.run = async () => {
        if (fail) {
          fail = false;
          throw new Error("ledger unavailable");
        }
        return run();
      };
    }
    return statement;
  }) as unknown as typeof env.DB.prepare;
  await expect(step()).rejects.toThrow("ledger unavailable");
  await step();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(sqlite.prepare("SELECT status FROM usage_ledger").all()).toEqual([
    { status: "incurred" },
  ]);
});
it("binds cached results to source text even when the source metadata hash did not change", async () => {
  const { fetcher } = model();
  await step();
  objects.set("text0", `${sourceText} The shelves are green.`);
  await step();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(checkpointCount()).toBe(2);
});
it("rejects tampered cached source references and removes only dependent work", async () => {
  const { fetcher } = model();
  await step();
  await step();
  await step();
  const row = sqlite
    .prepare(
      "SELECT output_json FROM analysis_checkpoints WHERE stage='editor'",
    )
    .get() as { output_json: string };
  const candidate = JSON.parse(row.output_json);
  candidate.value.brief.evidence[0].segmentId = "missing";
  sqlite
    .prepare(
      "UPDATE analysis_checkpoints SET output_json=? WHERE stage='editor'",
    )
    .run(JSON.stringify(candidate));
  await step();
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(checkpointCount()).toBe(2);
  expect(
    sqlite
      .prepare("SELECT stage FROM analysis_checkpoints WHERE stage='visual'")
      .get(),
  ).toBeUndefined();
});
it("uses actual image pixels in both visual direction and independent review", async () => {
  const bytes = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=",
    ),
    (c) => c.charCodeAt(0),
  );
  const hash = await sha256(bytes.buffer as ArrayBuffer),
    w = await getWorld(env, "w");
  w.sourceImages = [
    {
      id: "img",
      assetId: "asset",
      label: "參考",
      sha256: hash,
      status: "available",
    },
  ];
  sqlite
    .prepare("UPDATE worlds SET document_json=? WHERE id='w'")
    .run(JSON.stringify(w));
  sqlite
    .prepare(
      "INSERT INTO assets(id,world_id,object_key,content_type,sha256,created_at) VALUES('asset','w','image','image/png',?,'now')",
    )
    .run(hash);
  sqlite
    .prepare(
      "INSERT INTO source_images(id,world_id,asset_id,label,sha256,created_at) VALUES('img','w','asset','參考',?,'now')",
    )
    .run(hash);
  const get = env.STORAGE.get.bind(env.STORAGE);
  env.STORAGE.get = (async (key: string) =>
    key === "image"
      ? { arrayBuffer: async () => bytes.buffer }
      : get(key)) as typeof env.STORAGE.get;
  const { fetcher, contexts } = model();
  const result = await finish();
  const withPixels = fetcher.mock.calls
    .map(([, init]) => JSON.parse(init!.body as string))
    .filter((body) => Array.isArray(body.messages[1].content));
  expect(withPixels).toHaveLength(2);
  expect(
    withPixels.every(
      (body) => body.messages[1].content[1].type === "image_url",
    ),
  ).toBe(true);
  expect(
    contexts.find((c) => c.stage === "fidelity").proposed.brief.referenceStatus,
  ).toBe("reviewed");
  expect(result.brief!.referenceStatus).toBe("reviewed");
  expect(result.sourceImages![0].status).toBe("reviewed");
});
it("fails closed for unavailable source pixels and never claims review", async () => {
  const w = await getWorld(env, "w");
  w.sourceImages = [
    {
      id: "missing",
      assetId: "missing",
      label: "參考",
      sha256: "hash",
      status: "available",
    },
  ];
  sqlite
    .prepare("UPDATE worlds SET document_json=? WHERE id='w'")
    .run(JSON.stringify(w));
  const { fetcher } = model();
  await step();
  await step();
  await expect(step()).rejects.toMatchObject({ code: "SOURCE_IMAGE_MISSING" });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect((await getWorld(env, "w")).sourceImages![0].status).toBe("available");
});

it("commits draft, source coverage, audit and job completion atomically and retries without paying again", async () => {
  const { fetcher } = model();
  for (let i = 0; i < 4; i++) await step();
  const batch = env.DB.batch.bind(env.DB);
  let fail = true;
  env.DB.batch = (async (statements) => {
    if (fail) {
      fail = false;
      throw new Error("final transaction unavailable");
    }
    return batch(statements);
  }) as typeof env.DB.batch;
  await expect(step()).rejects.toThrow("final transaction unavailable");
  expect((await getWorld(env, "w")).brief).toBeUndefined();
  expect(sqlite.prepare("SELECT status FROM jobs").get()).toMatchObject({
    status: "queued",
  });
  expect(
    sqlite
      .prepare("SELECT COUNT(*) AS n FROM audit WHERE type='brief.compiled'")
      .get(),
  ).toMatchObject({ n: 0 });
  await expect(step()).resolves.toMatchObject({ done: true, completed: 5 });
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(
    sqlite.prepare("SELECT COUNT(*) AS n FROM usage_ledger").get(),
  ).toMatchObject({ n: 4 });
  expect(
    sqlite.prepare("SELECT COUNT(*) AS n FROM messages").get(),
  ).toMatchObject({ n: 1 });
});
it("does not overwrite an author mutation between the delivery read and final commit", async () => {
  const { fetcher } = model();
  for (let i = 0; i < 4; i++) await step();
  const stale = await getWorld(env, "w");
  const changed = {
    ...stale,
    title: "Author changed title",
    revision: stale.revision + 1,
  };
  sqlite
    .prepare(
      "UPDATE worlds SET revision=?,lock_version=lock_version+1,document_json=? WHERE id='w'",
    )
    .run(changed.revision, JSON.stringify(changed));
  await expect(runBriefAnalysis(env, job, stale)).resolves.toMatchObject({
    done: false,
    completed: 0,
  });
  expect((await getWorld(env, "w")).title).toBe("Author changed title");
  expect((await getWorld(env, "w")).brief).toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(
    sqlite
      .prepare("SELECT COUNT(*) AS n FROM audit WHERE type='brief.compiled'")
      .get(),
  ).toMatchObject({ n: 0 });
});
it.each(["version", "sourceHash", "contextHash", "inputHash"])(
  "rejects a durable candidate with a forged %s before one replacement call",
  async (field) => {
    const { fetcher } = model();
    const batch = env.DB.batch.bind(env.DB);
    env.DB.batch = vi.fn(async () => {
      throw new Error("checkpoint unavailable");
    });
    await expect(step()).rejects.toThrow("checkpoint unavailable");
    env.DB.batch = batch;
    const key = [...objects.keys()].find((k) => k.endsWith("/reader:0.json"))!;
    const candidate = JSON.parse(objects.get(key)!);
    candidate[field] = "wrong";
    objects.set(key, JSON.stringify(candidate));
    await step();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(checkpointCount()).toBe(1);
  },
);
it("does not invent a replacement bill when a saved receipt cannot be tied to its original ledger entry", async () => {
  const { fetcher } = model();
  await step();
  const row = sqlite
    .prepare(
      "SELECT output_json FROM analysis_checkpoints WHERE stage='reader:0'",
    )
    .get() as { output_json: string };
  const candidate = JSON.parse(row.output_json);
  candidate.usageId = "another_operation";
  sqlite
    .prepare(
      "UPDATE analysis_checkpoints SET output_json=? WHERE stage='reader:0'",
    )
    .run(JSON.stringify(candidate));
  await expect(step()).rejects.toMatchObject({
    code: "USAGE_CHECKPOINT_INVALID",
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(
    sqlite.prepare("SELECT COUNT(*) AS n FROM usage_ledger").get(),
  ).toMatchObject({ n: 1 });
});
it.each([
  {
    text: "The platform is made of copper mesh.",
    title: "Copper Platform",
    summary: "A platform made of copper mesh.",
    world: "銅網平台構成可見環境。",
    visual: "依銅網材質建立單一繪畫方向。",
    medium: "drawing",
    material: "copper mesh",
  },
  {
    text: "The hills are covered in violet moss.",
    title: "Violet Hills",
    summary: "Hills covered in violet moss.",
    world: "紫色苔蘚覆蓋山丘。",
    visual: "依紫色苔蘚形成柔和色彩方向。",
    medium: "watercolor",
    material: "moss",
  },
])(
  "supports the same six-part contract for unrelated neutral sources: $title",
  async (fixture) => {
    objects.set("text0", fixture.text);
    model((stage, value) => {
      if (stage.startsWith("reader:"))
        return {
          notes: [
            { section: "world", note: fixture.world, quote: fixture.text },
          ],
        };
      if (stage === "editor")
        return {
          ...value,
          title: fixture.title,
          summary: fixture.summary,
          brief: {
            ...brief(),
            world: fixture.world,
            visual: fixture.visual,
            evidence: [
              { section: "world", segmentId: "seg0", quote: fixture.text },
            ],
          },
        };
      if (stage === "visual")
        return {
          visual: fixture.visual,
          style: {
            ...style(),
            description: fixture.visual,
            medium: fixture.medium,
            materials: [fixture.material],
            evidence: [fixture.text],
          },
        };
      return value;
    });
    const result = await finish();
    expect(result.title).toBe(fixture.title);
    expect(result.summary).toBe(fixture.summary);
    expect(result.brief).toMatchObject({
      version: "world-brief/0.06",
      world: fixture.world,
      decisions: [],
    });
    expect(result.elements).toEqual([]);
    expect(result.styles[0].materials).toEqual([fixture.material]);
  },
);

it("merges duplicate necessary questions before assigning stable decision IDs", async () => {
  model((stage, value) => {
    if (stage === "fidelity")
      value.brief.decisions = ["one", "two"].map((id) => ({
        id,
        section: "time",
        question: "旅程何時開始？",
        suggestion: "保持原作時段",
        answer: "",
      }));
    return value;
  });
  const result = await finish();
  expect(result.brief!.decisions).toHaveLength(1);
  expect(result.brief!.decisions[0].id).toMatch(/^decision_[a-f0-9]{24}$/);
});
it("does not persist a whitespace-normalized quote that exceeds the compact schema", async () => {
  objects.set("text0", `A${" ".repeat(1600)}B`);
  model((stage, value) =>
    stage.startsWith("reader:")
      ? {
          notes: [
            { section: "world", note: "A material relationship", quote: "A B" },
          ],
        }
      : value,
  );
  await expect(step()).rejects.toMatchObject({
    code: "MODEL_CONTRACT_INVALID",
  });
  expect(checkpointCount()).toBe(0);
});
