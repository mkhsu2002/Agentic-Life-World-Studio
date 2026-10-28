import type { Env } from "./env";
import type { TaskRow } from "./conversation-store";
import { DomainError, newId, now } from "./domain";
export async function assertOperationPolicy(env: Env, task: TaskRow) {
  const payload = JSON.parse(task.payload_json);
  if (!payload.operationRunId) return null;
  const c = await env.DB.prepare(
    "SELECT document_json,cancel_epoch FROM studio_conversations WHERE id=?",
  )
    .bind(task.conversation_id)
    .first<{ document_json: string; cancel_epoch: number }>();
  const p = c ? JSON.parse(c.document_json).operation : null;
  if (
    !p?.enabled ||
    c?.cancel_epoch !== task.cancel_epoch ||
    !payload.approvedOperationHash ||
    p.approvalHash !== payload.approvedOperationHash
  )
    throw new DomainError(
      "OPERATION_PAUSED",
      "自主更新已暫停或設定已改變，本輪不會繼續發布。",
      422,
    );
  return p;
}
export async function reserveOperationCall(
  env: Env,
  task: TaskRow,
  usageId: string,
) {
  const payload = JSON.parse(task.payload_json);
  if (!payload.operationRunId) return;
  await assertOperationPolicy(env, task);
  const g = newId("quota");
  try {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE studio_conversations SET document_json=json_set(document_json,'$.operation.usedCalls',COALESCE(json_extract(document_json,'$.operation.usedCalls'),0)+1),updated_at=? WHERE id=? AND cancel_epoch=? AND json_extract(document_json,'$.operation.enabled')=1 AND json_extract(document_json,'$.operation.approvalHash')=? AND COALESCE(json_extract(document_json,'$.operation.usedCalls'),0)<json_extract(document_json,'$.operation.maxCalls')",
      ).bind(
        now(),
        task.conversation_id,
        task.cancel_epoch,
        payload.approvedOperationHash,
      ),
      env.DB.prepare(
        "INSERT INTO studio_guards(id,passed) VALUES(?,CASE WHEN changes()=1 THEN 1 ELSE 0 END)",
      ).bind(g),
      env.DB.prepare(
        "INSERT INTO studio_quota_reservations(id,conversation_id,run_id,task_id,usage_id,state,created_at) VALUES(?,?,?,?,?,?,?)",
      ).bind(
        newId("quota"),
        task.conversation_id,
        payload.operationRunId,
        task.id,
        usageId,
        "uncertain",
        now(),
      ),
      env.DB.prepare("DELETE FROM studio_guards WHERE id=?").bind(g),
    ]);
  } catch {
    throw new DomainError(
      "OPERATION_BUDGET_REACHED",
      "已達到你設定的用量上限，這輪已暫停。",
      422,
    );
  }
}
