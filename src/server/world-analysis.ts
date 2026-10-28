import { z } from "zod";
import type { Env } from "./env";
import type { WorldDraft, Element } from "../shared/contracts";
import {
  frameworkSchema,
  moduleSchema,
  type WorldFramework,
} from "../shared/world-framework";
import { synthesisSchema } from "../shared/contracts";
import { resolvedExtractionSchema } from "./import-evidence";
import { BASE } from "./prompts";
import { DomainError, now, sha256, resolveQuote } from "./domain";
import { getWorld, saveWorld, auditStatement } from "./repository";
import { callJson } from "./meta";
import { usage } from "./usage";
import { sourceImageData } from "./source-images";

const shape = frameworkSchema.shape;
const uniqueIds = <T extends z.ZodType<{ id: string }>>(
  schema: T,
  max: number,
) =>
  z
    .array(schema)
    .max(max)
    .refine(
      (items) => new Set(items.map((item) => item.id)).size === items.length,
      "IDs must be unique",
    );
const domainAnchors = uniqueIds(shape.anchors.element, 30);
const domainModules = (keys: readonly string[]) =>
  z
    .array(moduleSchema)
    .length(keys.length)
    .refine(
      (modules) =>
        new Set(modules.map((m) => m.key)).size === keys.length &&
        modules.every((m) => keys.includes(m.key)),
      "Unexpected role module set",
    );
export const analysisRoleSchemas = {
  architect: z.object({
    title: z.string().min(1),
    summary: z.string().min(1),
    modules: shape.modules,
    anchors: uniqueIds(shape.anchors.element, 30).min(1),
    issues: uniqueIds(shape.issues.element, 30),
  }),
  civilization: z.object({
    modules: domainModules(["time", "laws", "civilization"]),
    anchors: domainAnchors,
    extensions: uniqueIds(shape.extensions.element, 30),
  }),
  geography: z.object({
    modules: domainModules(["space", "environment"]),
    anchors: domainAnchors,
    extensions: uniqueIds(shape.extensions.element, 30),
  }),
  ecology: z.object({
    modules: domainModules(["life"]),
    anchors: domainAnchors,
    extensions: uniqueIds(shape.extensions.element, 30),
  }),
  visual: z.object({
    module: moduleSchema.extend({ key: z.literal("visual") }),
    visual: shape.visual,
    styles: synthesisSchema.shape.styles
      .length(3)
      .refine(
        (styles) => new Set(styles.map((s) => s.id)).size === styles.length,
        "Style IDs must be unique",
      ),
    audience: shape.audience,
    exploration: shape.exploration,
  }),
  naming: z.object({
    naming: shape.naming,
    relations: uniqueIds(shape.relations.element, 200),
    envelopes: uniqueIds(shape.envelopes.element, 20),
  }),
  fidelity: z.object({
    verdict: z.enum(["pass", "needs_confirmation"]),
    notes: z.array(shape.fidelity.shape.notes.element).max(20),
    issues: uniqueIds(shape.issues.element, 30),
  }),
};
const common =
  BASE +
  ` PRIVATE Studio fields are Traditional Chinese; public title/summary and element descriptions are English. Your output is always a draft, never authorized. Faithful completion requires explicit author review: do not mix proposed extensions into source-grounded summaries or core anchors. Extension/envelope decisions must be pending. Unknown and not_applicable are valid; do not assume missing categories exist. Include only material worldbuilding, exclude incidental plot and publication metadata. Quote original source with supplied segment IDs; if not directly supported mark inferred or unknown. Preserve perspective, historical time and causal limits. Never infer an exact audience demographic from genre. Do not treat another role's prose as proof. All displayed image references are private, not permission to publish them.`;
