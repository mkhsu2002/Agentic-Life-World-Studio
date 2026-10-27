import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Env } from "../src/server/env";
import type { Element, Translation, WorldDraft } from "../src/shared/contracts";
import { getWorld, saveWorld } from "../src/server/repository";
import { translationHash } from "../src/server/domain";
import { TRANSLATOR } from "../src/server/prompts";
import {
  partitionLocalization,
  runLocalization,
  validateLocalizationChunk,
} from "../src/server/localization";

let sqlite: DatabaseSync;
let env: Env;
let objects: Map<string, string>;
let calls: { system: string; context: Record<string, any> }[];
let respond: (system: string, context: Record<string, any>) => unknown;

const element = (index: number): Element => ({
  id: `e${index}`,
  kind: "place",
  sourceName: `原名${index}`,
  names: {
    en: `Place ${index}`,
    "zh-Hant": `地點${index}`,
    ja: `場所${index}`,
  },
  definition: `Definition ${index}`,
  aliases: [],
  features: [
    {
      id: `f${index}`,
      text: `Feature ${index}`,
      quote: `私有原文${index}`,
      segmentId: "segment",
      origin: "source",
      locked: true,
    },
  ],
});

function world(count = 9): WorldDraft {
  return {
    id: "w",
    recordVersion: 1,
    title: "World",
    revision: 1,
    status: "draft",
    sourceId: "s",
    summary: "World summary",
    era: "Unknown",
    geography: "Unknown",
    ecology: "Unknown",
    rules: ["One rule"],
    elements: Array.from({ length: count }, (_, index) => element(index)),
    questions: [],
    styles: [],
    selectedStyleId: null,
    visualApproval: null,
    mode: "mixed",
    translations: {},
    previews: [],
    createdAt: "now",
    updatedAt: "now",
  };
}

function bundle(elements: Element[], title = "Translated world") {
  return {
    title,
    tagline: "Explore the world",
    introduction: "A public introduction",
    elements: elements.map((e) => ({
      id: e.id,
      name: e.names.en,
      definition: e.definition,
      features: e.features.map((f) => ({ id: f.id, text: f.text })),
    })),
  };
}

function existingTranslation(w: WorldDraft): Translation {
  const output = bundle(w.elements, "Author corrected title");
  return {
    locale: "en",
    sourceRevision: w.revision,
    status: "draft",
    approvedAt: null,
    title: output.title,
    tagline: output.tagline,
    introduction: output.introduction,
    elements: Object.fromEntries(
      output.elements.map((e) => [
        e.id,
        {
          name: e.name,
          definition: e.definition,
          features: Object.fromEntries(e.features.map((f) => [f.id, f.text])),
        },
      ]),
    ),
    issues: ["Previous review"],
  };
}

class Statement {
  values: unknown[] = [];
  constructor(readonly sql: string) {}
  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }
  execute() {
    const query = sqlite.prepare(this.sql);
    if (/^\s*SELECT/i.test(this.sql))
      return {
        results: query.all(...(this.values as never[])),
        meta: { changes: 0 },
        success: true,
      };
    return {
      results: [],
      meta: { changes: Number(query.run(...(this.values as never[])).changes) },
      success: true,
    };
  }
  async first() {
    return this.execute().results[0] || null;
  }
  async all() {
    return this.execute();
  }
  async run() {
    return this.execute();
  }
}

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  for (const path of [
    "0001_studio.sql",
    "0002_job_keys.sql",
    "0003_active_jobs.sql",
  ])
    sqlite.exec(readFileSync(`migrations/${path}`, "utf8"));
  objects = new Map();
  calls = [];
  env = {
    DB: {
      prepare: (sql: string) => new Statement(sql),
      batch: async (statements: Statement[]) => {
        sqlite.exec("BEGIN");
        try {
          const results = statements.map((s) => s.execute());
          sqlite.exec("COMMIT");
          return results;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
    } as unknown as D1Database,
    STORAGE: {
      get: async (key: string) =>
        objects.has(key) ? { text: async () => objects.get(key)! } : null,
      put: async (key: string, value: string) => {
        objects.set(key, value);
      },
    } as unknown as R2Bucket,
    MODEL_API_KEY: "test-only-provider-key",
  } as Env;
  sqlite
    .prepare(
      "INSERT INTO sources(id,title,kind,sha256,char_count,segment_count,created_at) VALUES('s','Source','text','hash',1,1,'now')",
    )
    .run();
  sqlite
    .prepare(
      "INSERT INTO worlds(id,source_id,revision,document_json,created_at,updated_at) VALUES('w','s',1,?,'now','now')",
    )
    .run(JSON.stringify(world()));
  respond = (system, context) =>
    system === TRANSLATOR
      ? bundle(
          context.world.elements,
          calls.length === 1 ? "First chunk title" : "Ignored later title",
        )
      : { verdict: "pass", issues: [] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, options: RequestInit) => {
      const body = JSON.parse(String(options.body));
      const system = body.messages[0].content as string;
      const context = JSON.parse(body.messages[1].content) as Record<
        string,
        any
      >;
      calls.push({ system, context });
      const value = await respond(system, context);
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify(value) },
            },
          ],
          usage: { prompt_tokens: 13, completion_tokens: 7 },
        }),
        { status: 200 },
      );
    }),
  );
});
afterEach(() => {
  sqlite.close();
  vi.unstubAllGlobals();
});

