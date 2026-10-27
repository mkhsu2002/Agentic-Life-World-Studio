import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "./env";
import { assertRevision, DomainError, newId, now } from "./domain";
import {
  getWorld,
  saveWorld,
  auditStatement,
  deliverOutbox,
} from "./repository";
import {
  briefSchema,
  assertReading,
  reviewContext,
  type ReviewRow,
} from "./import-dialogue";
import { applyEvidenceDecisions } from "./import-evidence";
export const importRoutes = new Hono<{ Bindings: Env }>();
const baseInput = z.object({
  revision: z.number().int(),
  recordVersion: z.number().int().optional(),
  message: z.string().max(8000).optional(),
});
function checkRecord(actual: number | undefined, expected: number | undefined) {
  if (expected !== undefined && actual !== expected)
    throw new DomainError("REVISION_CONFLICT");
}
importRoutes.patch("/worlds/:id/import-brief", async (c) => {
  const b = baseInput.extend({ brief: briefSchema }).parse(await c.req.json());
  const w = await getWorld(c.env, c.req.param("id"));
  assertRevision(w, b.revision);
  assertReading(w.status);
  checkRecord(w.recordVersion, b.recordVersion);
  w.importBrief = {
    ...b.brief,
    confirmedAt: b.message ? w.importBrief?.confirmedAt || null : now(),
  };
  const summary = b.message || `解析方向補充：${JSON.stringify(b.brief)}`;
  await saveWorld(
    c.env,
    w,
    w.revision,
    "import.brief_saved",
    b.message ? "作者補充已保存" : "作者已儲存並確認解析方向",
    [
      c.env.DB.prepare(
        "INSERT INTO messages(id,world_id,role,content,created_at) VALUES(?,?,'user',?,?)",
      ).bind(newId("message"), w.id, summary, now()),
      c.env.DB.prepare(
        "INSERT INTO messages(id,world_id,role,content,created_at) VALUES(?,?,'assistant',?,?)",
      ).bind(
        newId("message"),
        w.id,
        "已記下你的補充。閱讀會保留原文證據，建立世界草案時會一併參考；作者補充不會被標成原文引句。",
        now(),
      ),
    ],
  );
  return c.json({ world: w });
});
const decisionSchema = z.object({
  action: z.enum(["replace_quote", "author_confirm", "exclude"]),
  quote: z.string().max(10000).optional(),
  text: z.string().min(1).max(5000).optional(),
});
importRoutes.post("/worlds/:id/import-reviews/:reviewId/resolve", async (c) => {
  const b = baseInput
    .extend({
      decisions: z.record(z.string(), decisionSchema),
      brief: briefSchema.optional(),
    })
    .parse(await c.req.json());
  const w = await getWorld(c.env, c.req.param("id"));
  assertRevision(w, b.revision);
  assertReading(w.status);
  checkRecord(w.recordVersion, b.recordVersion);
  const row = await c.env.DB.prepare(
    "SELECT * FROM import_reviews WHERE id=? AND world_id=? AND status='open'",
  )
    .bind(c.req.param("reviewId"), w.id)
    .first<ReviewRow>();
  if (!row) throw new DomainError("IMPORT_REVIEW_RESOLVED");
  const context = await reviewContext(c.env, row);
  const kind = context.kind;
  const extras: D1PreparedStatement[] = [];
  if (kind === "evidence") {
    if (!row.segment_id) throw new DomainError("IMPORT_REVIEW_INVALID");
    const segment = context.segment;
    if (
      !segment ||
      segment.source_id !== w.sourceId ||
      segment.status === "done" ||
      !context.candidate
    )
      throw new DomainError("IMPORT_REVIEW_INVALID");
    const result = applyEvidenceDecisions(
      context.sourceText,
      context.candidate,
      b.decisions,
      row.segment_id,
    );
    extras.push(
      c.env.DB.prepare(
        "UPDATE segments SET result_json=?,status='done' WHERE id=?",
      ).bind(JSON.stringify(result), row.segment_id),
      c.env.DB.prepare(
        "UPDATE sources SET processed_count=(SELECT COUNT(*) FROM segments WHERE source_id=? AND status='done') WHERE id=?",
      ).bind(w.sourceId, w.sourceId),
    );
  } else if (Object.keys(b.decisions).length)
    throw new DomainError("EVIDENCE_DECISIONS_INCOMPLETE");
  if (kind === "brief" && !b.brief)
    throw new DomainError("IMPORT_BRIEF_REQUIRED");
  if (b.brief) w.importBrief = { ...b.brief, confirmedAt: now() };
  else if (b.message?.trim()) {
    const current = w.importBrief || {
      timeframe: "",
      scope: "",
      visualStyle: "",
      notes: "",
      confirmedAt: null,
    };
    const notes = [current.notes, b.message.trim()]
      .filter(Boolean)
      .join("\n\n");
    if (notes.length > 8000) throw new DomainError("IMPORT_NOTES_TOO_LONG");
    w.importBrief = { ...current, notes };
  }
  const guard = newId("guard"),
    stamp = now();
  const userText =
    b.message ||
    (kind === "evidence"
      ? `已逐項確認 ${Object.keys(b.decisions).length} 個疑義。`
      : kind === "brief"
        ? "已確認解析方向，請繼續建立世界草案。"
        : "請依補充說明繼續解析。 ");
  await saveWorld(
    c.env,
    w,
    w.revision,
    "import.review_resolved",
    "作者已確認，繼續先前的解析進度",
    [
      c.env.DB.prepare(
        "INSERT INTO mutation_guards(id,valid) VALUES(?,(SELECT CASE WHEN r.status='open' AND j.status='waiting_user' THEN 1 ELSE 0 END FROM import_reviews r JOIN jobs j ON j.id=r.job_id WHERE r.id=?))",
      ).bind(guard, row.id),
      ...extras,
      c.env.DB.prepare(
        "UPDATE import_reviews SET status='resolved',resolution_json=?,resolved_at=?,kind=? WHERE id=?",
      ).bind(JSON.stringify(b), stamp, kind, row.id),
      c.env.DB.prepare(
        "UPDATE jobs SET status='queued',stage='reading',error=NULL,lease_until=NULL,completed=(SELECT processed_count FROM sources WHERE id=?),updated_at=? WHERE id=?",
      ).bind(w.sourceId, stamp, row.job_id),
      c.env.DB.prepare(
        "INSERT INTO outbox(id,job_id,created_at) VALUES(?,?,?)",
      ).bind(newId("outbox"), row.job_id, stamp),
      c.env.DB.prepare(
        "INSERT INTO messages(id,world_id,role,content,created_at) VALUES(?,?,'user',?,?)",
      ).bind(newId("message"), w.id, userText, stamp),
      c.env.DB.prepare(
        "INSERT INTO messages(id,world_id,role,content,created_at) VALUES(?,?,'assistant',?,?)",
      ).bind(
        newId("message"),
        w.id,
        "你的確認已保存。接下來會從尚未完成的部分繼續，不會重新閱讀已確認的段落。",
        stamp,
      ),
      auditStatement(
        c.env,
        w.id,
        "import.review_decisions",
        "解析疑義處理已保存",
        { reviewId: row.id, decisions: b.decisions },
      ),
      c.env.DB.prepare("DELETE FROM mutation_guards WHERE id=?").bind(guard),
    ],
  );
  await deliverOutbox(c.env);
  return c.json({ world: w, jobId: row.job_id }, 202);
});
