import type { Env } from "./env";
import type {
  ConversationHookContext,
  ConversationHookResult,
} from "./conversation";
import { enqueueOperationCycle, getConversation } from "./conversation";
import {
  conversationRow,
  auditStatement,
  eventStatement,
  guardedBatch,
  type TaskRow,
} from "./conversation-store";
import { DomainError, newId, now, sha256 } from "./domain";
import {
  getStudioSite,
  loadSiteContents,
  type PublicationRow,
} from "./conversation-site";
import {
  buildSiteContents,
  assertPublicCopy,
} from "./conversation-site-content";
import { activateStudioPublication } from "./conversation-release";
import type {
  ConversationDocument,
  OperationPolicy,
} from "../shared/conversation";
type Policy = OperationPolicy & { approvalHash: string };
const policyOf = (document: ConversationDocument) =>
  document.operation as Policy | null;
export async function dispatchOperationWakeups(env: Env) {
  const rows = await env.DB.prepare(
    "SELECT * FROM studio_automation_wakeups WHERE dispatched_at IS NULL ORDER BY due_at LIMIT 20",
  ).all<{
    id: string;
    conversation_id: string;
    policy_hash: string;
    due_at: string;
  }>();
  if (!env.OPERATIONS && rows.results.length)
    throw new DomainError(
      "OPERATION_SCHEDULER_REQUIRED",
      "自主更新的排程連線尚未完成，目前不會開始生成。",
      503,
    );
  for (const row of rows.results) {
    const c = await getConversation(env, row.conversation_id),
      p = policyOf(c.document);
    if (!p?.enabled || p.approvalHash !== row.policy_hash) {
      await env.DB.prepare(
        "UPDATE studio_automation_wakeups SET dispatched_at=? WHERE id=?",
      )
        .bind(now(), row.id)
        .run();
      continue;
    }
    try {
      await env.OPERATIONS!.create({
        id: row.id,
        params: { wakeupId: row.id, dueAt: row.due_at },
      });
    } catch (e) {
      try {
        await (await env.OPERATIONS!.get(row.id)).status();
      } catch {
        throw e;
      }
    }
    await env.DB.prepare(
      "UPDATE studio_automation_wakeups SET dispatched_at=? WHERE id=?",
    )
      .bind(now(), row.id)
      .run();
  }
}
export async function scheduleNextOperation(
  env: Env,
  conversationId: string,
  dueAt: string,
  policyHash: string,
) {
  const id =
    "wake_" + (await sha256(conversationId + policyHash + dueAt)).slice(0, 28);
  await env.DB.prepare(
    "INSERT OR IGNORE INTO studio_automation_wakeups(id,conversation_id,policy_hash,due_at,created_at) VALUES(?,?,?,?,?)",
  )
    .bind(id, conversationId, policyHash, dueAt, now())
    .run();
  await dispatchOperationWakeups(env);
  return id;
}
export async function activateConversationOperation(
  env: Env,
  ctx: ConversationHookContext,
): Promise<ConversationHookResult> {
  if (
    !ctx.proposal ||
    ctx.proposal.kind !== "operation" ||
    !ctx.approval ||
    ctx.approval.proposal_hash !== ctx.proposal.hash
  )
    throw new DomainError("EXACT_APPROVAL_REQUIRED");
  const c = await conversationRow(env, ctx.conversationId),
    doc = JSON.parse(c.document_json) as ConversationDocument,
    p = policyOf(doc);
  if (
    !p ||
    p.approvalHash !== ctx.proposal.hash ||
    !Number.isInteger(p.maxCalls) ||
    p.maxCalls < 1 ||
    !p.scope?.trim()
  )
    throw new DomainError(
      "OPERATION_POLICY_INVALID",
      "請先明確指定更新頻率、創作範圍及用量上限。",
      422,
    );
  const publication = await env.DB.prepare(
    "SELECT id FROM studio_publications WHERE conversation_id=? AND status='active'",
  )
    .bind(c.id)
    .first();
  if (!publication)
    throw new DomainError(
      "OPERATION_PUBLICATION_REQUIRED",
      "請先完成網站發布，再另外啟動自主更新。",
      422,
    );
  if (!env.OPERATIONS)
    throw new DomainError(
      "OPERATION_SCHEDULER_REQUIRED",
      "排程連線尚未完成，設定已保存，目前不會開始生成。",
      503,
    );
  const due = now(),
    task = await env.DB.prepare("SELECT * FROM studio_tasks WHERE id=?")
      .bind(ctx.taskId)
      .first<TaskRow>();
  if (!task) throw new DomainError("TASK_CANCELLED");
  await guardedBatch(env, task, [
    env.DB.prepare(
      "UPDATE studio_conversations SET document_json=json_set(document_json,'$.operation.enabled',json('true'),'$.operation.nextRunAt',?),updated_at=? WHERE id=? AND revision=? AND json_extract(document_json,'$.operation.approvalHash')=?",
    ).bind(due, now(), c.id, c.revision, p.approvalHash),
    auditStatement(env, c.id, "operation.activated", {
      proposalId: ctx.proposal.id,
      ownerEventId: ctx.ownerEventId,
      frequencyHours: p.frequencyHours,
      maxCalls: p.maxCalls,
      policyHash: p.approvalHash,
    }),
    eventStatement(
      env,
      c.id,
      "operation",
      "自主更新已啟動。我會在核准範圍內探索，達到本次用量上限就暫停。",
    ),
  ]);
  await scheduleNextOperation(env, c.id, due, p.approvalHash);
  return {
    content:
      "已啟用自主更新，接下來的進展會回報在這段對話。你可以隨時說「停止自主更新」。",
    eventType: "operation",
  };
}
export async function runOperationWakeup(env: Env, wakeupId: string) {
  const row = await env.DB.prepare(
    "SELECT * FROM studio_automation_wakeups WHERE id=?",
  )
    .bind(wakeupId)
    .first<{
      id: string;
      conversation_id: string;
      policy_hash: string;
      due_at: string;
    }>();
  if (!row) return;
  const c = await getConversation(env, row.conversation_id),
    p = policyOf(c.document);
  if (!p?.enabled || p.approvalHash !== row.policy_hash || row.due_at > now())
    return;
  if (p.usedCalls >= p.maxCalls) {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE studio_conversations SET document_json=json_set(document_json,'$.operation.enabled',json('false')) WHERE id=?",
      ).bind(c.id),
      eventStatement(
        env,
        c.id,
        "operation",
        "已達到本次自主更新的用量上限，暫停新生成。既有網站仍保留。",
      ),
      auditStatement(env, c.id, "operation.quota_reached", {
        policyHash: p.approvalHash,
      }),
    ]);
    return;
  }
  const busy = await env.DB.prepare(
    "SELECT id FROM studio_operation_runs WHERE conversation_id=? AND status='running'",
  )
    .bind(c.id)
    .first();
  if (busy) {
    const pendingRun = await env.DB.prepare(
      "SELECT id,policy_hash FROM studio_operation_runs WHERE conversation_id=? AND status='running'",
    )
      .bind(c.id)
      .first<{ id: string; policy_hash: string }>();
    if (pendingRun)
      await enqueueOperationCycle(
        env,
        c.id,
        pendingRun.id,
        pendingRun.policy_hash,
      );
    return;
  }
  const id =
      "run_" + (await sha256(c.id + p.approvalHash + row.due_at)).slice(0, 28),
    insert = await env.DB.prepare(
      "INSERT OR IGNORE INTO studio_operation_runs(id,conversation_id,policy_hash,status,scheduled_for,created_at) VALUES(?,?,?,'running',?,?)",
    )
      .bind(id, c.id, p.approvalHash, row.due_at, now())
      .run();
  if (!insert.meta.changes) return;
  try {
    await enqueueOperationCycle(env, c.id, id, p.approvalHash);
  } catch (e) {
    // Keep the durable run claim so queue redelivery / orphan recovery can create its task.
    throw e;
  }
}
export async function finishConversationCycle(
  env: Env,
  ctx: ConversationHookContext,
): Promise<ConversationHookResult> {
  const runId = String(ctx.payload.operationRunId || "");
  const completed = await env.DB.prepare(
    "SELECT id FROM studio_operation_runs WHERE id=? AND conversation_id=? AND status='completed'",
  )
    .bind(runId, ctx.conversationId)
    .first();
  if (completed) {
    const latest = await getConversation(env, ctx.conversationId),
      policy = policyOf(latest.document);
    if (policy?.enabled && policy.nextRunAt)
      await scheduleNextOperation(
        env,
        ctx.conversationId,
        policy.nextRunAt,
        policy.approvalHash,
      );
    return {
      content: "這輪探索已完成，紀錄與公開內容均已保存。",
      eventType: "operation",
    };
  }
  const run = await env.DB.prepare(
    "SELECT * FROM studio_operation_runs WHERE id=? AND conversation_id=? AND status='running'",
  )
    .bind(runId, ctx.conversationId)
    .first<{ policy_hash: string }>();
  const c = await conversationRow(env, ctx.conversationId),
    doc = JSON.parse(c.document_json) as ConversationDocument,
    p = policyOf(doc),
    draft = ctx.payload.operationDraft as Record<string, unknown> | undefined;
  if (
    !run ||
    !p?.enabled ||
    p.approvalHash !== run.policy_hash ||
    !draft ||
    draft.runId !== runId
  )
    throw new DomainError("OPERATION_STALE", "這輪更新已停止，不會發布。");
  const previous = await env.DB.prepare(
    "SELECT * FROM studio_publications WHERE conversation_id=? AND status='active'",
  )
    .bind(c.id)
    .first<PublicationRow>();
  if (!previous) throw new DomainError("OPERATION_PUBLICATION_REQUIRED");
  const site = await getStudioSite(env, previous.site_id);
  site.cancel_epoch = c.cancel_epoch;
  const candidate = {
    ...doc,
    ...draft,
    world: draft.world || doc.world,
  } as ConversationDocument;
  delete candidate.runId;
  const contents = buildSiteContents(
      candidate,
      `/api/studio/assets/${candidate.visual?.selectedAssetId}`,
    ),
    history = await loadSiteContents(env, previous.content_key);
  for (const [locale, next] of Object.entries(contents)) {
    const old = history[locale as keyof typeof history];
    if (old) {
      const seen = new Set(old.entries.map((e) => e.title + "\n" + e.body));
      next.entries = [
        ...old.entries,
        ...next.entries.filter((e) => !seen.has(e.title + "\n" + e.body)),
      ];
    }
  }
  assertPublicCopy(contents);
  const publication = await activateStudioPublication(env, site, contents, {
    operationRunId: runId,
  });
  const due = new Date(Date.now() + p.frequencyHours * 3600000).toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO studio_journey_records(id,conversation_id,run_id,publication_id,document_json,created_at) VALUES(?,?,?,?,?,?)",
    ).bind(
      newId("journey"),
      c.id,
      runId,
      publication.id,
      JSON.stringify(draft),
      now(),
    ),
    env.DB.prepare(
      "UPDATE studio_operation_runs SET status='completed',completed_at=? WHERE id=? AND status='running'",
    ).bind(now(), runId),
    env.DB.prepare(
      "UPDATE studio_conversations SET document_json=json_set(document_json,'$.operation.nextRunAt',?,'$.operationDraft',json('null'),'$.world',json(?)),updated_at=? WHERE id=? AND json_extract(document_json,'$.operation.approvalHash')=? AND json_extract(document_json,'$.operation.enabled')=1",
    ).bind(due, JSON.stringify(candidate.world), now(), c.id, p.approvalHash),
    auditStatement(env, c.id, "operation.cycle_completed", {
      runId,
      releaseId: publication.id,
      policyHash: p.approvalHash,
    }),
  ]);
  await scheduleNextOperation(env, c.id, due, p.approvalHash);
  return {
    content: "這次探索已完成並發布，紀錄與新發現已保存。下一輪會沿用這些成果。",
    eventType: "operation",
    data: { runId, releaseId: publication.id },
  };
}
export async function recoverConversationOperations(env: Env) {
  const orphaned = await env.DB.prepare(
    "SELECT r.id,r.conversation_id,r.policy_hash FROM studio_operation_runs r WHERE r.status='running' AND NOT EXISTS(SELECT 1 FROM studio_tasks t WHERE t.conversation_id=r.conversation_id AND json_extract(t.payload_json,'$.operationRunId')=r.id)",
  ).all<{ id: string; conversation_id: string; policy_hash: string }>();
  for (const run of orphaned.results)
    await enqueueOperationCycle(
      env,
      run.conversation_id,
      run.id,
      run.policy_hash,
    );
  const failed = await env.DB.prepare(
    "SELECT r.id,r.conversation_id FROM studio_operation_runs r WHERE r.status='running' AND EXISTS(SELECT 1 FROM studio_tasks t WHERE t.conversation_id=r.conversation_id AND json_extract(t.payload_json,'$.operationRunId')=r.id AND t.status IN ('failed','cancelled')) AND NOT EXISTS(SELECT 1 FROM studio_tasks t WHERE t.conversation_id=r.conversation_id AND json_extract(t.payload_json,'$.operationRunId')=r.id AND t.status IN ('queued','running'))",
  ).all<{ id: string; conversation_id: string }>();
  for (const r of failed.results)
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE studio_operation_runs SET status='failed',completed_at=? WHERE id=?",
      ).bind(now(), r.id),
      env.DB.prepare(
        "UPDATE studio_conversations SET document_json=json_set(document_json,'$.operation.enabled',json('false')) WHERE id=?",
      ).bind(r.conversation_id),
      eventStatement(
        env,
        r.conversation_id,
        "operation",
        "這輪自主更新未完成，已暫停後續生成。已發布的網站與成功保存的內容仍保留。",
      ),
      auditStatement(env, r.conversation_id, "operation.paused_after_failure", {
        runId: r.id,
      }),
    ]);
  await dispatchOperationWakeups(env);
}