const prompts = {
  architect:
    common +
    ` ROLE: WORLD_ARCHITECT. Understand this whole work using the complete indexed reading notes; identify its core world, not a list of plot events. Fill all eight modules exactly once, identify immutable core anchors, and ask only high-impact unresolved questions in issues (resolution empty). Make concise distinctions between era, laws, space, environment, life, civilization and visual language. Do not invent a world name if none is given; use a clearly descriptive working title.`,
  civilization:
    common +
    ` ROLE: ERA_AND_CIVILIZATION. Return exactly the time, laws and civilization modules. Define formative changes, present civilization, capabilities, conditions/costs/limits, culture, artifacts and resources. Never assume all areas share a technology level. Anchors preserve actual core constraints. Missing details needed for exploration become separate proposed extensions with explicit limits, not facts.`,
  geography:
    common +
    ` ROLE: GEOGRAPHY_AND_ENVIRONMENT. Return exactly space and environment modules. Define dynamic containment, regional contrasts, connections/access, medium/air if applicable, light, cycles, landscape and risks. Do not invent coordinates, a fixed number of regions or Earth assumptions. Explain supported causal relationships; unsupported causality is an extension proposal.`,
  ecology:
    common +
    ` ROLE: LIFE_AND_ECOLOGY. Return exactly the life module. Identify applicable actors, morphology/scale, behavior, habitat, resource dependence and interactions. Do not create organisms to populate a catalogue, conflate an individual's observation with its whole type, or equate lack of hostility with lack of hazard. If life is absent/not relevant, mark it accordingly with no invented species.`,
  visual:
    common +
    ` ROLE: VISUAL_AND_AUDIENCE_DIRECTOR. Return the visual module, a visual bible and exactly three compatible style proposals. Analyze actual supplied image pixels if present, distinguish their visual evidence from text-derived proposals. If there are no images, referenceStatus=not_provided and explicitly call the style text-derived. Choose form/material/scale, medium, color/light/atmosphere, invariants and forbidden motifs without assuming photographic realism. Also propose private audience intent/tone and bounded observer knowledge, disclosure, intervention and initial exploration conditions. startPlace must be one supplied element ID; no omniscient observer. Do not invent a photographer as an original character.`,
  naming:
    common +
    ` ROLE: NAMING_AND_ELEMENT_CURATOR. Use the stable supplied element IDs and sourceElementScopes. identityAmbiguities are unresolved: same name does not establish same entity. Keep these scoped identities separate and never claim they have been disambiguated. Define world/place/life/object naming conventions and multilingual translation principles. Do not claim inferred patterns or proposed translations are official. Propose explicit bounded generation envelopes where useful: scope, allowed operations, concrete limits and prohibited changes, all pending author approval. Empty envelopes prohibit new settings. Create only source-supported relations among existing IDs, with clear scoped meaning; no unknown references, invented taxonomy or fixed regional counts.`,
  fidelity:
    common +
    ` ROLE: INDEPENDENT_FIDELITY_AUDITOR. Independently inspect the supplied ORIGINAL source segment and, when supplied, actual images, against the proposed whole world. Other roles' summaries and source quotes are claims, not proof. Flag only consequential contradictions, unsupported core claims, inappropriate extensions or leakage of perspective/time. Do not create punctuation/typography questions. Do not demand proof for unrelated modules not addressed by this segment. Return needs_confirmation with concrete blocking issues and an actionable recommendation when material contradictions cannot be safely resolved. resolution must stay empty. Do not authorize anything.`,
};
type AnalysisJob = { id: string; world_id: string; completed: number };
type Segment = {
  id: string;
  text_key: string;
  result_json: string;
  ordinal: number;
  status: string;
};

const roleStages = [
  "architect",
  "civilization",
  "geography",
  "ecology",
  "visual",
  "naming",
] as const;
const analysisVersion = "world-analysis/0.03.2";
const candidateSchema = z.object({
  version: z.literal(analysisVersion),
  inputHash: z.string().min(1),
  stage: z.string().min(1),
  value: z.unknown(),
  usageId: z.string().min(1),
  usage: z.object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
  }),
  createdAt: z
    .string()
    .refine((value) => Number.isFinite(Date.parse(value)), "Invalid timestamp"),
});

