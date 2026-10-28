import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
import type { Env } from "../../src/server/env";
export function studioFixture() {
  const sql = new DatabaseSync(":memory:");
  for (const f of ["0006_conversation.sql", "0007_site_operations.sql"])
    sql.exec(readFileSync("migrations/" + f, "utf8"));
  class Statement {
    values: unknown[] = [];
    constructor(public query: string) {}
    bind(...values: unknown[]) {
      this.values = values;
      return this;
    }
    execute() {
      const query = sql.prepare(this.query);
      if (/^\s*(SELECT|PRAGMA|WITH)/i.test(this.query))
        return {
          success: true,
          results: query.all(...(this.values as never[])),
          meta: { changes: 0 },
        };
      const r = query.run(...(this.values as never[]));
      return {
        success: true,
        results: [],
        meta: { changes: Number(r.changes) },
      };
    }
    async run() {
      return this.execute();
    }
    async all() {
      return this.execute();
    }
    async first(column?: string) {
      const row = this.execute().results[0] as
        Record<string, unknown> | undefined;
      return column ? row?.[column] : row || null;
    }
  }
  const objects = new Map<
      string,
      { bytes: Uint8Array; metadata?: R2PutOptions }
    >(),
    sent: unknown[] = [],
    workflows = new Map<string, unknown>();
  const env = {
    DB: {
      prepare: (q: string) => new Statement(q),
      batch: async (rows: Statement[]) => {
        sql.exec("BEGIN");
        try {
          const result = rows.map((r) => r.execute());
          sql.exec("COMMIT");
          return result;
        } catch (e) {
          sql.exec("ROLLBACK");
          throw e;
        }
      },
    } as unknown as D1Database,
    STORAGE: {
      put: async (
        key: string,
        value: string | ArrayBuffer | Uint8Array,
        metadata?: R2PutOptions,
      ) => {
        const bytes =
          typeof value === "string"
            ? new TextEncoder().encode(value)
            : new Uint8Array(value);
        objects.set(key, { bytes, metadata });
      },
      get: async (key: string) => {
        const r = objects.get(key);
        return r
          ? {
              body: r.bytes,
              size: r.bytes.length,
              text: async () => new TextDecoder().decode(r.bytes),
              arrayBuffer: async () => r.bytes.buffer,
              customMetadata: r.metadata?.customMetadata,
              httpMetadata: r.metadata?.httpMetadata,
            }
          : null;
      },
      head: async (key: string) => {
        const r = objects.get(key);
        return r
          ? {
              size: r.bytes.length,
              customMetadata: r.metadata?.customMetadata,
              httpMetadata: r.metadata?.httpMetadata,
            }
          : null;
      },
    } as unknown as R2Bucket,
    JOBS: {
      send: async (v: unknown) => {
        sent.push(v);
      },
    } as unknown as Queue,
    OPERATIONS: {
      create: async (v: { id: string }) => {
        if (workflows.has(v.id)) throw new Error("exists");
        workflows.set(v.id, v);
        return v;
      },
      get: async (id: string) => {
        if (!workflows.has(id)) throw new Error("not found");
        return workflows.get(id);
      },
    } as unknown as Env["OPERATIONS"],
    MODEL_API_KEY: "test",
    SESSION_SECRET: "test-session-secret-at-least-32-bytes",
    STUDIO_PASSWORD: "test-password",
    ENVIRONMENT: "production",
    BUILD_REVISION: "a".repeat(40),
    STUDIO_PUBLIC_ORIGIN: "https://studio.test",
    STUDIO_DEPLOY_TOKEN: "test-deploy",
  } as Env;
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
  return {
    sql,
    env,
    objects,
    sent,
    workflows,
    cookie,
    close: () => sql.close(),
  };
}
export type StudioFixture = ReturnType<typeof studioFixture>;
