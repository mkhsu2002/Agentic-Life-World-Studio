import { inspectEvidence } from "./import-evidence";
import { pauseImport } from "./import-dialogue";
import { usage } from "./usage";
import { runLocalization } from "./localization";
import { Buffer } from "node:buffer";
import { z } from "zod";
import type { Env, JobMessage } from "./env";
import type {
  Element,
  WorldDraft,
  Translation,
  Locale,
} from "../shared/contracts";
import {
  extractionSchema,
  synthesisSchema,
  translationSchema,
  reviewSchema,
} from "../shared/contracts";
import {
  DomainError,
  newId,
  now,
  sha256,
  validateLocale,
  decisionKey,
  revised,
  translationHash,
  resolveQuote,
} from "./domain";
import {
  getWorld,
  saveWorld,
  auditStatement,
  deliverOutbox,
} from "./repository";
import { callJson, callImage } from "./meta";
import {
  READER,
  COMPILER,
  TRANSLATOR,
  TRANSLATION_QA,
  VISUAL_QA,
} from "./prompts";
type JobRow = {
  id: string;
  world_id: string;
  kind: string;
  status: string;
  completed: number;
  total: number;
  payload_json: string;
  lease_until: string | null;
};
async function resume(env: Env, job: JobRow, completed: number, stage: string) {
  const stamp = now();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE jobs SET completed=?,stage=?,status='queued',lease_until=NULL,updated_at=? WHERE id=?",
    ).bind(completed, stage, stamp, job.id),
    env.DB.prepare(
      "INSERT INTO outbox(id,job_id,created_at) VALUES(?,?,?)",
    ).bind(newId("outbox"), job.id, stamp),
  ]);
  await deliverOutbox(env);
}
async function complete(env: Env, job: JobRow, message: string) {
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE jobs SET status='succeeded',stage='complete',completed=total,lease_until=NULL,updated_at=? WHERE id=?",
    ).bind(now(), job.id),
    auditStatement(env, job.world_id, "job.succeeded", message),
  ]);
}
async function readSegment(env: Env, job: JobRow) {
  const w = await getWorld(env, job.world_id);
  if (w.status !== "reading") {
    const coverage = await env.DB.prepare(
      "SELECT segment_count,processed_count FROM sources WHERE id=?",
    )
      .bind(w.sourceId)
      .first<{ segment_count: number; processed_count: number }>();
    const unfinished = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM segments WHERE source_id=? AND status!='done'",
    )
      .bind(w.sourceId)
      .first<{ n: number }>();
    if (
      !coverage ||
      coverage.processed_count !== coverage.segment_count ||
      unfinished?.n ||
      !w.elements.length
    )
      throw new DomainError("SOURCE_INCOMPLETE");
    await complete(env, job, "Compiled world already exists");
    return;
  }
  const segment = await env.DB.prepare(
    "SELECT * FROM segments WHERE source_id=? AND status!='done' ORDER BY ordinal LIMIT 1",
  )
    .bind(w.sourceId)
    .first<{ id: string; text_key: string; ordinal: number }>();
  if (!segment) {
    await synthesize(env, job, w);
    return;
  }
  const obj = await env.STORAGE.get(segment.text_key);
  if (!obj) throw new DomainError("SOURCE_STORAGE_MISSING");
  const text = await obj.text();
  const previous = await env.DB.prepare(
    "SELECT result_json FROM segments WHERE source_id=? AND status='done' ORDER BY ordinal",
  )
    .bind(w.sourceId)
    .all<{ result_json: string }>();
  const known = previous.results.flatMap((r) =>
    (
      JSON.parse(r.result_json) as z.infer<typeof extractionSchema>
    ).elements.map((e) => ({
      sourceName: e.sourceName,
      englishName: e.englishName,
      aliases: e.aliases,
    })),
  );
  const candidateKey = `jobs/${job.id}/segment-${segment.ordinal}-candidate.json`;
  const cached = await env.STORAGE.get(candidateKey);
  const cachedValue = cached
    ? extractionSchema.safeParse(
        (await cached.json<{ output?: unknown }>()).output,
      )
    : null;
  let output =
    cachedValue?.success &&
    !inspectEvidence(text, cachedValue.data, segment.id).problems.length
      ? { value: cachedValue.data, usage: { input: 0, output: 0 } }
      : await usage(env, job, "read_segment", "muse-spark-1.3", () =>
          callJson(
            env.MODEL_API_KEY,
            READER,
            {
              segmentId: segment.id,
              text,
              knownNames: known.slice(-160),
              authorBrief: w.importBrief,
            },
            extractionSchema,
          ),
        );
  for (let attempt = 0; attempt < 3; attempt++) {
    const inspected = inspectEvidence(text, output.value, segment.id);
    output.value = inspected.candidate;
    await env.STORAGE.put(
      candidateKey,
      JSON.stringify({ output: output.value }),
    );
    if (!inspected.problems.length) break;
    if (attempt === 2) {
      await pauseImport(
        env,
        job,
        "evidence",
        "EVIDENCE_QUOTE_INVALID",
        segment.id,
        output.value,
      );
      return;
    }
    await env.STORAGE.put(
      `jobs/${job.id}/segment-${segment.ordinal}-repair-${attempt}.json`,
      JSON.stringify({ invalid: inspected.problems, output: output.value }),
    );
    output = await usage(
      env,
      job,
      "repair_source_evidence",
      "muse-spark-1.3",
      () =>
        callJson(
          env.MODEL_API_KEY,
          READER +
            " Repair the listed invalid evidence. Use a short exact contiguous quote copied from this segment; do not combine sentences with ellipses or paraphrase the quote. If a claim has no support here, remove that unsupported claim, preserving other valid evidence. Author supplements are context, never quotations from this source segment.",
          {
            segmentId: segment.id,
            text,
            previous: output.value,
            validationErrors: inspected.problems,
            authorBrief: w.importBrief,
          },
          extractionSchema,
        ),
    );
  }
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE segments SET result_json=?,status='done' WHERE id=?",
    ).bind(JSON.stringify(output.value), segment.id),
    env.DB.prepare(
      "UPDATE sources SET processed_count=(SELECT COUNT(*) FROM segments WHERE source_id=? AND status='done') WHERE id=?",
    ).bind(w.sourceId, w.sourceId),
    auditStatement(
      env,
      w.id,
      "source.segment_read",
      `Read source segment ${segment.ordinal + 1}`,
    ),
  ]);
  await resume(env, job, job.completed + 1, "reading");
}
async function synthesize(env: Env, job: JobRow, w: WorldDraft) {
  if (!w.importBrief?.confirmedAt) {
    await pauseImport(env, job, "brief", "IMPORT_BRIEF_REQUIRED");
    return;
  }
  const briefSnapshot = JSON.stringify(w.importBrief);
  const rows = await env.DB.prepare(
    "SELECT result_json FROM segments WHERE source_id=? ORDER BY ordinal",
  )
    .bind(w.sourceId)
    .all<{ result_json: string }>();
  if (rows.results.some((r) => !r.result_json))
    throw new DomainError("SOURCE_INCOMPLETE");
  const batches = rows.results.map(
    (r) => JSON.parse(r.result_json) as z.infer<typeof extractionSchema>,
  );
  const compiledKey = `jobs/${job.id}/compiled-proposal.json`;
  const cachedCompilation = await env.STORAGE.get(compiledKey);
  const savedCompilation = cachedCompilation
    ? await cachedCompilation.json<{ brief: string; value: unknown }>()
    : null;
  const cachedSummary =
    savedCompilation?.brief === briefSnapshot
      ? synthesisSchema.safeParse(savedCompilation.value)
      : null;
  const summary =
    cachedSummary?.success && cachedSummary.data.styles.length === 3
      ? { value: cachedSummary.data, usage: { input: 0, output: 0 } }
      : await usage(env, job, "world_compiler", "muse-spark-1.3", () =>
          callJson(
            env.MODEL_API_KEY,
            COMPILER,
            {
              sourceTitle: w.title,
              segments: batches,
              authorBrief: w.importBrief,
            },
            synthesisSchema,
          ),
        );
  const elements = new Map<string, Element>();
  for (const batch of batches)
    for (const e of batch.elements) {
      const normalized = e.sourceName
        .normalize("NFKC")
        .toLowerCase()
        .replace(/\s+/g, "");
      let existing = elements.get(normalized);
      if (!existing) {
        const id = `element_${(await sha256(w.id + ":" + normalized)).slice(0, 24)}`;
        existing = {
          id,
          kind: e.kind,
          sourceName: e.sourceName,
          names: { en: e.englishName, "zh-Hant": e.sourceName, ja: "" },
          definition: e.definition,
          features: [],
          aliases: e.aliases,
        };
        elements.set(normalized, existing);
      }
      for (const f of e.features) {
        if (!existing.features.some((x) => x.text === f.text)) {
          existing.features.push({
            ...f,
            id: `feature_${(await sha256(existing.id + f.segmentId + f.quote + f.text)).slice(0, 24)}`,
          });
        }
      }
    }
  const fresh = await getWorld(env, w.id);
  if (JSON.stringify(fresh.importBrief) !== briefSnapshot) {
    await resume(env, job, job.completed, "author_brief_updated");
    return;
  }
  const s = summary.value;
  const next: WorldDraft = {
    ...fresh,
    ...s,
    title: s.title || w.title,
    elements: [...elements.values()],
    questions: s.questions.map((q) => ({ ...q, answer: null })),
    styles: s.styles,
    status: "draft",
    updatedAt: now(),
  };
  if (!next.elements.length || next.styles.length !== 3)
    throw new DomainError("WORLD_COMPILATION_EMPTY");
  await env.STORAGE.put(
    compiledKey,
    JSON.stringify({ brief: briefSnapshot, value: summary.value }),
  );
  await saveWorld(
    env,
    next,
    w.revision,
    "world.compiled",
    "Source coverage complete; world ready for review",
    [
      env.DB.prepare(
        "UPDATE jobs SET status='succeeded',stage='complete',completed=total,lease_until=NULL,updated_at=? WHERE id=?",
      ).bind(now(), job.id),
      auditStatement(
        env,
        job.world_id,
        "job.succeeded",
        "World settings and central element registry compiled",
      ),
    ],
  );
}
async function visual(env: Env, job: JobRow) {
  const w = await getWorld(env, job.world_id);
  const p = JSON.parse(job.payload_json) as {
    revision: number;
    styleId: string;
    elementId: string;
    feedback: string;
  };
  if (p.revision !== w.revision) throw new DomainError("REVISION_CONFLICT");
  const style = w.styles.find((s) => s.id === p.styleId),
    element = w.elements.find((e) => e.id === p.elementId);
  if (!style || !element) throw new DomainError("VISUAL_TARGET_INVALID");
  const context = {
    era: w.era,
    geography: w.geography,
    ecology: w.ecology,
    rules: w.rules,
    mode: w.mode,
    authorDecisions: w.questions,
  };
  const prompt = `Create a calibration artwork depicting only this source-supported world element. Documentary composition without adding camera equipment or a photographer. Current confirmed interpretation and author decisions: ${JSON.stringify(context)}. Follow its historical time slice; if a feature conflicts with that slice, depict only supported compatible details. Style: ${JSON.stringify(style)}. Element: ${JSON.stringify(element)}. Author feedback: ${p.feedback || "None"}. Preserve all locked morphological features. No titles, labels, watermark or text. Interpret unknown details conservatively; no unrelated world elements.`;
  const checkpointKey = `jobs/${job.id}/visual-asset.json`;
  const checkpoint = await env.STORAGE.get(checkpointKey);
  let assetId: string,
    objectKey: string,
    image: { bytes: Uint8Array; b64: string; contentType: string };
  if (checkpoint) {
    const saved = await checkpoint.json<{
      assetId: string;
      objectKey: string;
    }>();
    assetId = saved.assetId;
    objectKey = saved.objectKey;
    const stored = await env.STORAGE.get(objectKey);
    if (!stored) throw new DomainError("IMAGE_CHECKPOINT_MISSING");
    const bytes = new Uint8Array(await stored.arrayBuffer());
    image = {
      bytes,
      b64: Buffer.from(bytes).toString("base64"),
      contentType: "image/png",
    };
  } else {
    image = await usage(env, job, "visual_generation", "muse-image-1.0", () =>
      callImage(env.MODEL_API_KEY, prompt),
    );
    assetId = newId("asset");
    objectKey = `assets/${w.id}/${assetId}.png`;
    await env.STORAGE.put(objectKey, image.bytes, {
      httpMetadata: { contentType: image.contentType },
    });
    await env.DB.prepare(
      "INSERT INTO assets(id,world_id,object_key,content_type,sha256,created_at) VALUES(?,?,?,?,?,?)",
    )
      .bind(
        assetId,
        w.id,
        objectKey,
        image.contentType,
        await sha256(image.bytes.buffer as ArrayBuffer),
        now(),
      )
      .run();
    await env.STORAGE.put(
      checkpointKey,
      JSON.stringify({ assetId, objectKey }),
    );
  }
  const review = await usage(env, job, "visual_review", "muse-spark-1.3", () =>
    callJson(
      env.MODEL_API_KEY,
      VISUAL_QA,
      { worldContext: context, style, element, feedback: p.feedback },
      reviewSchema,
      fetch,
      [`data:image/png;base64,${image.b64}`],
    ),
  );
  const fresh = await getWorld(env, w.id);
  if (fresh.revision !== p.revision) throw new DomainError("REVISION_CONFLICT");
  if (fresh.previews.some((preview) => preview.id === `preview_${job.id}`)) {
    await complete(env, job, "Visual calibration already saved");
    return;
  }
  fresh.previews.push({
    id: `preview_${job.id}`,
    styleId: style.id,
    elementId: element.id,
    assetId,
    revision: w.revision,
    feedback: p.feedback,
    review: { verdict: review.value.verdict, notes: review.value.issues },
    createdAt: now(),
  });
  await saveWorld(
    env,
    fresh,
    w.revision,
    "visual.reviewed",
    "Visual calibration candidate reviewed",
  );
  await complete(env, job, "Visual preview is ready for author calibration");
}
async function resolveSettings(env: Env, job: JobRow) {
  const w = await getWorld(env, job.world_id);
  const p = JSON.parse(job.payload_json) as {
    revision: number;
    decisionKey: string;
  };
  if (w.revision !== p.revision || decisionKey(w) !== p.decisionKey)
    throw new DomainError("REVISION_CONFLICT");
  const schema = z.object({
    summary: z.string(),
    era: z.string(),
    geography: z.string(),
    ecology: z.string(),
    rules: z.array(z.string()),
  });
  const output = await usage(
    env,
    job,
    "apply_author_decisions",
    "muse-spark-1.3",
    () =>
      callJson(
        env.MODEL_API_KEY,
        COMPILER +
          " Apply the explicit author answers to the world settings. Return only the updated English summary, era, geography, ecology, and rules. Preserve source-supported facts. An author choice selects the operational interpretation; do not invent additional canon.",
        { world: w, authorDecisions: w.questions },
        schema,
      ),
  );
  const fresh = await getWorld(env, w.id);
  if (fresh.revision !== w.revision) throw new DomainError("REVISION_CONFLICT");
  const next = {
    ...revised(fresh),
    ...output.value,
    resolvedDecisions: p.decisionKey,
  };
  await saveWorld(
    env,
    next,
    w.revision,
    "world.decisions_applied",
    "Author decisions applied to world settings",
  );
  await complete(
    env,
    job,
    "World decisions resolved; visual calibration can begin",
  );
}
export async function processJob(env: Env, jobId: string) {
  const job = await env.DB.prepare("SELECT * FROM jobs WHERE id=?")
    .bind(jobId)
    .first<JobRow>();
  if (!job || ["succeeded", "failed", "waiting_user"].includes(job.status))
    return;
  const stamp = now();
  const claim = await env.DB.prepare(
    "UPDATE jobs SET status='running',lease_until=?,attempts=attempts+1,updated_at=? WHERE id=? AND status IN ('queued','running') AND (lease_until IS NULL OR lease_until<?)",
  )
    .bind(new Date(Date.now() + 12 * 60000).toISOString(), stamp, job.id, stamp)
    .run();
  if (!claim.meta.changes) {
    const current = await env.DB.prepare(
      "SELECT status,lease_until FROM jobs WHERE id=?",
    )
      .bind(job.id)
      .first<{ status: string; lease_until: string | null }>();
    if (
      !current ||
      ["waiting_user", "succeeded", "failed"].includes(current.status)
    )
      return;
    return {
      busy: true,
      retryAfter: Math.max(
        30,
        Math.ceil(
          (Date.parse(current.lease_until || stamp) - Date.now()) / 1000,
        ) + 5,
      ),
    };
  }
  try {
    if (job.kind === "import") await readSegment(env, job);
    else if (job.kind === "resolve") await resolveSettings(env, job);
    else if (job.kind === "visual") await visual(env, job);
    else if (job.kind === "translate" || job.kind === "translation_review") {
      const progress = await runLocalization(
        env,
        job,
        job.kind === "translation_review",
      );
      if (progress.done) await complete(env, job, progress.message);
      else await resume(env, job, progress.completed, progress.message);
    } else throw new DomainError("JOB_KIND_INVALID");
  } catch (e) {
    if (job.kind === "import") {
      const sourceWorld = await getWorld(env, job.world_id);
      if (sourceWorld.status !== "reading") throw e;
      const pending = await env.DB.prepare(
        "SELECT id FROM segments WHERE source_id=? AND status!='done' ORDER BY ordinal LIMIT 1",
      )
        .bind(sourceWorld.sourceId)
        .first<{ id: string }>();
      await pauseImport(
        env,
        job,
        "processing",
        e instanceof DomainError ? e.code : "IMPORT_PROCESSING_ERROR",
        pending?.id || null,
      );
      return;
    }
    const message =
      e instanceof DomainError
        ? `${e.code}: ${e.message}`
        : "The task failed unexpectedly; retry from its saved checkpoint";
    console.error(
      "job failed",
      job.id,
      e instanceof DomainError ? e.code : String(e).slice(0, 160),
    );
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE jobs SET status='failed',error=?,lease_until=NULL,updated_at=? WHERE id=?",
      ).bind(message, now(), job.id),
      auditStatement(env, job.world_id, "job.failed", message),
    ]);
  }
}
export async function consumeJobs(batch: MessageBatch<JobMessage>, env: Env) {
  for (const message of batch.messages) {
    try {
      const result = await processJob(env, message.body.jobId);
      if (result?.busy)
        message.retry({ delaySeconds: Math.min(43200, result.retryAfter) });
      else message.ack();
    } catch {
      message.retry({ delaySeconds: 60 });
    }
  }
}