async function job(completed = 0) {
  const w = await getWorld(env, "w");
  return {
    id: "job",
    world_id: "w",
    completed,
    total: Math.max(1, Math.ceil(w.elements.length / 8)) + 1,
    payload_json: JSON.stringify({
      revision: w.revision,
      locale: "en",
      translationHash: await translationHash(w.translations.en),
    }),
  };
}

it("partitions 105 elements without losing identity and reserves a summary chunk for an empty world", () => {
  const input = world(105).elements;
  const chunks = partitionLocalization(input);
  expect(chunks.map((chunk) => chunk.length)).toEqual([
    ...Array(13).fill(8),
    1,
  ]);
  expect(chunks.flat()).toEqual(input);
  expect(partitionLocalization([])).toEqual([[]]);
});

it.each([
  "duplicate element",
  "missing element",
  "unknown element",
  "duplicate feature",
  "missing feature",
  "unknown feature",
])(
  "rejects a chunk with %s instead of silently collapsing it into a record",
  (kind) => {
    const elements = world(2).elements;
    const output = bundle(elements);
    if (kind === "duplicate element") output.elements.push(output.elements[0]);
    if (kind === "missing element") output.elements.pop();
    if (kind === "unknown element") output.elements[0].id = "unknown";
    if (kind === "duplicate feature")
      output.elements[0].features.push(output.elements[0].features[0]);
    if (kind === "missing feature") output.elements[0].features = [];
    if (kind === "unknown feature")
      output.elements[0].features[0].id = "unknown";
    expect(() => validateLocalizationChunk(elements, output)).toThrow();
  },
);

it("accepts a complete chunk even when the provider reorders elements and features", () => {
  const elements = world(2).elements;
  const output = bundle(elements);
  output.elements.reverse();
  expect(() => validateLocalizationChunk(elements, output)).not.toThrow();
});

