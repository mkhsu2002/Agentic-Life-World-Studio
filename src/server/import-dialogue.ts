import { z } from "zod";
import type { Env } from "./env";
import type { ImportReview } from "../shared/contracts";
import { DomainError, newId, now } from "./domain";
import { auditStatement } from "./repository";
import { inspectEvidence, type Extraction } from "./import-evidence";
import { extractionSchema } from "../shared/contracts";
export const briefSchema = z.object({
  timeframe: z.string().max(4000),
  scope: z.string().max(4000),
  visualStyle: z.string().max(4000),
  notes: z.string().max(8000),
});
export type ReviewRow = {
  id: string;
  world_id: string;
  job_id: string;
  segment_id: string | null;
  kind: ImportReview["kind"];
  status: string;
  message: string;
  details_json: string;
  created_at: string;
};
const explanations = {
  evidence:
    "有些描述還找不到可核對的原文，請一起確認。先前完成的段落已保存；你可以更正引句、改為作者補充，或排除該項後繼續。",
  processing:
    "這一段暫時無法完成解析，先前進度已保存。你可以補充說明後重新嘗試，或先返回查看原文。",
  brief:
    "原作已完成逐段閱讀。請先確認年代範圍、探索方向與補充說明，再建立世界草案。空白欄位會依原作判斷。",
};
export async function pauseImport(
  env: Env,
  job: { id: string; world_id: string },
  kind: ImportReview["kind"],
  code: string,
  segmentId: string | null = null,
  candidate?: Extraction,
) {
  const existing = await env.DB.prepare(
    "SELECT id FROM import_reviews WHERE job_id=? AND status='open'",
  )
    .bind(job.id)
    .first<{ id: string }>();
  if (existing) return;
  const id = newId("review"),
    stamp = now(),
    guard = newId("guard");
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO mutation_guards(id,valid) VALUES(?,(SELECT CASE WHEN status='running' THEN 1 ELSE 0 END FROM jobs WHERE id=?))",
    ).bind(guard, job.id),
    env.DB.prepare(
      "INSERT INTO import_reviews(id,world_id,job_id,segment_id,kind,status,code,message,details_json,created_at) VALUES(?,?,?,?,?,'open',?,?,?,?)",
    ).bind(
      id,
      job.world_id,
      job.id,
      segmentId,
      kind,
      code,
      explanations[kind],
      JSON.stringify(candidate ? { candidate } : {}),
      stamp,
    ),
    env.DB.prepare(
      "UPDATE jobs SET status='waiting_user',stage='awaiting_confirmation',error=NULL,lease_until=NULL,updated_at=? WHERE id=?",
    ).bind(stamp, job.id),
    env.DB.prepare(
      "INSERT INTO messages(id,world_id,role,content,created_at) VALUES(?,?,'assistant',?,?)",
    ).bind(newId("message"), job.world_id, explanations[kind], stamp),
    auditStatement(
      env,
      job.world_id,
      "import.needs_input",
      explanations[kind],
      { reviewId: id, kind, code },
    ),
    env.DB.prepare("DELETE FROM mutation_guards WHERE id=?").bind(guard),
  ]);
}
export async function reviewContext(env: Env, row: ReviewRow) {
  const segment = row.segment_id
    ? await env.DB.prepare(
        "SELECT ordinal,text_key,source_id,status FROM segments WHERE id=?",
      )
        .bind(row.segment_id)
        .first<{
          ordinal: number;
          text_key: string;
          source_id: string;
          status: string;
        }>()
    : null;
  const obj = segment ? await env.STORAGE.get(segment.text_key) : null;
  const sourceText = obj ? await obj.text() : "";
  const details = JSON.parse(row.details_json) as {
    candidate?: Extraction;
    legacy?: boolean;
  };
  let candidate = details.candidate;
  if (!candidate && (details.legacy || row.kind === "processing") && segment) {
    for (const key of [
      `jobs/${row.job_id}/segment-${segment.ordinal}-candidate.json`,
      `jobs/${row.job_id}/segment-${segment.ordinal}-repair-1.json`,
      `jobs/${row.job_id}/segment-${segment.ordinal}-repair-0.json`,
    ]) {
      const stored = await env.STORAGE.get(key);
      if (!stored) continue;
      const checkpoint = await stored.json<{ output?: unknown }>();
      const parsed = extractionSchema.safeParse(checkpoint.output);
      if (parsed.success) {
        candidate = parsed.data;
        break;
      }
    }
  }
  const problems =
    candidate && row.segment_id
      ? inspectEvidence(sourceText, candidate, row.segment_id).problems
      : [];
  const kind =
    row.kind === "processing" && candidate && problems.length
      ? "evidence"
      : row.kind;
  return { segment, sourceText, candidate, problems, kind };
}
export async function openImportReview(
  env: Env,
  worldId: string,
): Promise<ImportReview | null> {
  const row = await env.DB.prepare(
    "SELECT * FROM import_reviews WHERE world_id=? AND status='open' ORDER BY created_at DESC LIMIT 1",
  )
    .bind(worldId)
    .first<ReviewRow>();
  if (!row) return null;
  const context = await reviewContext(env, row);
  return {
    id: row.id,
    jobId: row.job_id,
    kind: context.kind,
    message:
      context.kind !== row.kind ? explanations[context.kind] : row.message,
    segmentOrdinal: context.segment?.ordinal ?? null,
    sourceText: context.sourceText,
    problems: context.problems,
    createdAt: row.created_at,
  };
}
export async function importSuggestions(
  env: Env,
  sourceId: string,
  worldId: string,
): Promise<string[]> {
  const results = await env.DB.prepare(
    "SELECT result_json AS data FROM segments WHERE source_id=? AND status='done' UNION ALL SELECT json_extract(details_json,'$.candidate') AS data FROM import_reviews WHERE world_id=? AND status='open'",
  )
    .bind(sourceId, worldId)
    .all<{ data: string | null }>();
  const notes = results.results.flatMap((r) => {
    if (!r.data) return [];
    try {
      return (JSON.parse(r.data) as Extraction).guidance || [];
    } catch {
      return [];
    }
  });
  return [...new Set(notes)].slice(-6);
}
export function assertReading(status: string) {
  if (status !== "reading") throw new DomainError("IMPORT_BRIEF_LOCKED");
}
