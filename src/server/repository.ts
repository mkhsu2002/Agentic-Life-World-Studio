import type { Env } from "./env";
import type {
  WorldDraft,
  Job,
  AuditEvent,
  SourceInfo,
  ChatMessage,
  SiteRelease,
} from "../shared/contracts";
import { DomainError, newId, now, sha256 } from "./domain";
export async function getWorld(env: Env, id: string) {
  const row = await env.DB.prepare(
    "SELECT document_json,lock_version FROM worlds WHERE id=?",
  )
    .bind(id)
    .first<{ document_json: string; lock_version: number }>();
  if (!row) throw new DomainError("WORLD_NOT_FOUND", "World not found", 404);
  return {
    ...JSON.parse(row.document_json),
    recordVersion: row.lock_version,
  } as WorldDraft;
}
export function auditStatement(
  env: Env,
  worldId: string | null,
  type: string,
  message: string,
  data: unknown = {},
) {
  return env.DB.prepare(
    "INSERT INTO audit (id,world_id,type,message,data_json,created_at) VALUES(?,?,?,?,?,?)",
  ).bind(newId("audit"), worldId, type, message, JSON.stringify(data), now());
}
export async function saveWorld(
  env: Env,
  world: WorldDraft,
  expected: number,
  type: string,
  message: string,
  extra: D1PreparedStatement[] = [],
) {
  const guard = newId("guard");
  const stamp = now();
  const expectedLock = world.recordVersion || 1;
  world.recordVersion = expectedLock + 1;
  world.updatedAt = stamp;
  const statements = [
    env.DB.prepare(
      "INSERT INTO mutation_guards(id,valid) VALUES (?,(SELECT CASE WHEN revision=? AND lock_version=? THEN 1 ELSE 0 END FROM worlds WHERE id=?))",
    ).bind(guard, expected, expectedLock, world.id),
    env.DB.prepare(
      "UPDATE worlds SET revision=?,lock_version=?,document_json=?,updated_at=? WHERE id=?",
    ).bind(
      world.revision,
      world.recordVersion,
      JSON.stringify(world),
      stamp,
      world.id,
    ),
    ...elementStatements(env, world),
    ...extra,
    auditStatement(env, world.id, type, message),
    env.DB.prepare("DELETE FROM mutation_guards WHERE id=?").bind(guard),
  ];
  try {
    await env.DB.batch(statements);
  } catch (e) {
    if (
      String(e).includes("CHECK constraint") ||
      String(e).includes("NOT NULL constraint failed: mutation_guards")
    )
      throw new DomainError("REVISION_CONFLICT");
    throw e;
  }
}
export function elementStatements(env: Env, w: WorldDraft) {
  const statements: D1PreparedStatement[] = [];
  for (const e of w.elements) {
    statements.push(
      env.DB.prepare(
        "INSERT INTO elements(id,world_id,kind,source_name,revision,document_json) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,source_name=excluded.source_name,revision=excluded.revision,document_json=excluded.document_json",
      ).bind(e.id, w.id, e.kind, e.sourceName, w.revision, JSON.stringify(e)),
    );
    for (const locale of ["en", "zh-Hant", "ja"] as const) {
      const t = w.translations[locale];
      const translated = t?.elements[e.id];
      statements.push(
        env.DB.prepare(
          "INSERT INTO terms(element_id,locale,source_revision,name,definition,status) VALUES(?,?,?,?,?,?) ON CONFLICT(element_id,locale) DO UPDATE SET source_revision=excluded.source_revision,name=excluded.name,definition=excluded.definition,status=excluded.status",
        ).bind(
          e.id,
          locale,
          w.revision,
          translated?.name || e.names[locale] || "",
          translated?.definition || e.definition,
          t?.status || "draft",
        ),
      );
    }
  }
  return statements;
}
export async function sourceInfo(env: Env, id: string): Promise<SourceInfo> {
  const r = await env.DB.prepare("SELECT * FROM sources WHERE id=?")
    .bind(id)
    .first<Record<string, unknown>>();
  if (!r) throw new DomainError("SOURCE_NOT_FOUND", "Source missing", 404);
  return {
    id: String(r.id),
    title: String(r.title),
    kind: r.kind as SourceInfo["kind"],
    url: r.url as string | null,
    sha256: String(r.sha256),
    charCount: Number(r.char_count),
    segmentCount: Number(r.segment_count),
    processedCount: Number(r.processed_count),
    createdAt: String(r.created_at),
  };
}
export async function jobs(env: Env, worldId?: string): Promise<Job[]> {
  const q = worldId
    ? env.DB.prepare(
        "SELECT * FROM jobs WHERE world_id=? ORDER BY created_at DESC LIMIT 30",
      ).bind(worldId)
    : env.DB.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 30");
  const { results } = await q.all<Record<string, unknown>>();
  return results.map((r) => ({
    id: String(r.id),
    worldId: r.world_id as string | null,
    kind: String(r.kind),
    status: r.status as Job["status"],
    stage: String(r.stage),
    completed: Number(r.completed),
    total: Number(r.total),
    error: r.error as string | null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));
}
export async function audit(env: Env, worldId?: string): Promise<AuditEvent[]> {
  const q = worldId
    ? env.DB.prepare(
        "SELECT * FROM audit WHERE world_id=? ORDER BY created_at DESC LIMIT 80",
      ).bind(worldId)
    : env.DB.prepare("SELECT * FROM audit ORDER BY created_at DESC LIMIT 40");
  const { results } = await q.all<Record<string, unknown>>();
  return results.map((r) => ({
    id: String(r.id),
    worldId: r.world_id as string | null,
    type: String(r.type),
    message: String(r.message),
    createdAt: String(r.created_at),
  }));
}
export async function messages(
  env: Env,
  worldId: string,
): Promise<ChatMessage[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM messages WHERE world_id=? ORDER BY created_at ASC LIMIT 100",
  )
    .bind(worldId)
    .all<Record<string, string>>();
  return results.map((r) => ({
    id: r.id,
    role: r.role as ChatMessage["role"],
    content: r.content,
    createdAt: r.created_at,
  }));
}
export async function releases(
  env: Env,
  worldId: string,
  origin: string,
): Promise<SiteRelease[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM releases WHERE world_id=? ORDER BY created_at DESC LIMIT 20",
  )
    .bind(worldId)
    .all<Record<string, string>>();
  return results.map((r) => ({
    id: r.id,
    worldId: r.world_id,
    slug: r.slug,
    revision: Number(r.revision),
    status: r.status as SiteRelease["status"],
    locales: JSON.parse(r.locales_json),
    url: `${origin}/en/worlds/${r.slug}`,
    hash: r.hash,
    createdAt: r.created_at,
  }));
}
export async function enqueue(
  env: Env,
  worldId: string,
  kind: string,
  payload: unknown,
  total = 1,
) {
  const logicalKey = await sha256(JSON.stringify({ worldId, kind, payload }));
  const existing = await env.DB.prepare(
    "SELECT id FROM jobs WHERE logical_key=? AND status IN ('queued','running')",
  )
    .bind(logicalKey)
    .first<{ id: string }>();
  if (existing) return existing.id;
  const id = newId("job"),
    outboxId = newId("outbox"),
    stamp = now();
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO jobs(id,world_id,kind,status,stage,total,payload_json,created_at,updated_at,logical_key) VALUES(?,?,?,'queued',?,?,?,?,?,?)",
      ).bind(
        id,
        worldId,
        kind,
        kind,
        total,
        JSON.stringify(payload),
        stamp,
        stamp,
        logicalKey,
      ),
      env.DB.prepare(
        "INSERT INTO outbox(id,job_id,created_at) VALUES(?,?,?)",
      ).bind(outboxId, id, stamp),
      auditStatement(env, worldId, "job.queued", `Queued ${kind}`),
    ]);
  } catch (error) {
    const replay = await env.DB.prepare(
      "SELECT id FROM jobs WHERE logical_key=? AND status IN ('queued','running')",
    )
      .bind(logicalKey)
      .first<{ id: string }>();
    if (replay) return replay.id;
    throw error;
  }
  await deliverOutbox(env);
  return id;
}
export async function deliverOutbox(env: Env) {
  const { results } = await env.DB.prepare(
    "SELECT id,job_id FROM outbox WHERE delivered=0 ORDER BY created_at LIMIT 30",
  ).all<{ id: string; job_id: string }>();
  for (const r of results) {
    await env.JOBS.send({ jobId: r.job_id });
    await env.DB.prepare("UPDATE outbox SET delivered=1 WHERE id=?")
      .bind(r.id)
      .run();
  }
}
