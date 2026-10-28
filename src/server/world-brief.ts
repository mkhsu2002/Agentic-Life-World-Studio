import type { WorldDraft } from "../shared/contracts";
import { briefKeys, worldBriefSchema } from "../shared/world-brief";
import { DomainError, sha256 } from "./domain";

export function validateBriefReview(world: WorldDraft) {
  if (!world.brief) throw new DomainError("BRIEF_REQUIRED");
  const brief = worldBriefSchema.parse(world.brief);
  if (brief.decisions.some((decision) => !decision.answer.trim()))
    throw new DomainError("BRIEF_DECISIONS_REQUIRED");
  if (world.sourceImages?.length && brief.referenceStatus !== "reviewed")
    throw new DomainError("BRIEF_IMAGES_UNREVIEWED");
}
export async function briefHash(world: WorldDraft) {
  return sha256(
    JSON.stringify({
      sourceId: world.sourceId,
      title: world.title,
      summary: world.summary,
      era: world.era,
      geography: world.geography,
      ecology: world.ecology,
      rules: world.rules,
      brief: world.brief,
      elements: world.elements,
      styles: world.styles,
      selectedStyleId: world.selectedStyleId,
      sourceImages: world.sourceImages || [],
      imageCoverageNote: world.imageCoverageNote || "",
      mode: world.mode,
    }),
  );
}
export async function assertBriefReviewed(world: WorldDraft) {
  validateBriefReview(world);
  if (
    !world.briefApproval ||
    world.briefApproval.revision !== world.revision ||
    world.briefApproval.hash !== (await briefHash(world))
  )
    throw new DomainError("BRIEF_NOT_APPROVED");
}
/** Private rendering constraints, never a public DTO. */
export function approvedBriefContext(world: WorldDraft) {
  const brief = world.brief;
  if (!brief) return null;
  return {
    ...Object.fromEntries(briefKeys.map((key) => [key, brief[key]])),
    authorDecisions: brief.decisions.map((d) => ({
      section: d.section,
      answer: d.answer,
    })),
  };
}
