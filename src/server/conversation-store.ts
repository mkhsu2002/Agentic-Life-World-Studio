import type { Env } from "./env";
import { DomainError, newId, now, sha256 } from "./domain";
import type {
  Conversation,
  ConversationDocument,
  ConversationEvent,
  ConversationProposal,
  ConversationSnapshot,
  ConversationTask,
  ProposalKind,
  StudioRole,
} from "../shared/conversation";
export const emptyDocument = (): ConversationDocument => ({
  direction: null,
  world: null,
  visual: null,
  journey: null,
  publication: null,
  operation: null,
});
export type TaskRow = {
  id: string;
  conversation_id: string;
  turn_id: string;
  role: StudioRole;
  status: string;
  attempts: number;
  payload_json: string;
  source_revision: number;
  cancel_epoch: number;
  lease_until: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};
export type ConversationRow = {
  id: string;
  title: string;
  revision: number;
  status: Conversation["status"];
  document_json: string;
  cancel_epoch: number;
  created_at: string;
  updated_at: string;
};
export async function conversationRow(env: Env, id: string) {
  const r = await env.DB.prepare(
    "SELECT * FROM studio_conversations WHERE id=?",
  )
    .bind(id)
    .first<ConversationRow>();
  if (!r)
    throw new DomainError("CONVERSATION_NOT_FOUND", "找不到這段對話。", 404);
  return r;
}
export function publicConversation(r: ConversationRow): Conversation {
  return {
    id: r.id,
    title: r.title,
    revision: r.revision,
    status: r.status,
    document: JSON.parse(r.document_json),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
export async function getConversation(env: Env, id: string) {
  return publicConversation(await conversationRow(env, id));
}
export function eventStatement(
  env: Env,
  id: string,
  type: ConversationEvent["type"],
  content: string,
  data: Record<string, unknown> = {},
) {
  return env.DB.prepare(
    "INSERT INTO studio_events(conversation_id,type,content,data_json,created_at) VALUES(?,?,?,?,?)",
  ).bind(id, type, content, JSON.stringify(data), now());
}
export async function appendEvent(
  env: Env,
  id: string,
  type: ConversationEvent["type"],
  content: string,
  data: Record<string, unknown> = {},
) {
  await eventStatement(env, id, type, content, data).run();
}
export function auditStatement(
  env: Env,
  id: string,
  action: string,
  data: Record<string, unknown> = {},
) {
  return env.DB.prepare(
    "INSERT INTO studio_audit(id,conversation_id,action,data_json,created_at) VALUES(?,?,?,?,?)",
  ).bind(newId("caudit"), id, action, JSON.stringify(data), now());
}
export async function replayEvents(env: Env, id: string, after = 0) {
  const rows = await env.DB.prepare(
    "SELECT * FROM studio_events WHERE conversation_id=? AND id>? ORDER BY id LIMIT 1000",
  )
    .bind(id, after)
    .all<{
      id: number;
      conversation_id: string;
      type: ConversationEvent["type"];
      content: string;
      data_json: string;
      created_at: string;
    }>();
  return rows.results.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    type: r.type,
    content: r.content,
    data: JSON.parse(r.data_json),
    createdAt: r.created_at,
  }));
}
export function proposalFromRow(r: any): ConversationProposal {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    kind: r.kind,
    revision: r.revision,
    status: r.status,
    content: JSON.parse(r.content_json),
    hash: r.content_hash,
    createdAt: r.created_at,
  };
}
export async function getProposal(env: Env, id: string) {
  const r = await env.DB.prepare("SELECT * FROM studio_proposals WHERE id=?")
    .bind(id)
    .first();
  return r ? proposalFromRow(r) : null;
}
export async function snapshot(
  env: Env,
  id: string,
): Promise<ConversationSnapshot> {
  const result = await env.DB.batch([
    env.DB.prepare("SELECT * FROM studio_conversations WHERE id=?").bind(id),
    env.DB.prepare(
      "SELECT * FROM studio_events WHERE conversation_id=? ORDER BY id DESC LIMIT 1000",
    ).bind(id),
    env.DB.prepare(
      "SELECT * FROM studio_tasks WHERE conversation_id=? ORDER BY created_at,id",
    ).bind(id),
    env.DB.prepare(
      "SELECT * FROM studio_proposals WHERE conversation_id=? ORDER BY created_at,id",
    ).bind(id),
    env.DB.prepare(
      "SELECT * FROM studio_assets WHERE conversation_id=? ORDER BY created_at,id",
    ).bind(id),
    env.DB.prepare(
      "SELECT COUNT(*) count,COALESCE(SUM(char_count),0) characters,SUM(CASE WHEN status='read' THEN 1 ELSE 0 END) read,SUM(CASE WHEN status='unavailable' THEN 1 ELSE 0 END) unavailable FROM studio_sources WHERE conversation_id=?",
    ).bind(id),
    env.DB.prepare(
      "SELECT COALESCE(SUM(CASE WHEN state!='not_sent' THEN 1 ELSE 0 END),0) requests,COALESCE(SUM(CASE WHEN state='uncertain' THEN 1 ELSE 0 END),0) uncertain,COALESCE(SUM(input_tokens),0) inputTokens,COALESCE(SUM(output_tokens),0) outputTokens FROM studio_usage WHERE conversation_id=?",
    ).bind(id),
  ]);
  const row = result[0].results[0] as unknown as ConversationRow | undefined;
  if (!row)
    throw new DomainError("CONVERSATION_NOT_FOUND", "找不到這段對話。", 404);
  const events = result[1].results.map(eventFromRow).reverse(),
    tasks = result[2].results as unknown as TaskRow[],
    proposals = result[3].results,
    assets = result[4].results as any[],
    sources = result[5].results[0] as any;
  return {
    conversation: publicConversation(row),
    events,
    cursor: events.at(-1)?.id || 0,
    watermark: events.at(-1)?.id || 0,
    olderCursor: events.length === 1000 ? events[0].id : null,
    tasks: tasks.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      role: r.role,
      status: r.status as ConversationTask["status"],
      attempts: r.attempts,
      error: r.error,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    proposals: proposals.map(proposalFromRow),
    assets: assets.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      url: "/api/studio/assets/" + r.id,
      kind: r.kind,
      name: r.name,
      contentType: r.content_type,
      createdAt: r.created_at,
    })),
    usage: result[6].results[0] as unknown as {
      requests: number;
      uncertain: number;
      inputTokens: number;
      outputTokens: number;
    },
    sourceStats: {
      count: sources?.count || 0,
      characters: sources?.characters || 0,
      read: sources?.read || 0,
      unavailable: sources?.unavailable || 0,
      images: assets.filter((r) => r.kind === "reference").length,
    },
  };
}
function eventFromRow(r: any): ConversationEvent {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    type: r.type,
    content: r.content,
    data: JSON.parse(r.data_json),
    createdAt: r.created_at,
  };
}
export async function olderEvents(env: Env, id: string, before: number) {
  const rows = await env.DB.prepare(
    "SELECT * FROM studio_events WHERE conversation_id=? AND id<? ORDER BY id DESC LIMIT 1000",
  )
    .bind(id, before)
    .all();
  return rows.results.map(eventFromRow).reverse();
}