async function sourceElements(
  w: WorldDraft,
  batches: z.infer<typeof resolvedExtractionSchema>[],
  segments: Segment[],
) {
  const elements: Element[] = [];
  const sourceElementScopes: {
    elementId: string;
    segmentId: string;
    entryKey: string;
    entryOrdinal: number;
  }[] = [];
  const names = new Map<string, string[]>();
  for (const [batchOrdinal, batch] of batches.entries())
    for (const [entryOrdinal, e] of batch.elements.entries()) {
      // Names alone cannot establish identity across source scopes. Keep candidates separate.
      const segmentId = segments[batchOrdinal].id;
      const id = `element_${(await sha256(JSON.stringify([w.id, segmentId, e.key, entryOrdinal]))).slice(0, 24)}`;
      const features = await Promise.all(
        e.features.map(async (f, ordinal) => ({
          ...f,
          id: `feature_${(await sha256(JSON.stringify([id, ordinal, f.segmentId, f.text]))).slice(0, 24)}`,
          locked: false,
        })),
      );
      elements.push({
        id,
        kind: e.kind,
        sourceName: e.sourceName,
        names: { en: e.englishName, "zh-Hant": e.sourceName, ja: "" },
        definition: features.length
          ? features.map((f) => f.text).join("; ")
          : e.definition,
        aliases: e.aliases,
        features,
      });
      sourceElementScopes.push({
        elementId: id,
        segmentId,
        entryKey: e.key,
        entryOrdinal,
      });
      const nameKey = `${e.kind}:${e.sourceName.normalize("NFKC").toLowerCase().replace(/\s+/g, "")}`;
      names.set(nameKey, [...(names.get(nameKey) || []), id]);
    }
  const identityAmbiguities = [...names.values()]
    .filter((ids) => ids.length > 1)
    .map((elementIds) => ({
      elementIds,
      status: "unresolved",
      reason: "同名來源項目保留各自範圍；尚無足夠證據確認是否為同一對象。",
    }));
  return { elements, sourceElementScopes, identityAmbiguities };
}

/** Validate both newly generated and persisted role results against current source identities. */
function validateRole<T extends z.ZodType>(
  stage: string,
  value: unknown,
  schema: T,
  elements: Element[],
): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new DomainError(
      "MODEL_CONTRACT_INVALID",
      "世界整理結果不完整，請重試。",
      502,
    );
  const ids = new Set(elements.map((e) => e.id));
  if (stage === "visual") {
    const visual = analysisRoleSchemas.visual.parse(parsed.data);
    if (!ids.has(visual.exploration.startPlace))
      throw new DomainError(
        "MODEL_CONTRACT_INVALID",
        "起始位置無法對應原作，請重新整理。",
        502,
      );
  }
  if (stage === "naming") {
    const naming = analysisRoleSchemas.naming.parse(parsed.data);
    if (
      naming.relations.some(
        (r) => !ids.has(r.subjectId) || !ids.has(r.objectId),
      )
    )
      throw new DomainError(
        "MODEL_CONTRACT_INVALID",
        "對象關係無法對應原作，請重新整理。",
        502,
      );
  }
  return parsed.data;
}