it("processes at most eight elements per invocation, replays its checkpoint, then atomically merges the registry", async () => {
  const pending = await job();
  expect(await runLocalization(env, pending, false)).toMatchObject({
    done: false,
    completed: 1,
  });
  expect(calls).toHaveLength(2);
  expect(calls.every((call) => call.context.world.elements.length === 8)).toBe(
    true,
  );
  expect(Object.keys(calls[0].context.world).sort()).toEqual([
    "ecology",
    "elements",
    "era",
    "geography",
    "questions",
    "rules",
    "summary",
  ]);
  expect(objects.has("jobs/job/localization/0.json")).toBe(true);
  expect((await getWorld(env, "w")).translations.en).toBeUndefined();
  await runLocalization(env, pending, false);
  expect(calls).toHaveLength(2);
  await runLocalization(env, { ...pending, completed: 1 }, false);
  expect(calls).toHaveLength(4);
  expect(calls[2].context.world.elements).toHaveLength(1);
  expect(
    await runLocalization(env, { ...pending, completed: 2 }, false),
  ).toMatchObject({ done: true, completed: 3 });
  expect(calls).toHaveLength(4);
  const translated = (await getWorld(env, "w")).translations.en!;
  expect(translated.title).toBe("First chunk title");
  expect(Object.keys(translated.elements)).toHaveLength(9);
  expect(JSON.stringify(translated)).not.toContain("私有原文");
  expect(
    sqlite
      .prepare(
        "SELECT name,status FROM terms WHERE element_id='e8' AND locale='en'",
      )
      .get(),
  ).toEqual({ name: "Place 8", status: "review" });
  expect(
    sqlite
      .prepare(
        "SELECT COUNT(*) AS n FROM audit WHERE type='translation.reviewed'",
      )
      .get(),
  ).toEqual({ n: 1 });
  expect(
    sqlite
      .prepare(
        "SELECT COUNT(*) AS n,SUM(input_tokens) AS input,SUM(output_tokens) AS output FROM usage_ledger WHERE status='incurred' AND model='muse-spark-1.3' AND job_id='job'",
      )
      .get(),
  ).toEqual({ n: 4, input: 52, output: 28 });
});

it("retains a successful generated chunk when QA fails so retry only pays for QA", async () => {
  const pending = await job();
  respond = (system, context) => {
    if (system === TRANSLATOR) return bundle(context.world.elements);
    throw new Error("provider connection lost");
  };
  await expect(runLocalization(env, pending, false)).rejects.toThrow(
    "provider connection lost",
  );
  expect(
    sqlite.prepare("SELECT status FROM usage_ledger ORDER BY rowid").all(),
  ).toEqual([{ status: "incurred" }, { status: "uncertain" }]);
  respond = () => ({ verdict: "pass", issues: [] });
  await runLocalization(env, pending, false);
  expect(calls.filter((call) => call.system === TRANSLATOR)).toHaveLength(1);
  expect(calls).toHaveLength(3);
});

it("rejects missing model IDs before semantic review and does not modify the translation", async () => {
  respond = () => bundle([]);
  await expect(runLocalization(env, await job(), false)).rejects.toMatchObject({
    code: "TRANSLATION_CHUNK_INVALID",
  });
  expect(calls).toHaveLength(1);
  expect((await getWorld(env, "w")).translations.en).toBeUndefined();
});

it("aggregates issues from every chunk while preserving the full candidate for author calibration", async () => {
  const pending = await job();
  respond = (system, context) =>
    system === TRANSLATOR
      ? bundle(context.world.elements)
      : {
          verdict: "revise",
          issues: [`Review ${context.world.elements[0].id}`],
        };
  await runLocalization(env, pending, false);
  await runLocalization(env, { ...pending, completed: 1 }, false);
  await runLocalization(env, { ...pending, completed: 2 }, false);
  expect((await getWorld(env, "w")).translations.en?.issues).toEqual([
    "Review e0",
    "Review e8",
  ]);
});

it("review-only performs one QA per chunk and leaves all author content byte-for-byte intact", async () => {
  const w = await getWorld(env, "w");
  w.translations.en = existingTranslation(w);
  await saveWorld(env, w, w.revision, "seed", "seed");
  const before = await translationHash(w.translations.en);
  const pending = await job();
  await runLocalization(env, pending, true);
  await runLocalization(env, { ...pending, completed: 1 }, true);
  await runLocalization(env, { ...pending, completed: 2 }, true);
  const current = (await getWorld(env, "w")).translations.en!;
  expect(calls).toHaveLength(2);
  expect(calls.some((call) => call.system === TRANSLATOR)).toBe(false);
  expect(await translationHash(current)).toBe(before);
  expect(current.status).toBe("review");
  expect(current.issues).toEqual([]);
});