export function taskStatements(
  env: Env,
  id: string,
  c: ConversationRow,
  turnId: string,
  role: StudioRole,
  payload: Record<string, unknown>,
) {
  const t = now();
  return [
    env.DB.prepare(
      "INSERT INTO studio_tasks(id,conversation_id,turn_id,role,status,payload_json,source_revision,cancel_epoch,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    ).bind(
      id,
      c.id,
      turnId,
      role,
      "queued",
      JSON.stringify(payload),
      c.revision,
      c.cancel_epoch,
      t,
      t,
    ),
    env.DB.prepare(
      "INSERT INTO studio_outbox(task_id,created_at) VALUES(?,?)",
    ).bind(id, t),
  ];
}
export async function dispatchOutbox(env: Env) {
  const rows = await env.DB.prepare(
    "SELECT o.task_id FROM studio_outbox o JOIN studio_tasks t ON t.id=o.task_id WHERE o.dispatched_at IS NULL AND t.status='queued' ORDER BY o.created_at LIMIT 20",
  ).all<{ task_id: string }>();
  for (const r of rows.results) {
    try {
      await (env.JOBS as unknown as Queue<{ studioTaskId: string }>).send({
        studioTaskId: r.task_id,
      });
      await env.DB.prepare(
        "UPDATE studio_outbox SET dispatched_at=? WHERE task_id=?",
      )
        .bind(now(), r.task_id)
        .run();
    } catch {
      /* Durable row is recovered by the scheduled recovery service. */
    }
  }
}
export async function activeTask(env: Env, t: TaskRow) {
  const r = await env.DB.prepare(
    "SELECT t.id FROM studio_tasks t JOIN studio_conversations c ON c.id=t.conversation_id WHERE t.id=? AND t.status='running' AND t.cancel_epoch=c.cancel_epoch AND t.lease_until=?",
  )
    .bind(t.id, t.lease_until)
    .first();
  return !!r;
}
export function taskGuard(env: Env, t: TaskRow, guard: string) {
  return env.DB.prepare(
    "INSERT INTO studio_guards(id,passed) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM studio_tasks t JOIN studio_conversations c ON c.id=t.conversation_id WHERE t.id=? AND t.status='running' AND t.cancel_epoch=c.cancel_epoch AND t.lease_until=?) THEN 1 ELSE 0 END",
  ).bind(guard, t.id, t.lease_until);
}
export async function guardedBatch(
  env: Env,
  t: TaskRow,
  statements: D1PreparedStatement[],
) {
  const g = newId("guard");
  await env.DB.batch([
    taskGuard(env, t, g),
    ...statements,
    env.DB.prepare("DELETE FROM studio_guards WHERE id=?").bind(g),
  ]);
}
export async function createProposal(
  env: Env,
  conversationId: string,
  kind: ProposalKind,
  content: Record<string, unknown>,
  task?: TaskRow,
) {
  const c = await conversationRow(env, conversationId),
    p = {
      id: newId("proposal"),
      conversationId,
      kind,
      content,
      revision: c.revision,
      status: "pending" as const,
      hash: await sha256(JSON.stringify(content)),
      createdAt: now(),
    };
  const statements = [
    env.DB.prepare(
      "UPDATE studio_proposals SET status='superseded' WHERE conversation_id=? AND kind=? AND status='pending'",
    ).bind(c.id, kind),
    env.DB.prepare(
      "INSERT INTO studio_proposals(id,conversation_id,kind,revision,status,content_json,content_hash,created_at) VALUES(?,?,?,?,?,?,?,?)",
    ).bind(
      p.id,
      c.id,
      kind,
      p.revision,
      p.status,
      JSON.stringify(content),
      p.hash,
      p.createdAt,
    ),
    eventStatement(
      env,
      c.id,
      "proposal",
      typeof content.reply === "string"
        ? content.reply
        : "這份提案已整理完成。你可以直接告訴我需要調整之處，或明確表示採用。",
      {
        proposalId: p.id,
        kind,
        revision: p.revision,
        hash: p.hash,
        content,
        asksApproval: true,
      },
    ),
    auditStatement(env, c.id, "proposal.created", { proposalId: p.id, kind }),
  ];
  if (task) await guardedBatch(env, task, statements);
  else await env.DB.batch(statements);
  return p;
}
export async function proposalApproval(env: Env, proposalId: string) {
  return env.DB.prepare("SELECT * FROM studio_approvals WHERE proposal_id=?")
    .bind(proposalId)
    .first<{
      id: string;
      conversation_id: string;
      proposal_id: string;
      proposal_hash: string;
      owner_event_id: number;
      revision: number;
      created_at: string;
    }>();
}
export async function commitMemory(
  env: Env,
  conversationId: string,
  proposal: ConversationProposal,
  ownerEventId: number,
  patch: Partial<ConversationDocument>,
  task?: TaskRow,
  continuation?: { role: StudioRole; payload: Record<string, unknown> },
) {
  const c = await conversationRow(env, conversationId);
  if (
    proposal.conversationId !== conversationId ||
    proposal.status !== "pending" ||
    proposal.revision !== c.revision
  )
    throw new DomainError(
      "PROPOSAL_STALE",
      "這份提案已不是目前版本，請先查看最新內容。",
    );
  const existing = await env.DB.prepare(
    "SELECT id FROM studio_events WHERE id=? AND conversation_id=? AND type='user'",
  )
    .bind(ownerEventId, c.id)
    .first();
  if (!existing)
    throw new DomainError(
      "OWNER_CONFIRMATION_REQUIRED",
      "需要作者在此對話中明確確認。",
    );
  const next = { ...JSON.parse(c.document_json), ...patch },
    revision = c.revision + 1,
    g = newId("cas");
  const statements = [
    env.DB.prepare(
      "UPDATE studio_conversations SET revision=?,document_json=?,title=?,updated_at=? WHERE id=? AND revision=? AND cancel_epoch=?",
    ).bind(
      revision,
      JSON.stringify(next),
      proposal.kind === "world" && next.world?.title
        ? String(next.world.title).slice(0, 160)
        : c.title,
      now(),
      c.id,
      c.revision,
      c.cancel_epoch,
    ),
    env.DB.prepare(
      "INSERT INTO studio_guards(id,passed) VALUES(?,CASE WHEN changes()=1 THEN 1 ELSE 0 END)",
    ).bind(g),
    env.DB.prepare(
      "UPDATE studio_proposals SET status='approved' WHERE id=? AND status='pending' AND revision=? AND content_hash=?",
    ).bind(proposal.id, c.revision, proposal.hash),
    env.DB.prepare(
      "INSERT INTO studio_guards(id,passed) VALUES(?,CASE WHEN changes()=1 THEN 1 ELSE 0 END)",
    ).bind(g + "p"),
    env.DB.prepare(
      "INSERT INTO studio_approvals(id,conversation_id,proposal_id,proposal_hash,owner_event_id,revision,created_at) VALUES(?,?,?,?,?,?,?)",
    ).bind(
      newId("approval"),
      c.id,
      proposal.id,
      proposal.hash,
      ownerEventId,
      revision,
      now(),
    ),
    env.DB.prepare(
      "INSERT INTO studio_memory(id,conversation_id,revision,document_json,proposal_id,created_at) VALUES(?,?,?,?,?,?)",
    ).bind(
      newId("memory"),
      c.id,
      revision,
      JSON.stringify(next),
      proposal.id,
      now(),
    ),
    env.DB.prepare(
      "UPDATE studio_proposals SET status='superseded' WHERE conversation_id=? AND status='pending'",
    ).bind(c.id),
    auditStatement(env, c.id, "proposal.approved", {
      proposalId: proposal.id,
      hash: proposal.hash,
      ownerEventId,
      revision,
    }),
    eventStatement(
      env,
      c.id,
      "assistant",
      "已採用這份設定，之後的創作會沿用這個版本。",
      { proposalId: proposal.id, revision },
    ),
    env.DB.prepare("DELETE FROM studio_guards WHERE id IN (?,?)").bind(
      g,
      g + "p",
    ),
  ];
  if (task && continuation) {
    statements.push(
      ...taskStatements(
        env,
        "handoff_" + task.id,
        { ...c, revision },
        task.turn_id,
        continuation.role,
        continuation.payload,
      ),
      env.DB.prepare(
        "UPDATE studio_tasks SET status='completed',lease_until=NULL,error=NULL,updated_at=? WHERE id=?",
      ).bind(now(), task.id),
      env.DB.prepare(
        "UPDATE studio_conversations SET status='working' WHERE id=?",
      ).bind(c.id),
      auditStatement(env, c.id, "task.completed", {
        taskId: task.id,
        continuation: "handoff_" + task.id,
      }),
    );
  }
  if (task) await guardedBatch(env, task, statements);
  else await env.DB.batch(statements);
  return getConversation(env, c.id);
}