/** One role invocation per queue delivery. Original source remains available for independent review. */
export async function runWorldAnalysis(
  env: Env,
  job: AnalysisJob,
  w: WorldDraft,
) {
  const source = await env.DB.prepare(
    "SELECT sha256,segment_count,processed_count FROM sources WHERE id=?",
  )
    .bind(w.sourceId)
    .first<{
      sha256: string;
      segment_count: number;
      processed_count: number;
    }>();
  const rows = await env.DB.prepare(
    "SELECT id,text_key,result_json,ordinal,status FROM segments WHERE source_id=? ORDER BY ordinal",
  )
    .bind(w.sourceId)
    .all<Segment>();
  if (
    !source ||
    !source.segment_count ||
    source.processed_count !== source.segment_count ||
    rows.results.length !== source.segment_count ||
    rows.results.some((s) => s.status !== "done" || !s.result_json)
  )
    throw new DomainError("SOURCE_INCOMPLETE");
  const batches = rows.results.map((s) =>
    resolvedExtractionSchema.parse(JSON.parse(s.result_json)),
  );
  const { elements, sourceElementScopes, identityAmbiguities } =
    await sourceElements(w, batches, rows.results);
  if (!elements.length)
    throw new DomainError(
      "WORLD_COMPILATION_EMPTY",
      "原作尚無可定位的觀察對象，請補充世界範圍後繼續。",
    );
  const inputHash = await sha256(
    JSON.stringify({
      version: analysisVersion,
      source: source.sha256,
      readings: batches,
      brief: w.importBrief,
      revision: w.revision,
      images: w.sourceImages || [],
      coverage: w.imageCoverageNote,
      mode: w.mode,
    }),
  );
  const checkpoints = await env.DB.prepare(
    "SELECT stage,output_json FROM analysis_checkpoints WHERE job_id=? AND input_hash=?",
  )
    .bind(job.id, inputHash)
    .all<{ stage: string; output_json: string }>();
  const stages = [
    ...roleStages,
    ...rows.results.map((segment) => `fidelity:${segment.ordinal}`),
  ];
  const cacheKey = (stage: string) =>
    `jobs/${job.id}/analysis/${inputHash}/${stage}.json`;
  const stored = new Map<string, unknown>();
  const checkpointRows = new Map(
    checkpoints.results.map((row) => [row.stage, row.output_json]),
  );
  const schemaFor = (stage: string) =>
    stage.startsWith("fidelity:")
      ? analysisRoleSchemas.fidelity
      : analysisRoleSchemas[stage as (typeof roleStages)[number]];
  async function invalidateFrom(stage: string) {
    const affected = stages.slice(stages.indexOf(stage));
    // Remove dependent R2 candidates first so a failed DB delete cannot later resurrect them.
    for (const key of affected) await env.STORAGE.delete(cacheKey(key));
    await env.DB.batch(
      affected.map((key) =>
        env.DB.prepare(
          "DELETE FROM analysis_checkpoints WHERE job_id=? AND input_hash=? AND stage=?",
        ).bind(job.id, inputHash, key),
      ),
    );
    for (const key of affected) stored.delete(key);
  }
  for (const stage of stages) {
    if (!checkpointRows.has(stage)) {
      if (
        stages
          .slice(stages.indexOf(stage) + 1)
          .some((key) => checkpointRows.has(key))
      )
        await invalidateFrom(stage);
      break;
    }
    try {
      stored.set(
        stage,
        validateRole(
          stage,
          JSON.parse(checkpointRows.get(stage)!),
          schemaFor(stage),
          elements,
        ),
      );
    } catch (error) {
      if (!(error instanceof SyntaxError) && !(error instanceof DomainError))
        throw error;
      await invalidateFrom(stage);
      break;
    }
  }
  const notes = rows.results.map((s, i) => ({
    segmentId: s.id,
    overview: batches[i].worldOverview || "",
    facts: batches[i].facts,
    warnings: batches[i].warnings,
    elementIds: sourceElementScopes
      .filter((scope) => scope.segmentId === s.id)
      .map((scope) => scope.elementId),
  }));
  // No silent truncation. Very large work is retained and the author can narrow scope before retrying.
  if (new TextEncoder().encode(JSON.stringify(notes)).length > 350000)
    throw new DomainError(
      "WORLD_ANALYSIS_SCOPE_REQUIRED",
      "來源已保存；請縮小這次世界建立範圍後再整理。",
    );
  const shared = {
    sourceTitle: w.title,
    readingNotes: notes,
    elements,
    sourceElementScopes,
    identityAmbiguities,
    authorBrief: w.importBrief,
    imageCoverageNote: w.imageCoverageNote,
    priorRoles: Object.fromEntries(
      [...stored].filter(([key]) => !key.startsWith("fidelity:")),
    ),
  };
  async function run<T extends z.ZodType>(
    stage: string,
    prompt: string,
    context: unknown,
    schema: T,
    images: string[] = [],
  ) {
    let candidate:
      | {
          value: z.infer<T>;
          usageId: string;
          usage: { input: number; output: number };
          createdAt: string;
        }
      | undefined;
    const cached = await env.STORAGE.get(cacheKey(stage));
    if (cached) {
      try {
        const raw = candidateSchema.parse(await cached.json());
        if (raw.inputHash !== inputHash || raw.stage !== stage)
          throw new DomainError("MODEL_CONTRACT_INVALID");
        candidate = {
          ...raw,
          value: validateRole(stage, raw.value, schema, elements),
        };
      } catch {
        await invalidateFrom(stage);
      }
    }
    if (!candidate) {
      candidate = await usage(env, job, stage, "muse-spark-1.3", async () => {
        const reservation = await env.DB.prepare(
          "SELECT id FROM usage_ledger WHERE job_id=? AND world_id=? AND stage=? AND status='reserved' ORDER BY created_at DESC,id DESC LIMIT 1",
        )
          .bind(job.id, w.id, stage)
          .first<{ id: string }>();
        if (!reservation) throw new DomainError("USAGE_RESERVATION_MISSING");
        const result = await callJson(
          env.MODEL_API_KEY,
          prompt,
          context,
          schema,
          fetch,
          images,
        );
        const value = validateRole(stage, result.value, schema, elements);
        const saved = {
          version: analysisVersion,
          inputHash,
          stage,
          value,
          usageId: reservation.id,
          usage: result.usage,
          createdAt: now(),
        };
        // Persist before any post-model D1 write, including the usage ledger update.
        await env.STORAGE.put(cacheKey(stage), JSON.stringify(saved));
        return saved;
      });
    }
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE usage_ledger SET status='incurred',input_tokens=?,output_tokens=? WHERE id=? AND job_id=? AND world_id=? AND stage=?",
      ).bind(
        candidate.usage.input,
        candidate.usage.output,
        candidate.usageId,
        job.id,
        w.id,
        stage,
      ),
      env.DB.prepare(
        "INSERT OR IGNORE INTO analysis_checkpoints(job_id,stage,input_hash,output_json,created_at) VALUES(?,?,?,?,?)",
      ).bind(
        job.id,
        stage,
        inputHash,
        JSON.stringify(candidate.value),
        candidate.createdAt,
      ),
      auditStatement(
        env,
        w.id,
        "analysis.role_completed",
        `已完成世界整理：${stage}`,
        { stage, inputHash, modelCompletedAt: candidate.createdAt },
      ),
    ]);
    return {
      done: false as const,
      completed: source!.segment_count + stored.size + 1,
      message: `世界整理：${stage}`,
    };
  }
  for (const stage of roleStages) {
    if (stored.has(stage)) continue;
    const images = stage === "visual" ? await sourceImageData(env, w) : [];
    return run(
      stage,
      prompts[stage],
      {
        ...shared,
        stage,
        referenceImages: (w.sourceImages || []).map((i) => ({
          id: i.id,
          label: i.label,
        })),
      },
      analysisRoleSchemas[stage],
      images,
    );
  }
  const architect = analysisRoleSchemas.architect.parse(
    stored.get("architect"),
  );
  const civilized = analysisRoleSchemas.civilization.parse(
    stored.get("civilization"),
  );
  const geography = analysisRoleSchemas.geography.parse(
    stored.get("geography"),
  );
  const ecology = analysisRoleSchemas.ecology.parse(stored.get("ecology"));
  const visual = analysisRoleSchemas.visual.parse(stored.get("visual"));
  const naming = analysisRoleSchemas.naming.parse(stored.get("naming"));
  const modules = [...architect.modules];
  for (const [proposal, expected] of [
    [civilized, ["time", "laws", "civilization"]],
    [geography, ["space", "environment"]],
    [ecology, ["life"]],
  ] as const) {
    if (
      proposal.modules.length !== expected.length ||
      expected.some((key) => !proposal.modules.some((m) => m.key === key))
    )
      throw new DomainError(
        "MODEL_CONTRACT_INVALID",
        "專業模組範圍不完整，請重試世界整理。",
      );
    for (const m of proposal.modules)
      modules[modules.findIndex((x) => x.key === m.key)] = m;
  }
  if (visual.module.key !== "visual")
    throw new DomainError("MODEL_CONTRACT_INVALID");
  modules[modules.findIndex((m) => m.key === "visual")] = visual.module;
  const anchors = [architect, civilized, geography, ecology].flatMap((r, i) =>
    r.anchors.map((a, j) => ({ ...a, id: `anchor_${i}_${j}` })),
  );
  const extensions = [civilized, geography, ecology].flatMap((r, i) =>
    r.extensions.map((e, j) => ({
      ...e,
      id: `extension_${i}_${j}`,
      decision: "pending" as const,
    })),
  );
  const envelopes = naming.envelopes.map((e, i) => ({
    ...e,
    id: `envelope_${i}`,
    decision: "pending" as const,
  }));
  const normalizedVisual = {
    ...visual.visual,
    referenceStatus: w.sourceImages?.length
      ? ("reviewed" as const)
      : ("not_provided" as const),
  };
  const proposed = {
    modules,
    anchors,
    extensions,
    envelopes,
    styles: visual.styles,
    elements,
    naming: naming.naming,
    relations: naming.relations,
    visual: normalizedVisual,
    audience: visual.audience,
    exploration: visual.exploration,
  };
  for (const segment of rows.results) {
    const stage = `fidelity:${segment.ordinal}`;
    if (stored.has(stage)) continue;
    const obj = await env.STORAGE.get(segment.text_key);
    if (!obj) throw new DomainError("SOURCE_STORAGE_MISSING");
    const images = segment.ordinal === 0 ? await sourceImageData(env, w) : [];
    return run(
      stage,
      prompts.fidelity,
      {
        stage,
        segmentId: segment.id,
        originalText: await obj.text(),
        proposedWorld: proposed,
        otherSourceNotes: notes,
        authorBrief: w.importBrief,
      },
      analysisRoleSchemas.fidelity,
      images,
    );
  }
  const reviews = rows.results.map((s) =>
    analysisRoleSchemas.fidelity.parse(stored.get(`fidelity:${s.ordinal}`)),
  );
  const issues = [...architect.issues, ...reviews.flatMap((r) => r.issues)].map(
    (issue, i) => ({ ...issue, id: `issue_${i}`, resolution: "" }),
  );
  // Exact source matching verifies attribution, while semantic auditing still owns meaning.
  const textCache = new Map<string, string>();
  async function verifyEvidence(
    evidence: WorldFramework["anchors"][number]["evidence"],
  ) {
    const verified: typeof evidence = [];
    for (const e of evidence) {
      const segment = rows.results.find((s) => s.id === e.segmentId);
      let text = textCache.get(e.segmentId);
      if (text === undefined && segment) {
        const obj = await env.STORAGE.get(segment.text_key);
        text = obj ? await obj.text() : "";
        textCache.set(e.segmentId, text);
      }
      const quote = segment ? resolveQuote(text || "", e.quote) : null;
      if (quote) verified.push({ ...e, quote });
    }
    return verified;
  }
  for (const m of modules) {
    const evidence = await verifyEvidence(m.evidence);
    if (evidence.length !== m.evidence.length) {
      issues.push({
        id: `evidence_${issues.length}`,
        module: m.key,
        message: `「${m.summary}」的來源引句尚未核實，已列為推論。`,
        recommendation: "可核對原作或補充說明；此提醒不影響其他內容的確認。",
        blocking: false,
        resolution: "",
      });
      m.basis = "source_inferred";
    }
    m.evidence = evidence;
  }
  for (const anchor of anchors) {
    const evidence = await verifyEvidence(anchor.evidence);
    if (!evidence.length || evidence.length !== anchor.evidence.length)
      issues.push({
        id: `anchor_evidence_${issues.length}`,
        module: anchor.module,
        message: `核心設定「${anchor.definition}」缺少可核實的原作引句。`,
        recommendation:
          "請提供可核對的來源，或明確決定將其作為作者補充或修正核心設定。",
        blocking: true,
        resolution: "",
      });
    anchor.evidence = evidence;
  }
  for (const review of reviews)
    if (review.verdict === "needs_confirmation" && !review.issues.length)
      issues.push({
        id: `audit_${issues.length}`,
        module: "identity",
        message: review.notes.join("；") || "忠實度審核仍有未解項目。",
        recommendation: "請核對核心世界設定並補充決定。",
        blocking: true,
        resolution: "",
      });
  const ids = new Set(elements.map((e) => e.id));
  if (
    naming.relations.some((r) => !ids.has(r.subjectId) || !ids.has(r.objectId))
  )
    throw new DomainError("FRAMEWORK_RELATION_INVALID");
  const framework: WorldFramework = frameworkSchema.parse({
    version: "world-framework/0.03",
    ...proposed,
    issues,
    fidelity: {
      verdict: issues.some((i) => i.blocking) ? "needs_confirmation" : "pass",
      notes: reviews.flatMap((r) => r.notes),
    },
    visual: normalizedVisual,
  });
  const fresh = await getWorld(env, w.id);
  if (
    fresh.revision !== w.revision ||
    JSON.stringify(fresh.importBrief) !== JSON.stringify(w.importBrief) ||
    JSON.stringify(fresh.sourceImages) !== JSON.stringify(w.sourceImages)
  )
    return {
      done: false as const,
      completed: source.segment_count,
      message: "補充已更新，重新整合世界方案",
    };
  const summary = (key: string) => modules.find((m) => m.key === key)!.summary;
  const next: WorldDraft = {
    ...fresh,
    framework,
    frameworkApproval: null,
    sourceImages: fresh.sourceImages?.map((i) => ({
      ...i,
      status: "reviewed" as const,
    })),
    title: architect.title,
    summary: architect.summary,
    era: summary("time"),
    geography: summary("space"),
    ecology: summary("life"),
    rules: [summary("laws")],
    elements,
    questions: [],
    styles: visual.styles,
    selectedStyleId: null,
    visualApproval: null,
    status: "draft",
  };
  await saveWorld(
    env,
    next,
    w.revision,
    "world.compiled",
    "世界方案已整理完成，等待作者確認核心、補全與視覺方向",
    [
      env.DB.prepare(
        "UPDATE jobs SET status='succeeded',stage='complete',completed=total,lease_until=NULL,updated_at=? WHERE id=?",
      ).bind(now(), job.id),
      env.DB.prepare(
        "INSERT INTO messages(id,world_id,role,content,created_at) VALUES(?,?,'assistant',?,?)",
      ).bind(
        `message_${job.id}_world_review`,
        w.id,
        "已整理世界的八個面向、核心設定與建議補全。請先在「世界審核」檢視並確認，再進行視覺校準；目前尚未啟用或公開。",
        now(),
      ),
    ],
  );
  return {
    done: true as const,
    completed: source.segment_count + stored.size,
    message: "世界方案等待作者確認",
  };
}
