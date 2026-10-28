import { z } from "zod";
import type { Element, WorldDraft } from "../shared/contracts";
import { briefKeys, worldBriefSchema } from "../shared/world-brief";
import type { Env } from "./env";
import { DomainError, now, resolveQuote, sha256 } from "./domain";
import { callJson } from "./meta";
import { BASE } from "./prompts";
import { auditStatement, getWorld, saveWorld } from "./repository";
import { sourceImageData } from "./source-images";
import { restoreUsage, usage } from "./usage";

const paragraph = z.string().trim().min(1).max(4000);
const evidenceSchema = worldBriefSchema.shape.evidence.element;
const termSchema = z.object({
  sourceName: z.string().trim().min(1).max(200),
  englishName: z.string().trim().min(1).max(200),
  kind: z.string().trim().min(1).max(60),
  definition: z.string().trim().min(1).max(1500),
  evidence: evidenceSchema,
});
const styleSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().trim().min(1).max(200),
  description: paragraph,
  medium: z.string().trim().min(1).max(600),
  palette: z.array(z.string().min(1).max(200)).max(12),
  lighting: z.string().max(600),
  materials: z.array(z.string().min(1).max(300)).max(12),
  forbidden: z.array(z.string().min(1).max(600)).max(12),
  evidence: z.array(z.string().min(1).max(1500)).max(18),
});
const editorialShape = {
  title: z.string().trim().min(1).max(300),
  summary: paragraph,
  brief: worldBriefSchema,
  terms: z.array(termSchema).max(12),
};
export const briefAnalysisSchemas = {
  reader: z.object({
    notes: z
      .array(
        z.object({
          section: z.enum(briefKeys),
          note: z.string().trim().min(1).max(700),
          quote: z.string().trim().min(1).max(1200),
        }),
      )
      .max(6),
  }),
  editor: z.object(editorialShape),
  visual: z.object({ visual: paragraph, style: styleSchema }),
  fidelity: z.object({ ...editorialShape, style: styleSchema }),
};
const common =
  BASE +
  ` PRIVATE Studio brief paragraphs, questions and suggestions are Traditional Chinese. Public title, summary, englishName and term definition are English, except supported proper names. Public summary describes the visible world; keep private observer instructions, spoiler policy, creative boundaries, decisions, approvals and source/image review status out of it. Fill the six paragraphs first; unknown and not applicable are valid. This is an unapproved draft. Never sign an approval, answer for the author, infer permission or publish. decisions contain at most five material choices about a critical omission, actual contradiction or creative boundary. An empty decisions array is correct when none is necessary; never fill a question quota. Every decision.answer must be empty. Author supplements are separate from source evidence. Keep private production instructions out of public title, summary and definitions.`;
