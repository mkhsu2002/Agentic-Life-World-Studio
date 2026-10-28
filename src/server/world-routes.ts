import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "./env";
import { frameworkSchema } from "../shared/world-framework";
import {
  DomainError,
  assertRevision,
  revised,
  newId,
  now,
  sha256,
} from "./domain";
import {
  getWorld,
  saveWorld,
  sourceInfo,
  auditStatement,
  deliverOutbox,
} from "./repository";
import { frameworkHash, validateFrameworkReview } from "./world-framework";

export const worldRoutes = new Hono<{ Bindings: Env }>();
const snapshotInput = z.object({
  revision: z.number().int(),
  recordVersion: z.number().int(),
});
export function assertRecord(
  actual: number | undefined,
  expected: number | undefined,
) {
  if (expected !== undefined && actual !== expected)
    throw new DomainError("REVISION_CONFLICT");
}
worldRoutes.patch("/worlds/:id/framework", async (c) => {
  const b = snapshotInput
    .extend({ framework: frameworkSchema })
    .parse(await c.req.json());
  const w = await getWorld(c.env, c.req.param("id"));
  assertRevision(w, b.revision);
  assertRecord(w.recordVersion, b.recordVersion);
  if (w.status === "reading") throw new DomainError("SOURCE_INCOMPLETE");
  if (!w.framework) throw new DomainError("FRAMEWORK_REQUIRED");
  const f = b.framework;
  // Author edits cannot erase independent review findings or fabricate source provenance.
  f.fidelity = w.framework.fidelity;
  f.issues = w.framework.issues.map((i) => ({
    ...i,
    resolution: f.issues.find((x) => x.id === i.id)?.resolution || "",
  }));
  for (const m of f.modules) {
    const old = w.framework.modules.find((x) => x.key === m.key);
    if (old?.summary !== m.summary || old.status !== m.status) {
      m.basis = "author_supplied";
      m.evidence = [];
    } else {
      m.basis = old.basis;
      m.evidence = old.evidence;
    }
  }
  for (const a of f.anchors) {
    const old = w.framework.anchors.find((x) => x.id === a.id);
    a.evidence = old?.definition === a.definition ? old.evidence : [];
  }
  f.visual.referenceStatus = w.framework.visual.referenceStatus;
  const summary = (key: string) =>
    f.modules.find((x) => x.key === key)!.summary;
  const next = {
    ...revised(w),
    framework: f,
    summary: summary("identity"),
    era: summary("time"),
    geography: summary("space"),
    ecology: summary("life"),
    rules: [summary("laws")],
  };
  await saveWorld(
    c.env,
    next,
    w.revision,
    "framework.saved",
    "已儲存世界方案；請核對後重新確認",
  );
  return c.json({ world: next, frameworkHash: await frameworkHash(next) });
});
worldRoutes.post("/worlds/:id/framework-approval", async (c) => {
  const b = snapshotInput
    .extend({ hash: z.string().length(64) })
    .parse(await c.req.json());
  const w = await getWorld(c.env, c.req.param("id"));
  assertRevision(w, b.revision);
  assertRecord(w.recordVersion, b.recordVersion);
  if (w.status === "reading") throw new DomainError("SOURCE_INCOMPLETE");
  const s = await sourceInfo(c.env, w.sourceId);
  if (!s.segmentCount || s.processedCount !== s.segmentCount)
    throw new DomainError("SOURCE_INCOMPLETE");
  validateFrameworkReview(w);
  if (!w.selectedStyleId || !w.styles.some((s) => s.id === w.selectedStyleId))
    throw new DomainError("STYLE_NOT_FOUND");
  const hash = await frameworkHash(w);
  if (hash !== b.hash) throw new DomainError("REVISION_CONFLICT");
  if (
    w.frameworkApproval?.hash === hash &&
    w.frameworkApproval.revision === w.revision
  )
    return c.json({ world: w });
  w.frameworkApproval = { hash, revision: w.revision, approvedAt: now() };
  await saveWorld(
    c.env,
    w,
    b.revision,
    "framework.approved",
    "作者已確認核心設定、補全決定與後續生成範圍",
    [
      c.env.DB.prepare(
        "INSERT OR IGNORE INTO world_snapshots(id,world_id,revision,content_hash,document_json,created_at) VALUES(?,?,?,?,?,?)",
      ).bind(
        newId("snapshot"),
        w.id,
        w.revision,
        hash,
        JSON.stringify(w),
        now(),
      ),
      c.env.DB.prepare(
        "INSERT INTO approvals(id,world_id,kind,revision,content_hash,created_at) VALUES(?,?,'framework',?,?,?)",
      ).bind(newId("approval"), w.id, w.revision, hash, now()),
    ],
  );
  return c.json({ world: w });
});
worldRoutes.post("/worlds/:id/analyze", async (c) => {
  const b = snapshotInput.parse(await c.req.json());
  const w = await getWorld(c.env, c.req.param("id"));
  assertRevision(w, b.revision);
  assertRecord(w.recordVersion, b.recordVersion);
  const active = await c.env.DB.prepare(
    "SELECT id FROM jobs WHERE world_id=? AND status IN ('queued','running') AND kind IN ('import','analyze')",
  )
    .bind(w.id)
    .first();
  if (active) throw new DomainError("ANALYSIS_IN_PROGRESS");
  const next = {
    ...revised(w),
    status: "reading" as const,
    framework: undefined,
    questions: [],
    resolvedDecisions: undefined,
  };
  const s = await sourceInfo(c.env, w.sourceId);
  const jobId = newId("job"),
    payload = { analysisVersion: "0.03" };
  const logicalKey = await sha256(
    JSON.stringify({ worldId: w.id, kind: "import", payload }),
  );
  // This explicit author action supersedes old evidence-level dialogues, keeping source coverage.
  await saveWorld(
    c.env,
    next,
    w.revision,
    "world.analysis_requested",
    "作者要求依世界框架重新整理原作",
    [
      c.env.DB.prepare(
        "UPDATE import_reviews SET status='resolved',resolution_json=?,resolved_at=? WHERE world_id=? AND status='open'",
      ).bind(
        JSON.stringify({ action: "superseded_by_world_analysis" }),
        now(),
        w.id,
      ),
      c.env.DB.prepare(
        "UPDATE jobs SET status='succeeded',stage='superseded',lease_until=NULL,updated_at=? WHERE world_id=? AND kind IN ('import','analyze') AND status='waiting_user'",
      ).bind(now(), w.id),
      c.env.DB.prepare(
        "INSERT INTO jobs(id,world_id,kind,status,stage,total,payload_json,created_at,updated_at,logical_key) VALUES(?,?,'import','queued','reading',?,?,?,?,?)",
      ).bind(
        jobId,
        w.id,
        s.segmentCount + 8,
        JSON.stringify(payload),
        now(),
        now(),
        logicalKey,
      ),
      c.env.DB.prepare(
        "INSERT INTO outbox(id,job_id,created_at) VALUES(?,?,?)",
      ).bind(newId("outbox"), jobId, now()),
      auditStatement(
        c.env,
        w.id,
        "job.queued",
        "Queued author-requested world analysis",
      ),
    ],
  );
  try {
    await deliverOutbox(c.env);
  } catch {
    console.warn(
      "World analysis persisted; dispatch retained in outbox",
      jobId,
    );
  }
  return c.json({ world: next, jobId }, 202);
});
