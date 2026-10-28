import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeEach, expect, it } from "vitest";
import { Hono } from "hono";
import {
  sourceImageData,
  sourceImageRoutes,
  sourceImageStatements,
  validateSourceImageInputs,
} from "../src/server/source-images";
import { getWorld } from "../src/server/repository";
import { DomainError } from "../src/server/domain";
import type { Env } from "../src/server/env";
import type { WorldDraft } from "../src/shared/contracts";
let db: DatabaseSync, env: Env;
const objects = new Map<string, { bytes: Uint8Array; type: string }>();
const image = {
  label: "原作配圖",
  dataUrl: "data:image/png;base64,iVBORw0KGgo=",
};
class Statement {
  values: unknown[] = [];
  constructor(public sql: string) {}
  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }
  execute() {
    const q = db.prepare(this.sql);
    return /^\s*SELECT/i.test(this.sql)
      ? { results: q.all(...(this.values as never[])), meta: {} }
      : {
          results: [],
          meta: { changes: Number(q.run(...(this.values as never[])).changes) },
        };
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
function world(): WorldDraft {
  return {
    id: "w",
    sourceId: "s",
    title: "Source",
    revision: 1,
    recordVersion: 1,
    status: "reading",
    summary: "Preserve source",
    era: "unknown",
    geography: "unknown",
    ecology: "unknown",
    rules: [],
    elements: [],
    questions: [],
    styles: [],
    selectedStyleId: null,
    visualApproval: { previewId: "old", revision: 1, approvedAt: "now" },
    frameworkApproval: { hash: "old", revision: 1, approvedAt: "now" },
    translations: {},
    previews: [],
    mode: "mixed",
    createdAt: "now",
    updatedAt: "now",
  };
}
beforeEach(() => {
  objects.clear();
  db = new DatabaseSync(":memory:");
  for (const path of readdirSync("migrations")
    .filter((p) => p.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(`migrations/${path}`, "utf8"));
  env = {
    DB: {
      prepare: (sql: string) => new Statement(sql),
      batch: async (statements: Statement[]) => {
        db.exec("BEGIN");
        try {
          const result = statements.map((s) => s.execute());
          db.exec("COMMIT");
          return result;
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
      },
    } as unknown as D1Database,
    STORAGE: {
      put: async (
        key: string,
        bytes: Uint8Array,
        options: { httpMetadata: { contentType: string } },
      ) => {
        objects.set(key, { bytes, type: options.httpMetadata.contentType });
      },
      get: async (key: string) => {
        const value = objects.get(key);
        return value
          ? {
              arrayBuffer: async () => value.bytes.buffer,
              httpMetadata: { contentType: value.type },
            }
          : null;
      },
    } as unknown as R2Bucket,
  } as Env;
  db.prepare(
    "INSERT INTO sources(id,title,kind,sha256,char_count,segment_count,created_at) VALUES('s','Source','text','hash',10,1,'now')",
  ).run();
  db.prepare(
    "INSERT INTO worlds(id,source_id,revision,document_json,created_at,updated_at) VALUES('w','s',1,?,'now','now')",
  ).run(JSON.stringify(world()));
});
afterEach(() => db.close());
const app = new Hono<{ Bindings: Env }>()
  .route("/", sourceImageRoutes)
  .onError((e, c) =>
    c.json(
      { code: e instanceof DomainError ? e.code : "ERROR" },
      e instanceof DomainError ? (e.status as 409) : 500,
    ),
  );
function upload(body: unknown) {
  return app.request(
    "/worlds/w/source-images",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    env,
  );
}
it.each([
  { label: "remote", dataUrl: "https://example.com/image.png" },
  { label: "vector", dataUrl: "data:image/svg+xml;base64,PHN2Zy8+" },
  { label: "fake", dataUrl: "data:image/png;base64,PHN2Zy8+" },
  { label: "bad encoding", dataUrl: "data:image/png;base64,not valid!" },
])(
  "rejects remote, vector, malformed and mismatched images: $label",
  async (bad) => {
    await expect(validateSourceImageInputs([bad])).rejects.toMatchObject({
      code: "SOURCE_IMAGE_INVALID",
    });
  },
);
it("rejects over-limit image counts and bytes before persistence", async () => {
  await expect(
    validateSourceImageInputs(Array(7).fill(image)),
  ).rejects.toMatchObject({ code: "SOURCE_IMAGE_LIMIT" });
  await expect(
    validateSourceImageInputs([
      {
        ...image,
        dataUrl: `data:image/png;base64,${"A".repeat(3 * 1024 * 1024)}`,
      },
    ]),
  ).rejects.toMatchObject({ code: "SOURCE_IMAGE_TOO_LARGE" });
  expect(objects.size).toBe(0);
});
it("persists private bytes, asset, source image, revision and audit together and keeps reading", async () => {
  const result = await upload({ revision: 1, recordVersion: 1, image });
  expect(result.status).toBe(201);
  const w = await getWorld(env, "w");
  expect(w).toMatchObject({
    revision: 2,
    status: "reading",
    summary: "Preserve source",
    visualApproval: null,
    frameworkApproval: null,
  });
  expect(w.sourceImages).toHaveLength(1);
  expect(w.sourceImages?.[0].status).toBe("available");
  expect(db.prepare("SELECT COUNT(*) AS n FROM assets").get()).toMatchObject({
    n: 1,
  });
  expect(
    db.prepare("SELECT COUNT(*) AS n FROM source_images").get(),
  ).toMatchObject({ n: 1 });
  expect(db.prepare("SELECT COUNT(*) AS n FROM audit").get()).toMatchObject({
    n: 1,
  });
  expect(await sourceImageData(env, w)).toEqual([image.dataUrl]);
  expect((await getWorld(env, "w")).sourceImages?.[0].status).toBe("available");
});
it("restores identical bytes without incrementing content revision or duplicating records", async () => {
  expect((await upload({ revision: 1, recordVersion: 1, image })).status).toBe(
    201,
  );
  expect(
    (
      await upload({
        revision: 2,
        recordVersion: 2,
        image: { ...image, label: "Same bytes" },
      })
    ).status,
  ).toBe(200);
  expect((await getWorld(env, "w")).revision).toBe(2);
  expect(objects.size).toBe(1);
  expect(db.prepare("SELECT COUNT(*) AS n FROM audit").get()).toMatchObject({
    n: 2,
  });
});
it("rejects stale uploads before storing bytes", async () => {
  expect((await upload({ revision: 1, recordVersion: 9, image })).status).toBe(
    409,
  );
  expect(objects.size).toBe(0);
  expect((await getWorld(env, "w")).revision).toBe(1);
});
it("clears old framework and approvals without discarding extracted content or starting reading again", async () => {
  const w = { ...world(), status: "confirmed", framework: { old: true } };
  db.prepare("UPDATE worlds SET document_json=? WHERE id='w'").run(
    JSON.stringify(w),
  );
  expect((await upload({ revision: 1, recordVersion: 1, image })).status).toBe(
    201,
  );
  const updated = await getWorld(env, "w");
  expect(updated.framework).toBeUndefined();
  expect(updated.status).toBe("draft");
  expect(updated.summary).toBe(w.summary);
});
it("refuses model references whose asset belongs to another world", async () => {
  await upload({ revision: 1, recordVersion: 1, image });
  const w = await getWorld(env, "w");
  db.prepare(
    "INSERT INTO worlds(id,source_id,revision,document_json,created_at,updated_at) VALUES('other','s',1,?,'now','now')",
  ).run(JSON.stringify({ ...world(), id: "other" }));
  db.prepare("UPDATE assets SET world_id='other' WHERE id=?").run(
    w.sourceImages![0].assetId,
  );
  await expect(sourceImageData(env, w)).rejects.toMatchObject({
    code: "SOURCE_IMAGE_MISSING",
  });
  const response = await upload({
    revision: w.revision,
    recordVersion: w.recordVersion,
    image,
  });
  expect(response.status).toBe(409);
  expect(
    db
      .prepare("SELECT COUNT(*) AS n FROM audit WHERE type='image.restored'")
      .get(),
  ).toMatchObject({ n: 0 });
});
it("provides source-create statements without committing any partial database records", async () => {
  const w = world();
  const statements = await sourceImageStatements(
    env,
    w,
    await validateSourceImageInputs([image, image]),
  );
  expect(statements).toHaveLength(2);
  expect(w.sourceImages).toHaveLength(1);
  expect(db.prepare("SELECT COUNT(*) AS n FROM assets").get()).toMatchObject({
    n: 0,
  });
  await env.DB.batch(statements);
  expect(
    db.prepare("SELECT COUNT(*) AS n FROM source_images").get(),
  ).toMatchObject({ n: 1 });
});

it("rejects more than 6 MB total decoded images", async () => {
  const bytes = new Uint8Array(1600 * 1024);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const dataUrl = `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
  await expect(
    validateSourceImageInputs(Array(4).fill({ label: "Source", dataUrl })),
  ).rejects.toMatchObject({ code: "SOURCE_IMAGE_TOTAL_TOO_LARGE" });
});

it("rolls back asset, reference and audit when another mutation wins the world lock", async () => {
  const batch = env.DB.batch.bind(env.DB);
  env.DB.batch = (async (statements: D1PreparedStatement[]) => {
    db.prepare("UPDATE worlds SET lock_version=2 WHERE id='w'").run();
    return batch(statements);
  }) as typeof env.DB.batch;
  const response = await upload({ revision: 1, recordVersion: 1, image });
  expect(response.status).toBe(409);
  expect((await getWorld(env, "w")).revision).toBe(1);
  expect(db.prepare("SELECT COUNT(*) AS n FROM assets").get()).toMatchObject({
    n: 0,
  });
  expect(
    db.prepare("SELECT COUNT(*) AS n FROM source_images").get(),
  ).toMatchObject({ n: 0 });
  expect(db.prepare("SELECT COUNT(*) AS n FROM audit").get()).toMatchObject({
    n: 0,
  });
});

it.each(["missing", "corrupt"])(
  "restores a %s original object from the same validated image without invalidating approvals",
  async (failure) => {
    await upload({ revision: 1, recordVersion: 1, image });
    const w = await getWorld(env, "w");
    w.sourceImages![0].status = "reviewed";
    w.frameworkApproval = { hash: "approved", revision: 2, approvedAt: "now" };
    w.visualApproval = {
      previewId: "approved",
      revision: 2,
      approvedAt: "now",
    };
    db.prepare("UPDATE worlds SET document_json=? WHERE id='w'").run(
      JSON.stringify(w),
    );
    const key = Array.from(objects.keys())[0];
    if (failure === "missing") objects.delete(key);
    else
      objects.set(key, { bytes: new Uint8Array([1, 2, 3]), type: "image/png" });
    await expect(sourceImageData(env, w)).rejects.toBeInstanceOf(DomainError);
    const response = await upload({ revision: 2, recordVersion: 2, image });
    expect(response.status).toBe(200);
    const restored = await getWorld(env, "w");
    expect(await sourceImageData(env, restored)).toEqual([image.dataUrl]);
    expect(restored.revision).toBe(2);
    expect(restored.frameworkApproval).toEqual(w.frameworkApproval);
    expect(restored.visualApproval).toEqual(w.visualApproval);
    expect(restored.sourceImages![0].status).toBe("reviewed");
    expect(
      db
        .prepare("SELECT COUNT(*) AS n FROM audit WHERE type='image.restored'")
        .get(),
    ).toMatchObject({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM assets").get()).toMatchObject({
      n: 1,
    });
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM source_images").get(),
    ).toMatchObject({ n: 1 });
  },
);