const prompts = {
  reader:
    common +
    ` ROLE: COMPACT_READER. Read this actual source segment. Retain a note only if it changes a public image, travel narration or creative boundary in one of world, visual, viewpoint, time, naming, boundaries. Return at most six concise notes, ideally fewer; notes=[] is valid for incidental plot. Do not catalogue characters, relationships, species, objects, organizations, battles or every name. Do not summarize incidental plot or publication metadata. Each note needs an exact original quote from this segment. Do not fabricate regions, species, names, disaster causes, numbers or a documentary aesthetic. Do not generate author questions at this stage. Source dialogue may be biased: preserve viewpoint, chronology, negation and limits rather than treating it as omniscient truth.`,
  editor:
    common +
    ` ROLE: CREATIVE_BRIEF_EDITOR. Use all compact reading notes and the separate author brief to write a usable six-part brief: world is the basic visible world/era/background; visual is a single compatible visual direction; viewpoint is the observer and narrative voice; time is the travel period and spoiler boundary; naming is necessary proper terms and naming/translation principles; boundaries is immutable core, permitted derivation and concrete exclusions. Unknown details do not automatically require a question. Do not create a world encyclopedia or require a starting place ID. Return a small terms array only for genuine source proper terms needed in the resulting website; zero is valid, twelve is a ceiling, not a target. Do not invent organisms or territories. Preserve source names and attribute a few decisive quotes to actual segment IDs in brief.evidence (at most eighteen). Proposed visual medium and translations are suggestions, never source facts. referenceStatus must not claim images were reviewed at this stage.`,
  visual:
    common +
    ` ROLE: VISUAL_DIRECTOR. Return exactly ONE compatible style in style, plus the refined visual paragraph. The actual supplied pixels, when present, are the only evidence of image appearance: inspect their form, material, palette, light and viewing impression. Labels and coverage notes are not image pixels. Without supplied pixels, derive a tentative direction from source and label that origin privately without claiming image review. Do not force a choice among three styles, assume photography or invent source motifs. Keep the style compatible with all six paragraphs and author boundaries.`,
  fidelity:
    common +
    ` ROLE: INDEPENDENT_FIDELITY_AUDITOR. Directly compare the proposed six-part brief, single style and small terms list to sourcePassages.originalText, the ORIGINAL contextual source passages, and actual supplied reference pixels. Reading notes and other roles' claims are leads, never proof. Check only consequential misreadings, unsupported core claims, visual mismatches, observer/time leakage and creative boundaries. Correct safe mistakes directly, retain unknown where appropriate, and merge genuinely necessary author decisions into a maximum of five in the returned complete brief. Do not ask per-segment questions, score the whole plot, raise typography differences or demand evidence for unrelated absent categories. Keep source evidence real, decisions.answer empty and all approvals absent. Return the corrected full title, summary, brief, terms and ONE style.`,
};
const version = "brief-analysis/0.06";
const model = "muse-spark-1.3";
const candidateSchema = z.object({
  version: z.literal(version),
  inputHash: z.string().min(1),
  sourceHash: z.string().min(1),
  contextHash: z.string().min(1),
  stage: z.string().min(1),
  value: z.unknown(),
  reviewedImageIds: z.array(z.string().min(1)).max(6),
  usageId: z.string().min(1),
  usage: z.object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
  }),
  createdAt: z
    .string()
    .refine((value) => Number.isFinite(Date.parse(value)), "Invalid timestamp"),
});
type Candidate = z.infer<typeof candidateSchema>;
type Job = { id: string; world_id: string; completed: number };
type Segment = { id: string; text_key: string; ordinal: number; text: string };
type Reader = z.infer<typeof briefAnalysisSchemas.reader>;
type Editor = z.infer<typeof briefAnalysisSchemas.editor>;
type Visual = z.infer<typeof briefAnalysisSchemas.visual>;
type Fidelity = z.infer<typeof briefAnalysisSchemas.fidelity>;
const invalidResult = () =>
  new DomainError(
    "MODEL_CONTRACT_INVALID",
    "創作簡報結果不完整或來源無法核對，請重試。",
    502,
  );
function boundedContext(context: unknown) {
  if (new TextEncoder().encode(JSON.stringify(context)).length > 350000)
    throw new DomainError(
      "WORLD_ANALYSIS_SCOPE_REQUIRED",
      "來源與閱讀進度已保存；請縮小這次整理範圍後繼續。",
    );
  return context;
}