it("checks the payload hash before using a checkpoint after an author correction", async () => {
  const pending = await job();
  await runLocalization(env, pending, false);
  const edited = await getWorld(env, "w");
  edited.translations.en = existingTranslation(edited);
  await saveWorld(
    env,
    edited,
    edited.revision,
    "author",
    "Author corrected translation",
  );
  await expect(runLocalization(env, pending, false)).rejects.toMatchObject({
    code: "TRANSLATION_CHANGED",
  });
  expect(calls).toHaveLength(2);
});

it("checks a fresh world immediately before the final merge so a concurrent correction wins", async () => {
  const pending = await job();
  await runLocalization(env, pending, false);
  await runLocalization(env, { ...pending, completed: 1 }, false);
  const get = env.STORAGE.get.bind(env.STORAGE);
  let corrected = false;
  env.STORAGE.get = (async (...args: Parameters<R2Bucket["get"]>) => {
    if (!corrected) {
      corrected = true;
      const edited = await getWorld(env, "w");
      edited.translations.en = existingTranslation(edited);
      await saveWorld(
        env,
        edited,
        edited.revision,
        "author",
        "Author correction",
      );
    }
    return get(...args);
  }) as R2Bucket["get"];
  await expect(
    runLocalization(env, { ...pending, completed: 2 }, false),
  ).rejects.toMatchObject({ code: "TRANSLATION_CHANGED" });
  expect((await getWorld(env, "w")).translations.en?.title).toBe(
    "Author corrected title",
  );
});

it("rejects a changed source revision before sending anything to the provider", async () => {
  const pending = await job();
  const changed = await getWorld(env, "w");
  changed.revision++;
  await saveWorld(env, changed, 1, "source", "Source changed");
  await expect(runLocalization(env, pending, false)).rejects.toMatchObject({
    code: "REVISION_CONFLICT",
  });
  expect(calls).toEqual([]);
});

it("reserves usage before the provider call and stops if author content changes during generation", async () => {
  const pending = await job();
  respond = async (_system, context) => {
    expect(sqlite.prepare("SELECT status FROM usage_ledger").all()).toEqual([
      { status: "reserved" },
    ]);
    const changed = await getWorld(env, "w");
    changed.translations.en = existingTranslation(changed);
    await saveWorld(env, changed, 1, "author", "Author correction");
    return bundle(context.world.elements);
  };
  await expect(runLocalization(env, pending, false)).rejects.toMatchObject({
    code: "TRANSLATION_CHANGED",
  });
  expect(objects.size).toBe(0);
  expect(
    sqlite
      .prepare("SELECT status,input_tokens,output_tokens FROM usage_ledger")
      .get(),
  ).toEqual({ status: "incurred", input_tokens: 13, output_tokens: 7 });
  expect((await getWorld(env, "w")).translations.en?.title).toBe(
    "Author corrected title",
  );
});

it("never forwards unrelated locked terminology into another chunk", async () => {
  const w = await getWorld(env, "w");
  w.translations.en = existingTranslation(w);
  await saveWorld(env, w, 1, "seed", "seed");
  const pending = await job();
  await runLocalization(env, { ...pending, completed: 1 }, false);
  expect(Object.keys(calls[0].context.lockedTerms)).toEqual(["e8"]);
});

it("does not merge until every checkpoint has semantic review", async () => {
  const pending = await job();
  await runLocalization(env, pending, false);
  await expect(
    runLocalization(env, { ...pending, completed: 2 }, false),
  ).rejects.toMatchObject({ code: "LOCALIZATION_CHECKPOINT_MISSING" });
  expect((await getWorld(env, "w")).translations.en).toBeUndefined();
});

it("checks final introduction completeness even when semantic QA already requested revision", async () => {
  const pending = await job();
  respond = (system, context) =>
    system === TRANSLATOR
      ? { ...bundle(context.world.elements), introduction: "" }
      : { verdict: "revise", issues: ["Rewrite introduction"] };
  await runLocalization(env, pending, false);
  await runLocalization(env, { ...pending, completed: 1 }, false);
  await expect(
    runLocalization(env, { ...pending, completed: 2 }, false),
  ).rejects.toMatchObject({ code: "TRANSLATION_INCOMPLETE" });
  expect((await getWorld(env, "w")).translations.en).toBeUndefined();
});
