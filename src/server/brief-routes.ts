import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Env } from "./env";
import type { WorldDraft } from "../shared/contracts";
import { briefKeys, worldBriefSchema } from "../shared/world-brief";
import { DomainError, assertRevision, revised, newId, now } from "./domain";
import { getWorld, saveWorld, sourceInfo, messages } from "./repository";
import { assertRecord } from "./world-routes";
import { briefHash, validateBriefReview } from "./world-brief";
import { usage } from "./usage";
import { callJson } from "./meta";
import { BASE } from "./prompts";

export const briefRoutes = new Hono<{ Bindings: Env }>();
const snapshot = z.object({
  revision: z.number().int().positive(),
  recordVersion: z.number().int().positive(),
});
function authorEdit(w: WorldDraft, proposed: z.infer<typeof worldBriefSchema>) {
  if (!w.brief) throw new DomainError("BRIEF_REQUIRED");
  const original = w.brief;
  if (
    proposed.decisions.length !== original.decisions.length ||
    proposed.decisions.some(
      (d) => !original.decisions.some((old) => old.id === d.id),
    )
  )
    throw new DomainError("BRIEF_DECISIONS_CHANGED");
  return {
    ...proposed,
    decisions: original.decisions.map((d) => ({
      ...d,
      answer: proposed.decisions.find((item) => item.id === d.id)!.answer,
    })),
    evidence: original.evidence.filter(
      (e) => proposed[e.section] === original[e.section],
    ),
    referenceStatus: original.referenceStatus,
  };
}
briefRoutes.patch("/worlds/:id/brief", async (c) => {
  const b = snapshot
    .extend({ brief: worldBriefSchema })
    .parse(await c.req.json());
  const w = await getWorld(c.env, c.req.param("id"));
  assertRevision(w, b.revision);
  assertRecord(w.recordVersion, b.recordVersion);
  if (w.status === "reading") throw new DomainError("SOURCE_INCOMPLETE");
  const brief = authorEdit(w, b.brief);
  const next = { ...revised(w), brief };
  if (brief.visual !== w.brief?.visual)
    next.styles = w.styles.map((style) => ({
      ...style,
      description: brief.visual,
    }));
  await saveWorld(
    c.env,
    next,
    w.revision,
    "brief.saved",
    "已儲存六項創作簡報；尚未核准",
  );
  return c.json({ world: next, briefHash: await briefHash(next) });
});
briefRoutes.post("/worlds/:id/brief-approval", async (c) => {
  const b = snapshot
    .extend({ hash: z.string().length(64) })
    .parse(await c.req.json());
  const w = await getWorld(c.env, c.req.param("id"));
  assertRevision(w, b.revision);
  assertRecord(w.recordVersion, b.recordVersion);
  const s = await sourceInfo(c.env, w.sourceId);
  if (
    w.status === "reading" ||
    !s.segmentCount ||
    s.segmentCount !== s.processedCount
  )
    throw new DomainError("SOURCE_INCOMPLETE");
  validateBriefReview(w);
  if (!w.styles.some((style) => style.id === w.selectedStyleId))
    throw new DomainError("STYLE_NOT_FOUND");
  const hash = await briefHash(w);
  if (hash !== b.hash) throw new DomainError("REVISION_CONFLICT");
  if (w.briefApproval?.hash === hash && w.briefApproval.revision === w.revision)
    return c.json({ world: w });
  w.briefApproval = { hash, revision: w.revision, approvedAt: now() };
  await saveWorld(
    c.env,
    w,
    w.revision,
    "brief.approved",
    "作者已核准六項創作簡報與必要裁定",
    [
      c.env.DB.prepare(
        "INSERT INTO world_snapshots(id,world_id,revision,content_hash,document_json,created_at) VALUES(?,?,?,?,?,?)",
      ).bind(
        newId("snapshot"),
        w.id,
        w.revision,
        hash,
        JSON.stringify(w),
        now(),
      ),
      c.env.DB.prepare(
        "INSERT INTO approvals(id,world_id,kind,revision,content_hash,created_at) VALUES(?,?,'brief',?,?,?)",
      ).bind(newId("approval"), w.id, w.revision, hash, now()),
    ],
  );
  return c.json({ world: w });
});

export async function briefConversation(
  c: Context<{ Bindings: Env }>,
  w: WorldDraft,
  message: string,
) {
  const sections = z.object(
    Object.fromEntries(
      briefKeys.map((key) => [key, z.string().trim().min(1).max(4000)]),
    ) as Record<(typeof briefKeys)[number], z.ZodString>,
  );
  const schema = z.object({
    assistant: z.string().min(1).max(6000),
    proposed: sections.nullable(),
  });
  const result = await usage(
    c.env,
    { world_id: w.id },
    "studio_chat",
    "muse-spark-1.3",
    async () =>
      callJson(
        c.env.MODEL_API_KEY,
        BASE +
          " Assist the author with six concise creative-brief paragraphs, in Traditional Chinese. Change only paragraphs explicitly requested by the author; return all six paragraphs if proposing a change, otherwise proposed=null. Do not add plot catalogues, character relationships, required checklists or questions. Never fill author decision answers, change approvals, activate or publish. A proposal is an unapproved draft. Preserve factual constraints and spoiler boundaries. Never silently resolve a conflict with original canon.",
        {
          brief: w.brief,
          history: (await messages(c.env, w.id)).slice(-12),
          message,
        },
        schema,
      ),
  );
  const next = result.value.proposed
    ? {
        ...revised(w),
        brief: { ...w.brief!, ...result.value.proposed },
      }
    : w;
  if (result.value.proposed) {
    next.brief!.evidence = w.brief!.evidence.filter(
      (e) => next.brief![e.section] === w.brief![e.section],
    );
    if (next.brief!.visual !== w.brief!.visual)
      next.styles = w.styles.map((s) => ({
        ...s,
        description: next.brief!.visual,
      }));
  }
  await saveWorld(
    c.env,
    next,
    w.revision,
    "studio.conversation",
    result.value.proposed
      ? "已透過對話更新六項草稿，等待本人確認"
      : "已記錄創作簡報對話",
    [
      c.env.DB.prepare(
        "INSERT INTO messages(id,world_id,role,content,created_at) VALUES(?,?,?,?,?)",
      ).bind(newId("message"), w.id, "user", message, now()),
      c.env.DB.prepare(
        "INSERT INTO messages(id,world_id,role,content,created_at) VALUES(?,?,?,?,?)",
      ).bind(
        newId("message"),
        w.id,
        "assistant",
        result.value.assistant,
        now(),
      ),
    ],
  );
  return c.json({ world: next, assistant: result.value.assistant });
}
