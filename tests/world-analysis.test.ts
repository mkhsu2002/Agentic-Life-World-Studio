import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  analysisRoleSchemas,
  runWorldAnalysis,
} from "../src/server/world-analysis";
import { getWorld } from "../src/server/repository";
import { sha256 } from "../src/server/domain";
import { frameworkFixture, frameworkWorld } from "./fixtures/world-framework";
import type { Env } from "../src/server/env";

let sqlite: DatabaseSync, env: Env, objects: Map<string, string>;
const job = { id: "job", world_id: "w", completed: 0 };
const sourceText = "A room contains a stone. The door remains closed.";
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
const extraction = (segmentId: string) => ({
  elements: [
    {
      key: "room",
      kind: "place",
      sourceName: "Room",
      englishName: "Room",
      definition: "A room",
      aliases: [],
      features: [
        {
          id: "f",
          text: "A room",
          quote: "A room",
          segmentId,
          origin: "source",
          locked: false,
        },
      ],
    },
  ],
  facts: [],
  warnings: [],
});
const styles = () =>
  [1, 2, 3].map((i) => ({
    id: `s${i}`,
    name: `Direction ${i}`,
    description: "A depiction",
    medium: "ink",
    palette: ["gray"],
    lighting: "soft",
    materials: [],
    forbidden: [],
    evidence: [],
  }));
