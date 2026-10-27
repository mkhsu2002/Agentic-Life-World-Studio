import { z } from "zod";
import {
  locales,
  reviewSchema,
  translationSchema,
  type Element,
  type Translation,
  type WorldDraft,
} from "../shared/contracts";
import type { Env } from "./env";
import {
  DomainError,
  newId,
  now,
  translationHash,
  validateLocale,
} from "./domain";
import { callJson } from "./meta";
import { TRANSLATOR, TRANSLATION_QA } from "./prompts";
import { getWorld, saveWorld } from "./repository";

const CHUNK_SIZE = 8;
const payloadSchema = z.object({
  revision: z.number().int().positive(),
  locale: z.enum(locales),
  translationHash: z.string().nullable(),
});
const checkpointSchema = payloadSchema.extend({
  reviewOnly: z.boolean(),
  chunk: z.number().int().nonnegative(),
  translation: translationSchema,
  review: reviewSchema.optional(),
});
type Payload = z.infer<typeof payloadSchema>;
type Bundle = z.infer<typeof translationSchema>;
type Checkpoint = z.infer<typeof checkpointSchema>;
type LocalizationJob = {
  id: string;
  world_id: string;
  payload_json: string;
  completed: number;
  total: number;
};

/** Keep one chunk for the introduction even when the registry is empty. */
export function partitionLocalization(elements: Element[]): Element[][] {
  const chunks: Element[][] = [];
  for (let start = 0; start < elements.length; start += CHUNK_SIZE)
    chunks.push(elements.slice(start, start + CHUNK_SIZE));
  return chunks.length ? chunks : [[]];
}

/** Validate arrays before converting them to records, which would hide duplicate IDs. */
export function validateLocalizationChunk(
  elements: Element[],
  output: Bundle,
): void {
  const exactIds = (expected: string[], actual: string[]) =>
    new Set(expected).size === expected.length &&
    actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    actual.every((id) => expected.includes(id));
  if (
    !exactIds(
      elements.map((e) => e.id),
      output.elements.map((e) => e.id),
    )
  )
    throw new DomainError(
      "TRANSLATION_CHUNK_INVALID",
      "Element IDs do not match the source registry",
    );
  for (const element of elements) {
    const translated = output.elements.find(
      (entry) => entry.id === element.id,
    )!;
    if (
      !translated.name.trim() ||
      !translated.definition.trim() ||
      !exactIds(
        element.features.map((f) => f.id),
        translated.features.map((f) => f.id),
      ) ||
      translated.features.some((f) => !f.text.trim())
    )
      throw new DomainError(
        "TRANSLATION_CHUNK_INVALID",
        `Translation is incomplete for ${element.id}`,
      );
  }
}

async function assertCurrent(world: WorldDraft, payload: Payload) {
  if (world.revision !== payload.revision)
    throw new DomainError("REVISION_CONFLICT");
  if (
    (await translationHash(world.translations[payload.locale])) !==
    payload.translationHash
  )
    throw new DomainError("TRANSLATION_CHANGED");
}

function context(world: WorldDraft, elements: Element[]) {
  return {
    summary: world.summary,
    era: world.era,
    geography: world.geography,
    ecology: world.ecology,
    rules: world.rules,
    questions: world.questions,
    elements,
  };
}

function translatedElements(bundle: Bundle): Translation["elements"] {
  return Object.fromEntries(
    bundle.elements.map((element) => [
      element.id,
      {
        name: element.name,
        definition: element.definition,
        features: Object.fromEntries(
          element.features.map((f) => [f.id, f.text]),
        ),
      },
    ]),
  );
}

function sliceTranslation(
  translation: Translation,
  elements: Element[],
): Bundle {
  return {
    title: translation.title,
    tagline: translation.tagline,
    introduction: translation.introduction,
    elements: elements.map((element) => {
      const current = translation.elements[element.id];
      if (!current) throw new DomainError("TRANSLATION_INCOMPLETE");
      return {
        id: element.id,
        name: current.name,
        definition: current.definition,
        features: Object.entries(current.features).map(([id, text]) => ({
          id,
          text,
        })),
      };
    }),
  };
}

/** Reserve before every provider request; transport/contract failures retain uncertain cost. */
async function modelCall<T extends z.ZodType>(
  env: Env,
  job: LocalizationJob,
  stage: string,
  system: string,
  input: unknown,
  schema: T,
) {
  const id = newId("usage");
  await env.DB.prepare(
    "INSERT INTO usage_ledger(id,world_id,job_id,model,stage,status,created_at) VALUES(?,?,?,?,?,'reserved',?)",
  )
    .bind(id, job.world_id, job.id, "muse-spark-1.3", stage, now())
    .run();
  try {
    const result = await callJson(env.MODEL_API_KEY, system, input, schema);
    await env.DB.prepare(
      "UPDATE usage_ledger SET status='incurred',input_tokens=?,output_tokens=? WHERE id=?",
    )
      .bind(result.usage.input, result.usage.output, id)
      .run();
    return result.value;
  } catch (error) {
    await env.DB.prepare(
      "UPDATE usage_ledger SET status='uncertain' WHERE id=?",
    )
      .bind(id)
      .run();
    throw error;
  }
}

function checkpointKey(job: LocalizationJob, chunk: number) {
  return `jobs/${job.id}/localization/${chunk}.json`;
}