/** A delivery performs one billable role at most; all source segments get a fresh compact reading. */
export async function runBriefAnalysis(env: Env, job: Job, w: WorldDraft) {
  if (job.world_id !== w.id) throw new DomainError("WORLD_NOT_FOUND");
  const source = await env.DB.prepare(
    "SELECT sha256,segment_count FROM sources WHERE id=?",
  )
    .bind(w.sourceId)
    .first<{ sha256: string; segment_count: number }>();
  const rows = await env.DB.prepare(
    "SELECT id,text_key,ordinal FROM segments WHERE source_id=? ORDER BY ordinal",
  )
    .bind(w.sourceId)
    .all<Omit<Segment, "text">>();
  if (
    !source?.segment_count ||
    rows.results.length !== source.segment_count ||
    rows.results.some((s, i) => s.ordinal !== i)
  )
    throw new DomainError("SOURCE_INCOMPLETE");
  const segments: Segment[] = await Promise.all(
    rows.results.map(async (s) => {
      const stored = await env.STORAGE.get(s.text_key);
      if (!stored) throw new DomainError("SOURCE_STORAGE_MISSING");
      return { ...s, text: await stored.text() };
    }),
  );
  const imageManifest = (w.sourceImages || []).map(
    ({ id, assetId, sha256, label }) => ({ id, assetId, sha256, label }),
  );
  // Hash actual source bytes, not only mutable DB metadata or legacy extraction output.
  const sourceHash = await sha256(
    JSON.stringify({
      sourceId: w.sourceId,
      sha256: source.sha256,
      segments,
      images: imageManifest,
    }),
  );
  const inputHash = await sha256(
    JSON.stringify({
      version,
      sourceHash,
      revision: w.revision,
      authorBrief: w.importBrief,
      sourceTitle: w.title,
      mode: w.mode,
      imageCoverageNote: w.imageCoverageNote,
    }),
  );
  const stages = [
    ...segments.map((s) => `reader:${s.ordinal}`),
    "editor",
    "visual",
    "fidelity",
  ];
  const checkpoints = await env.DB.prepare(
    "SELECT stage,output_json FROM analysis_checkpoints WHERE job_id=? AND input_hash=?",
  )
    .bind(job.id, inputHash)
    .all<{ stage: string; output_json: string }>();
  const checkpointRows = new Map(
    checkpoints.results.map((row) => [row.stage, row.output_json]),
  );
  const stored = new Map<string, Candidate>();
  const cacheKey = (stage: string) =>
    `jobs/${job.id}/brief/${inputHash}/${stage}.json`;
  const imageIds = imageManifest.map((image) => image.id);
  const schemaFor = (stage: string) =>
    stage.startsWith("reader:")
      ? briefAnalysisSchemas.reader
      : briefAnalysisSchemas[stage as "editor" | "visual" | "fidelity"];
  function verifyEvidence(e: z.infer<typeof evidenceSchema>) {
    const segment = segments.find((s) => s.id === e.segmentId);
    const quote = segment && resolveQuote(segment.text, e.quote);
    if (!quote) throw invalidResult();
    return { ...e, quote };
  }
  function normalize(stage: string, value: unknown) {
    const parsed = schemaFor(stage).safeParse(value);
    if (!parsed.success) throw invalidResult();
    const checked = (normalized: unknown) => {
      const valid = schemaFor(stage).safeParse(normalized);
      if (!valid.success) throw invalidResult();
      return valid.data;
    };
    if (stage.startsWith("reader:")) {
      const segment = segments.find((s) => `reader:${s.ordinal}` === stage)!;
      const reading = parsed.data as Reader;
      return checked({
        notes: reading.notes.map((note) => {
          const quote = resolveQuote(segment.text, note.quote);
          if (!quote) throw invalidResult();
          return { ...note, quote };
        }),
      });
    }
    if (stage === "visual") return parsed.data;
    const result = parsed.data as Editor | Fidelity;
    return checked({
      ...result,
      brief: {
        ...result.brief,
        decisions: result.brief.decisions
          .filter(
            (decision, index, decisions) =>
              decisions.findIndex(
                (other) =>
                  other.section === decision.section &&
                  other.question === decision.question,
              ) === index,
          )
          .map((decision) => ({ ...decision, answer: "" })),
        evidence: result.brief.evidence.map(verifyEvidence),
        referenceStatus: imageIds.length
          ? stage === "fidelity"
            ? ("reviewed" as const)
            : ("unread" as const)
          : ("not_provided" as const),
      },
      terms: result.terms.map((term) => {
        const evidence = verifyEvidence(term.evidence);
        const segment = segments.find((s) => s.id === evidence.segmentId)!;
        if (!resolveQuote(segment.text, term.sourceName)) throw invalidResult();
        return { ...term, evidence };
      }),
    });
  }
  async function invalidateFrom(stage: string) {
    const affected = stages.slice(stages.indexOf(stage));
    // Candidates must go first: a failed DB delete must not resurrect dependent output.
    for (const key of affected) await env.STORAGE.delete(cacheKey(key));
    await env.DB.batch(
      affected.map((key) =>
        env.DB.prepare(
          "DELETE FROM analysis_checkpoints WHERE job_id=? AND input_hash=? AND stage=?",
        ).bind(job.id, inputHash, key),
      ),
    );
    for (const key of affected) {
      checkpointRows.delete(key);
      stored.delete(key);
    }
  }
  function candidateFrom(
    raw: unknown,
    stage: string,
    contextHash: string,
  ): Candidate {
    const candidate = candidateSchema.parse(raw);
    const expectedImages =
      stage === "visual" || stage === "fidelity" ? imageIds : [];
    if (
      candidate.inputHash !== inputHash ||
      candidate.sourceHash !== sourceHash ||
      candidate.contextHash !== contextHash ||
      candidate.stage !== stage ||
      JSON.stringify(candidate.reviewedImageIds) !==
        JSON.stringify(expectedImages)
    )
      throw invalidResult();
    return { ...candidate, value: normalize(stage, candidate.value) };
  }
  function readingNotes() {
    return segments
      .filter((s) => stored.has(`reader:${s.ordinal}`))
      .map((s) => ({
        segmentId: s.id,
        notes: (stored.get(`reader:${s.ordinal}`)!.value as Reader).notes,
      }));
  }
  function sourcePassages(editor: Editor) {
    const references = [
      ...editor.brief.evidence,
      ...editor.terms.map((term) => term.evidence),
      ...readingNotes().flatMap((reading) =>
        reading.notes.map((note) => ({
          section: note.section,
          segmentId: reading.segmentId,
          quote: note.quote,
        })),
      ),
    ];
    const unique = new Set<string>();
    return references.flatMap((reference) => {
      const evidence = verifyEvidence(reference);
      const key = `${evidence.segmentId}:${evidence.quote}`;
      if (unique.has(key)) return [];
      unique.add(key);
      const segment = segments.find((s) => s.id === evidence.segmentId)!;
      const at = segment.text.indexOf(evidence.quote);
      // Supply actual surrounding prose, not just another role's quote assertion.
      const startOffset = Math.max(0, at - 600);
      const endOffset = Math.min(
        segment.text.length,
        at + evidence.quote.length + 600,
      );
      return [
        {
          section: evidence.section,
          segmentId: segment.id,
          startOffset,
          endOffset,
          originalText: segment.text.slice(startOffset, endOffset),
        },
      ];
    });
  }
  const references = {
    referenceImages: imageManifest.map(({ id, label }) => ({ id, label })),
    imageCoverageNote: w.imageCoverageNote,
  };
  function contextFor(stage: string): unknown {
    if (stage.startsWith("reader:")) {
      const segment = segments.find((s) => `reader:${s.ordinal}` === stage)!;
      return {
        stage,
        segmentId: segment.id,
        text: segment.text,
        authorBrief: w.importBrief,
      };
    }
    if (stage === "editor")
      return {
        stage,
        sourceTitle: w.title,
        readingNotes: readingNotes(),
        authorBrief: w.importBrief,
        ...references,
      };
    const editor = stored.get("editor")!.value as Editor;
    if (stage === "visual")
      return {
        stage,
        brief: editor.brief,
        sourcePassages: sourcePassages(editor),
        authorBrief: w.importBrief,
        ...references,
      };
    const visual = stored.get("visual")!.value as Visual;
    return {
      stage,
      proposed: {
        ...editor,
        brief: {
          ...editor.brief,
          visual: visual.visual,
          referenceStatus: imageIds.length ? "reviewed" : "not_provided",
        },
        style: visual.style,
      },
      sourcePassages: sourcePassages(editor),
      authorBrief: w.importBrief,
      sourceCoverage: {
        segmentCount: segments.length,
        readCount: readingNotes().length,
      },
      ...references,
    };
  }
  async function runStage(
    stage: string,
    context: unknown,
    contextHash: string,
  ) {
    let candidate: Candidate | undefined;
    const cached = await env.STORAGE.get(cacheKey(stage));
    if (cached) {
      try {
        candidate = candidateFrom(await cached.json(), stage, contextHash);
      } catch (error) {
        if (!(
          error instanceof SyntaxError ||
          error instanceof z.ZodError ||
          error instanceof DomainError
        ))
          throw error;
        await invalidateFrom(stage);
      }
    }
    if (!candidate) {
      const images =
        stage === "visual" || stage === "fidelity"
          ? await sourceImageData(env, w)
          : [];
      if (
        images.length !==
        (stage === "visual" || stage === "fidelity" ? imageIds.length : 0)
      )
        throw new DomainError("SOURCE_IMAGE_MISSING");
      await usage(
        env,
        job,
        stage,
        model,
        async () => {
          const result = await callJson(
            env.MODEL_API_KEY,
            prompts[
              stage.startsWith("reader:")
                ? "reader"
                : (stage as "editor" | "visual" | "fidelity")
            ],
            context,
            schemaFor(stage),
            fetch,
            images,
          );
          return { ...result, value: normalize(stage, result.value) };
        },
        async (result, usageId) => {
          candidate = {
            version,
            inputHash,
            sourceHash,
            contextHash,
            stage,
            value: result.value,
            usageId,
            usage: result.usage,
            createdAt: now(),
            reviewedImageIds: images.length ? imageIds : [],
          };
          // Save the valid response and exact bill receipt before any post-model D1 write.
          await env.STORAGE.put(cacheKey(stage), JSON.stringify(candidate));
        },
      );
    }
    if (!candidate) throw invalidResult();
    await restoreUsage(env, job, stage, model, candidate);
    const extra: D1PreparedStatement[] = [];
    if (stage.startsWith("reader:")) {
      const segment = segments.find((s) => `reader:${s.ordinal}` === stage)!;
      extra.push(
        env.DB.prepare(
          "UPDATE segments SET status='done' WHERE id=? AND source_id=?",
        ).bind(segment.id, w.sourceId),
        env.DB.prepare("UPDATE sources SET processed_count=? WHERE id=?").bind(
          readingNotes().length + 1,
          w.sourceId,
        ),
      );
    }
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO analysis_checkpoints(job_id,stage,input_hash,output_json,created_at) VALUES(?,?,?,?,?)",
      ).bind(
        job.id,
        stage,
        inputHash,
        JSON.stringify(candidate),
        candidate.createdAt,
      ),
      ...extra,
      auditStatement(
        env,
        w.id,
        "brief.role_completed",
        "創作簡報整理進度已保存。",
        { stage, inputHash, modelCompletedAt: candidate.createdAt },
      ),
    ]);
    return {
      done: false as const,
      completed: stored.size + 1,
      message: stage.startsWith("reader:")
        ? `閱讀原作 ${readingNotes().length + 1}/${source!.segment_count}`
        : stage === "editor"
          ? "六項創作簡報已整理"
          : stage === "visual"
            ? "視覺方向已整理"
            : "創作簡報已核對",
    };
  }
  for (const stage of stages) {
    const context = boundedContext(contextFor(stage));
    const prompt =
      prompts[
        stage.startsWith("reader:")
          ? "reader"
          : (stage as "editor" | "visual" | "fidelity")
      ];
    const contextHash = await sha256(
      JSON.stringify({
        prompt,
        context,
        images: stage === "visual" || stage === "fidelity" ? imageManifest : [],
      }),
    );
    const saved = checkpointRows.get(stage);
    if (saved) {
      let candidate: Candidate;
      try {
        candidate = candidateFrom(JSON.parse(saved), stage, contextHash);
      } catch (error) {
        if (!(
          error instanceof SyntaxError ||
          error instanceof z.ZodError ||
          error instanceof DomainError
        ))
          throw error;
        await invalidateFrom(stage);
        return runStage(stage, context, contextHash);
      }
      await restoreUsage(env, job, stage, model, candidate);
      stored.set(stage, candidate);
      continue;
    }
    if (
      stages
        .slice(stages.indexOf(stage) + 1)
        .some((key) => checkpointRows.has(key))
    )
      await invalidateFrom(stage);
    return runStage(stage, context, contextHash);
  }
  const reviewed = stored.get("fidelity")!.value as Fidelity;
  const fresh = await getWorld(env, w.id);
  if (
    fresh.revision !== w.revision ||
    fresh.recordVersion !== w.recordVersion ||
    JSON.stringify(fresh.importBrief) !== JSON.stringify(w.importBrief) ||
    JSON.stringify(fresh.sourceImages) !== JSON.stringify(w.sourceImages)
  )
    return {
      done: false as const,
      completed: 0,
      message: "補充已更新，重新整合創作簡報",
    };
  const elements: Element[] = [];
  for (const term of reviewed.terms) {
    const id = `element_${(await sha256(JSON.stringify([w.id, term.kind, term.sourceName, term.evidence.segmentId]))).slice(0, 24)}`;
    if (elements.some((element) => element.id === id)) continue;
    elements.push({
      id,
      kind: term.kind,
      sourceName: term.sourceName,
      names: { en: term.englishName, "zh-Hant": term.sourceName, ja: "" },
      definition: term.definition,
      aliases: [],
      features: [],
    });
  }
  const brief = worldBriefSchema.parse({
    ...reviewed.brief,
    decisions: await Promise.all(
      reviewed.brief.decisions.map(async (decision) => ({
        ...decision,
        id: `decision_${(await sha256(JSON.stringify([decision.section, decision.question]))).slice(0, 24)}`,
        answer: "",
      })),
    ),
  });
  const next: WorldDraft = {
    ...fresh,
    title: reviewed.title,
    summary: reviewed.summary,
    brief,
    briefApproval: null,
    frameworkApproval: null,
    visualApproval: null,
    sourceImages: fresh.sourceImages?.map((image) => ({
      ...image,
      status: "reviewed" as const,
    })),
    era: "",
    geography: "",
    ecology: "",
    rules: [],
    elements,
    questions: [],
    styles: [reviewed.style],
    selectedStyleId: reviewed.style.id,
    status: "draft",
  };
  delete next.framework;
  await saveWorld(
    env,
    next,
    w.revision,
    "brief.compiled",
    "六項創作簡報已整理，等待作者確認。",
    [
      env.DB.prepare(
        "UPDATE sources SET processed_count=segment_count WHERE id=?",
      ).bind(w.sourceId),
      env.DB.prepare(
        "UPDATE jobs SET status='succeeded',stage='complete',completed=total,lease_until=NULL,updated_at=? WHERE id=?",
      ).bind(now(), job.id),
      env.DB.prepare(
        "INSERT INTO messages(id,world_id,role,content,created_at) VALUES(?,?,'assistant',?,?)",
      ).bind(
        `message_${job.id}_brief_review`,
        w.id,
        "六項創作簡報與視覺方向已填好。請核對內容與必要裁定，確認設定後再檢視視覺試稿；目前尚未啟用或公開。",
        now(),
      ),
    ],
  );
  return {
    done: true as const,
    completed: stages.length + 1,
    message: "創作簡報等待作者確認",
  };
}