const envelope = {
  id: "scope",
  title: "Local details",
  scope: "The room",
  allowedChanges: ["Surface detail"],
  limits: ["Inside room"],
  prohibitedChanges: ["Change boundary"],
  decision: "accepted",
};
const outputs = (stage: string, context: any) => {
  const f = frameworkFixture();
  f.anchors[0].evidence = [
    { segmentId: "seg0", quote: "The door remains closed." },
  ];
  if (stage === "architect")
    return {
      title: "Room",
      summary: "A room",
      modules: f.modules,
      anchors: f.anchors,
      issues: [],
    };
  if (["civilization", "geography", "ecology"].includes(stage)) {
    const keys =
      stage === "civilization"
        ? ["time", "laws", "civilization"]
        : stage === "geography"
          ? ["space", "environment"]
          : ["life"];
    return {
      modules: f.modules.filter((m) => keys.includes(m.key)),
      anchors: [],
      extensions: [],
    };
  }
  if (stage === "visual")
    return {
      module: f.modules[7],
      visual: { ...f.visual, referenceStatus: "reviewed" },
      styles: styles(),
      audience: f.audience,
      exploration: { ...f.exploration, startPlace: context.elements[0].id },
    };
  if (stage === "naming")
    return { naming: f.naming, relations: [], envelopes: [envelope] };
  return { verdict: "pass", notes: [], issues: [] };
};
function model(
  transform: (stage: string, value: any, context: any) => any = (_s, value) =>
    value,
) {
  const contexts: any[] = [];
  const fetcher = vi.fn(async (_input: unknown, init?: RequestInit) => {
    const content = JSON.parse(init!.body as string).messages[1].content;
    const c = JSON.parse(
      typeof content === "string" ? content : content[0].text,
    );
    contexts.push(c);
    return Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify(transform(c.stage, outputs(c.stage, c), c)),
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
  });
  vi.stubGlobal("fetch", fetcher);
  return { fetcher, contexts };
}
async function step() {
  return runWorldAnalysis(env, job, await getWorld(env, "w"));
}
async function finish() {
  for (let i = 0; i < 12; i++)
    if ((await step()).done) return getWorld(env, "w");
  throw new Error("not finished");
}
const count = () =>
  (
    sqlite.prepare("SELECT COUNT(*) AS n FROM analysis_checkpoints").get() as {
      n: number;
    }
  ).n;
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  for (const path of [
    "0001_studio",
    "0002_job_keys",
    "0003_active_jobs",
    "0004_import_dialogue",
    "0005_world_framework",
  ])
    sqlite.exec(readFileSync(`migrations/${path}.sql`, "utf8"));
  const w = frameworkWorld();
  delete w.framework;
  w.status = "reading";
  sqlite
    .prepare(
      "INSERT INTO sources(id,title,kind,sha256,char_count,segment_count,processed_count,created_at) VALUES('s','Source','text','hash',50,1,1,'now')",
    )
    .run();
  sqlite
    .prepare(
      "INSERT INTO worlds(id,source_id,revision,document_json,created_at,updated_at) VALUES('w','s',1,?,'now','now')",
    )
    .run(JSON.stringify(w));
  sqlite
    .prepare(
      "INSERT INTO jobs(id,world_id,kind,status,stage,total,payload_json,created_at,updated_at) VALUES('job','w','import','queued','reading',8,'{}','now','now')",
    )
    .run();
  sqlite
    .prepare(
      "INSERT INTO segments(id,source_id,ordinal,start_offset,end_offset,text_key,result_json,status) VALUES('seg0','s',0,0,50,'text0',?,'done')",
    )
    .run(JSON.stringify(extraction("seg0")));
  objects = new Map([["text0", sourceText]]);
  env = {
    DB: {
      prepare: (sql: string) => new Statement(sql),
      batch: async (statements: Statement[]) => {
        sqlite.exec("BEGIN");
        try {
          const r = statements.map((s) => s.execute());
          sqlite.exec("COMMIT");
          return r;
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

it.each([
  ["civilization", ["time", "laws", "civilization"]],
  ["geography", ["space", "environment"]],
  ["ecology", ["life"]],
] as const)(
  "validates exact %s module ownership and permits no domain anchors",
  (role, keys) => {
    const f = frameworkFixture();
    const schema = analysisRoleSchemas[role];
    expect(
      schema.safeParse({
        modules: f.modules.filter((m) => keys.includes(m.key as never)),
        anchors: [],
        extensions: [],
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        modules: f.modules,
        anchors: f.anchors,
        extensions: [],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        modules: keys.map(() => f.modules.find((m) => m.key === keys[0])),
        anchors: [],
        extensions: [],
      }).success,
    ).toBe(keys.length === 1);
  },
);
it("rejects nonvisual modules and duplicate style IDs in the visual contract", () => {
  const f = frameworkFixture();
  const value = outputs("visual", { elements: [{ id: "e" }] }) as any;
  expect(
    analysisRoleSchemas.visual.safeParse({ ...value, module: f.modules[0] })
      .success,
  ).toBe(false);
  value.styles[1].id = value.styles[0].id;
  expect(analysisRoleSchemas.visual.safeParse(value).success).toBe(false);
});
it("rejects duplicate relation and envelope IDs before any persistence", () => {
  const f = frameworkFixture();
  const relation = {
    id: "r",
    subjectId: "e",
    objectId: "e",
    predicate: "within",
    definition: "Scoped",
  };
  expect(
    analysisRoleSchemas.naming.safeParse({
      naming: f.naming,
      relations: [relation, relation],
      envelopes: [],
    }).success,
  ).toBe(false);
  expect(
    analysisRoleSchemas.naming.safeParse({
      naming: f.naming,
      relations: [],
      envelopes: [envelope, envelope],
    }).success,
  ).toBe(false);
});
it.each(["visual", "naming"])(
  "rejects unknown element references in %s before checkpoint and candidate writes",
  async (stage) => {
    model((s, value) => {
      if (s === stage) {
        if (s === "visual") value.exploration.startPlace = "missing";
        else
          value.relations = [
            {
              id: "r",
              subjectId: "missing",
              objectId: "missing",
              predicate: "near",
              definition: "Unsupported",
            },
          ];
      }
      return value;
    });
    for (let i = 0; i < (stage === "visual" ? 4 : 5); i++) await step();
    await expect(step()).rejects.toMatchObject({
      code: "MODEL_CONTRACT_INVALID",
    });
    expect(
      sqlite
        .prepare("SELECT stage FROM analysis_checkpoints WHERE stage=?")
        .get(stage),
    ).toBeUndefined();
    expect(
      [...objects.keys()].some((key) => key.endsWith(`/${stage}.json`)),
    ).toBe(false);
  },
);
it("supplies the full normalized proposal to fidelity and keeps all author decisions pending", async () => {
  const { contexts, fetcher } = model();
  const w = await finish();
  const proposed = contexts.find((c) => c.stage === "fidelity:0").proposedWorld;
  expect(proposed.envelopes).toHaveLength(1);
  expect(proposed.envelopes[0].decision).toBe("pending");
  expect(proposed.styles).toEqual(styles());
  expect(proposed.visual.referenceStatus).toBe("not_provided");
  expect(w.framework?.envelopes[0].decision).toBe("pending");
  expect(w.frameworkApproval).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(7);
});
it("keeps same-name source entries distinct and supplies private identity uncertainty", async () => {
  sqlite.prepare("UPDATE sources SET segment_count=2,processed_count=2").run();
  sqlite
    .prepare(
      "INSERT INTO segments(id,source_id,ordinal,start_offset,end_offset,text_key,result_json,status) VALUES('seg1','s',1,50,100,'text1',?,'done')",
    )
    .run(JSON.stringify(extraction("seg1")));
  objects.set("text1", sourceText);
  const { contexts } = model();
  await finish();
  const naming = contexts.find((c) => c.stage === "naming");
  expect(naming.elements).toHaveLength(2);
  expect(new Set(naming.elements.map((e: any) => e.id)).size).toBe(2);
  expect(naming.sourceElementScopes.map((e: any) => e.segmentId)).toEqual([
    "seg0",
    "seg1",
  ]);
  expect(naming.identityAmbiguities).toHaveLength(1);
  expect(naming.identityAmbiguities[0].status).toBe("unresolved");
});
it("blocks missing or fabricated core evidence, removes false quotes, and only warns for other modules", async () => {
  model((stage, value) => {
    if (stage === "architect") {
      value.anchors = [
        {
          id: "empty",
          module: "identity",
          definition: "Core boundary",
          evidence: [],
        },
        {
          id: "fake",
          module: "laws",
          definition: "Core law",
          evidence: [
            { segmentId: "seg0", quote: "A fabricated source passage" },
          ],
        },
      ];
    }
    if (stage === "geography") {
      value.modules[0].status = "known";
      value.modules[0].evidence = [
        { segmentId: "seg0", quote: "A room containz a stone." },
      ];
    }
    return value;
  });
  const w = await finish();
  const f = w.framework!;
  expect(f.fidelity.verdict).toBe("needs_confirmation");
  expect(f.anchors.every((a) => !a.evidence.length)).toBe(true);
  expect(f.issues.filter((i) => i.blocking).map((i) => i.module)).toEqual(
    expect.arrayContaining(["identity", "laws"]),
  );
  expect(f.issues.some((i) => i.module === "space" && !i.blocking)).toBe(true);
  expect(f.issues.some((i) => i.module === "space" && i.blocking)).toBe(false);
  expect(f.modules.find((m) => m.key === "space")).toMatchObject({
    basis: "source_inferred",
    evidence: [],
  });
  expect(f.issues.every((i) => i.resolution === "")).toBe(true);
});
it("repairs an invalid stored role and discards only that stage and its downstream outputs", async () => {
  const { fetcher } = model();
  for (let i = 0; i < 7; i++) await step();
  sqlite
    .prepare(
      "UPDATE analysis_checkpoints SET output_json=? WHERE stage='visual'",
    )
    .run(JSON.stringify({ invalid: true }));
  await step();
  expect(fetcher).toHaveBeenCalledTimes(8);
  expect(count()).toBe(5);
  expect(
    sqlite
      .prepare("SELECT stage FROM analysis_checkpoints WHERE stage='naming'")
      .get(),
  ).toBeUndefined();
  await step();
  expect(fetcher).toHaveBeenCalledTimes(9);
  expect(count()).toBe(6);
});
it("reuses a model result persisted to R2 before a checkpoint transaction fails", async () => {
  const { fetcher } = model();
  const batch = env.DB.batch.bind(env.DB);
  let fail = true;
  env.DB.batch = (async (statements) => {
    if (fail) {
      fail = false;
      throw new Error("transient checkpoint failure");
    }
    return batch(statements);
  }) as typeof env.DB.batch;
  await expect(step()).rejects.toThrow("transient checkpoint failure");
  expect(count()).toBe(0);
  const candidateKey = [...objects.keys()].find((k) =>
    k.endsWith("/architect.json"),
  );
  expect(candidateKey).toBeDefined();
  const candidate = JSON.parse(objects.get(candidateKey!)!);
  expect(candidate.createdAt).toEqual(expect.any(String));
  await step();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(count()).toBe(1);
  expect(
    sqlite.prepare("SELECT created_at FROM analysis_checkpoints").get(),
  ).toMatchObject({ created_at: candidate.createdAt });
  expect(
    sqlite
      .prepare(
        "SELECT COUNT(*) AS n FROM audit WHERE type='analysis.role_completed'",
      )
      .get(),
  ).toMatchObject({ n: 1 });
});
it("discards invalid R2 candidates before retrying once with the model", async () => {
  const { fetcher } = model();
  const batch = env.DB.batch.bind(env.DB);
  env.DB.batch = vi.fn(async () => {
    throw new Error("checkpoint");
  });
  await expect(step()).rejects.toThrow("checkpoint");
  env.DB.batch = batch;
  const key = [...objects.keys()].find((k) => k.endsWith("/architect.json"));
  expect(key).toBeDefined();
  const candidate = JSON.parse(objects.get(key!)!);
  candidate.value = { broken: true };
  objects.set(key!, JSON.stringify(candidate));
  await step();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(count()).toBe(1);
});
it("restores incurred usage from the durable candidate after the post-model ledger write fails", async () => {
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
  expect(count()).toBe(0);
  await step();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(count()).toBe(1);
  expect(
    sqlite
      .prepare("SELECT status,input_tokens,output_tokens FROM usage_ledger")
      .all(),
  ).toEqual([{ status: "incurred", input_tokens: 10, output_tokens: 5 }]);
});
it.each(["visual", "naming"])(
  "revalidates dynamic references in persisted %s checkpoints",
  async (stage) => {
    const { fetcher } = model();
    for (let i = 0; i < 7; i++) await step();
    const row = sqlite
      .prepare("SELECT output_json FROM analysis_checkpoints WHERE stage=?")
      .get(stage) as { output_json: string };
    const value = JSON.parse(row.output_json);
    if (stage === "visual") value.exploration.startPlace = "missing";
    else
      value.relations = [
        {
          id: "r",
          subjectId: "missing",
          objectId: "missing",
          predicate: "near",
          definition: "Invalid scoped relation",
        },
      ];
    sqlite
      .prepare("UPDATE analysis_checkpoints SET output_json=? WHERE stage=?")
      .run(JSON.stringify(value), stage);
    await step();
    expect(fetcher).toHaveBeenCalledTimes(8);
    expect(count()).toBe(stage === "visual" ? 5 : 6);
    const repaired = sqlite
      .prepare("SELECT output_json FROM analysis_checkpoints WHERE stage=?")
      .get(stage) as { output_json: string };
    expect(JSON.parse(repaired.output_json)).not.toEqual(value);
  },
);

it("uses actual supplied images to override the model reference status in fidelity", async () => {
  const bytes = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=",
    ),
    (char) => char.charCodeAt(0),
  );
  const hash = await sha256(bytes.buffer as ArrayBuffer);
  const w = await getWorld(env, "w");
  w.sourceImages = [
    {
      id: "img",
      assetId: "asset",
      label: "Source reference",
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
      "INSERT INTO source_images(id,world_id,asset_id,label,sha256,created_at) VALUES('img','w','asset','Source reference',?,'now')",
    )
    .run(hash);
  const get = env.STORAGE.get.bind(env.STORAGE);
  env.STORAGE.get = (async (key: string) =>
    key === "image"
      ? { arrayBuffer: async () => bytes.buffer }
      : get(key)) as typeof env.STORAGE.get;
  const { contexts, fetcher } = model((stage, value) => {
    if (stage === "visual") value.visual.referenceStatus = "not_provided";
    return value;
  });
  const result = await finish();
  expect(
    contexts.find((c) => c.stage === "fidelity:0").proposedWorld.visual
      .referenceStatus,
  ).toBe("reviewed");
  expect(result.framework!.visual.referenceStatus).toBe("reviewed");
  const visualRequest = fetcher.mock.calls
    .map(([, init]) => JSON.parse(init!.body as string))
    .find((body) => Array.isArray(body.messages[1].content));
  expect(visualRequest.messages[1].content[1].type).toBe("image_url");
});
it("assembles more than thirty valid anchors and extensions across domain roles", async () => {
  model((stage, value) => {
    if (stage === "architect")
      value.anchors = Array.from({ length: 15 }, (_, i) => ({
        ...value.anchors[0],
        id: `a${i}`,
      }));
    if (["civilization", "geography", "ecology"].includes(stage)) {
      value.anchors = Array.from({ length: 10 }, (_, i) => ({
        id: `a${i}`,
        module: value.modules[0].key,
        definition: `Core boundary ${i}`,
        evidence: [{ segmentId: "seg0", quote: "The door remains closed." }],
      }));
      value.extensions = Array.from({ length: 15 }, (_, i) => ({
        id: `x${i}`,
        module: value.modules[0].key,
        title: `Optional detail ${i}`,
        definition: "A proposed local detail",
        reason: "Optional depiction",
        limits: "Inside the room",
        decision: "accepted",
      }));
    }
    return value;
  });
  const w = await finish();
  expect(w.framework!.anchors).toHaveLength(45);
  expect(w.framework!.extensions).toHaveLength(45);
  expect(w.framework!.extensions.every((e) => e.decision === "pending")).toBe(
    true,
  );
});
it("keeps each role limited to thirty anchors, extensions, and issues", () => {
  const context = { elements: [{ id: "e" }] };
  const anchor = {
    id: "a",
    module: "identity",
    definition: "A core boundary",
    evidence: [],
  };
  const issue = {
    id: "i",
    module: "identity",
    message: "A material question",
    recommendation: "Confirm the boundary",
    blocking: true,
    resolution: "",
  };
  const extension = {
    id: "x",
    module: "life",
    title: "Optional detail",
    definition: "Local detail",
    reason: "Depiction",
    limits: "Local",
    decision: "pending",
  };
  const repeated = (base: any, count: number) =>
    Array.from({ length: count }, (_, i) => ({ ...base, id: `id${i}` }));
  for (const role of [
    "architect",
    "civilization",
    "geography",
    "ecology",
  ] as const) {
    const value = outputs(role, context) as any;
    expect(
      analysisRoleSchemas[role].safeParse({
        ...value,
        anchors: repeated(anchor, 30),
      }).success,
    ).toBe(true);
    expect(
      analysisRoleSchemas[role].safeParse({
        ...value,
        anchors: repeated(anchor, 31),
      }).success,
    ).toBe(false);
    if (role !== "architect") {
      expect(
        analysisRoleSchemas[role].safeParse({
          ...value,
          extensions: repeated(extension, 30),
        }).success,
      ).toBe(true);
      expect(
        analysisRoleSchemas[role].safeParse({
          ...value,
          extensions: repeated(extension, 31),
        }).success,
      ).toBe(false);
    }
  }
  for (const role of ["architect", "fidelity"] as const) {
    const value = outputs(role, context) as any;
    expect(
      analysisRoleSchemas[role].safeParse({
        ...value,
        issues: repeated(issue, 30),
      }).success,
    ).toBe(true);
    expect(
      analysisRoleSchemas[role].safeParse({
        ...value,
        issues: repeated(issue, 31),
      }).success,
    ).toBe(false);
  }
});
it("retains all issues and fidelity notes when combining multiple source reviews", async () => {
  sqlite.prepare("UPDATE sources SET segment_count=3,processed_count=3").run();
  for (let i = 1; i < 3; i++) {
    sqlite
      .prepare(
        "INSERT INTO segments(id,source_id,ordinal,start_offset,end_offset,text_key,result_json,status) VALUES(?,'s',?,0,50,?,?,'done')",
      )
      .run(`seg${i}`, i, `text${i}`, JSON.stringify(extraction(`seg${i}`)));
    objects.set(`text${i}`, sourceText);
  }
  model((stage, value) => {
    if (stage.startsWith("fidelity:")) {
      value.notes = Array.from(
        { length: 20 },
        (_, i) => `${stage} reviewed observation ${i}`,
      );
      value.issues = Array.from({ length: 20 }, (_, i) => ({
        id: `i${i}`,
        module: "identity",
        message: `${stage} material question ${i}`,
        recommendation: "Confirm scope",
        blocking: true,
        resolution: "",
      }));
    }
    return value;
  });
  const w = await finish();
  expect(w.framework!.issues).toHaveLength(60);
  expect(w.framework!.fidelity.notes).toHaveLength(60);
  expect(w.framework!.fidelity.verdict).toBe("needs_confirmation");
});
it("enforces fidelity note size before checkpointing while preserving the twenty-note role limit", () => {
  const notes = Array.from({ length: 20 }, () => "A bounded review note");
  expect(
    analysisRoleSchemas.fidelity.safeParse({
      verdict: "pass",
      notes,
      issues: [],
    }).success,
  ).toBe(true);
  expect(
    analysisRoleSchemas.fidelity.safeParse({
      verdict: "pass",
      notes: [...notes, "extra"],
      issues: [],
    }).success,
  ).toBe(false);
  expect(
    analysisRoleSchemas.fidelity.safeParse({
      verdict: "pass",
      notes: ["x".repeat(6001)],
      issues: [],
    }).success,
  ).toBe(false);
});