async function readCheckpoint(
  env: Env,
  job: LocalizationJob,
  payload: Payload,
  reviewOnly: boolean,
  chunk: number,
  elements: Element[],
) {
  const stored = await env.STORAGE.get(checkpointKey(job, chunk));
  if (!stored) return null;
  const parsed = checkpointSchema.safeParse(JSON.parse(await stored.text()));
  if (!parsed.success) throw new DomainError("LOCALIZATION_CHECKPOINT_INVALID");
  const checkpoint = parsed.data;
  if (
    checkpoint.chunk !== chunk ||
    checkpoint.reviewOnly !== reviewOnly ||
    checkpoint.revision !== payload.revision ||
    checkpoint.locale !== payload.locale ||
    checkpoint.translationHash !== payload.translationHash
  )
    throw new DomainError("LOCALIZATION_CHECKPOINT_INVALID");
  validateLocalizationChunk(elements, checkpoint.translation);
  return checkpoint;
}

async function writeCheckpoint(
  env: Env,
  job: LocalizationJob,
  payload: Payload,
  checkpoint: Checkpoint,
) {
  await assertCurrent(await getWorld(env, job.world_id), payload);
  await env.STORAGE.put(
    checkpointKey(job, checkpoint.chunk),
    JSON.stringify(checkpoint),
  );
}

function reviewIssues(review: z.infer<typeof reviewSchema>) {
  return review.verdict === "pass"
    ? []
    : review.issues.length
      ? review.issues
      : ["Semantic review requires revision"];
}

/** A queue delivery handles one bounded chunk, or the final atomic merge. */
export async function runLocalization(
  env: Env,
  job: LocalizationJob,
  reviewOnly: boolean,
): Promise<{ done: boolean; completed: number; message: string }> {
  const parsed = payloadSchema.safeParse(JSON.parse(job.payload_json));
  if (!parsed.success) throw new DomainError("LOCALIZATION_PAYLOAD_INVALID");
  const payload = parsed.data;
  const world = await getWorld(env, job.world_id);
  await assertCurrent(world, payload);
  const chunks = partitionLocalization(world.elements);
  if (
    job.total !== chunks.length + 1 ||
    !Number.isInteger(job.completed) ||
    job.completed < 0 ||
    job.completed > chunks.length
  )
    throw new DomainError("LOCALIZATION_PROGRESS_INVALID");
  const existing = world.translations[payload.locale];
  if (reviewOnly && !existing) throw new DomainError("TRANSLATION_MISSING");

  if (job.completed < chunks.length) {
    const index = job.completed,
      elements = chunks[index];
    let checkpoint = await readCheckpoint(
      env,
      job,
      payload,
      reviewOnly,
      index,
      elements,
    );
    if (!checkpoint) {
      const lockedTerms = Object.fromEntries(
        elements
          .filter((element) => existing?.elements[element.id])
          .map((element) => [element.id, existing!.elements[element.id]]),
      );
      const translation = reviewOnly
        ? sliceTranslation(existing!, elements)
        : await modelCall(
            env,
            job,
            `localization:${index}`,
            TRANSLATOR,
            {
              locale: payload.locale,
              world: context(world, elements),
              lockedTerms,
            },
            translationSchema,
          );
      validateLocalizationChunk(elements, translation);
      checkpoint = { ...payload, reviewOnly, chunk: index, translation };
      await writeCheckpoint(env, job, payload, checkpoint);
    }
    if (!checkpoint.review) {
      checkpoint.review = await modelCall(
        env,
        job,
        `localization_qa:${index}`,
        TRANSLATION_QA,
        {
          locale: payload.locale,
          world: context(world, elements),
          translation: {
            locale: payload.locale,
            title: checkpoint.translation.title,
            tagline: checkpoint.translation.tagline,
            introduction: checkpoint.translation.introduction,
            elements: translatedElements(checkpoint.translation),
          },
        },
        reviewSchema,
      );
      await writeCheckpoint(env, job, payload, checkpoint);
    }
    return {
      done: false,
      completed: index + 1,
      message: `${payload.locale} terminology ${index + 1}/${chunks.length}`,
    };
  }

  const completed: Checkpoint[] = [];
  for (let index = 0; index < chunks.length; index++) {
    const checkpoint = await readCheckpoint(
      env,
      job,
      payload,
      reviewOnly,
      index,
      chunks[index],
    );
    if (!checkpoint?.review)
      throw new DomainError("LOCALIZATION_CHECKPOINT_MISSING");
    completed.push(checkpoint);
  }
  const first = completed[0].translation;
  const issues = [
    ...new Set(
      completed.flatMap((checkpoint) => reviewIssues(checkpoint.review!)),
    ),
  ];
  const translation: Translation = reviewOnly
    ? {
        ...existing!,
        status: "review",
        approvedAt: null,
        issues,
      }
    : {
        locale: payload.locale,
        status: "review",
        sourceRevision: payload.revision,
        title: first.title,
        tagline: first.tagline,
        introduction: first.introduction,
        elements: Object.assign(
          {},
          ...completed.map((checkpoint) =>
            translatedElements(checkpoint.translation),
          ),
        ),
        issues,
        approvedAt: null,
      };
  // Completeness must be checked even when semantic QA has actionable issues.
  validateLocale(world, { ...translation, issues: [] });
  const fresh = await getWorld(env, job.world_id);
  await assertCurrent(fresh, payload);
  fresh.translations[payload.locale] = translation;
  await saveWorld(
    env,
    fresh,
    payload.revision,
    "translation.reviewed",
    `${payload.locale} translation ready for calibration`,
  );
  return {
    done: true,
    completed: chunks.length + 1,
    message: `${payload.locale} translation and semantic review complete`,
  };
}
