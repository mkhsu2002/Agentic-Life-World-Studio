import type { WorldDraft } from "../shared/contracts";
import { frameworkSchema } from "../shared/world-framework";
import { DomainError, sha256 } from "./domain";

export async function frameworkHash(w: WorldDraft) {
  return sha256(
    JSON.stringify({
      sourceId: w.sourceId,
      title: w.title,
      summary: w.summary,
      era: w.era,
      geography: w.geography,
      ecology: w.ecology,
      rules: w.rules,
      elements: w.elements,
      framework: w.framework,
      mode: w.mode,
      styles: w.styles,
      selectedStyleId: w.selectedStyleId,
      sourceImages: w.sourceImages || [],
      imageCoverageNote: w.imageCoverageNote || "",
    }),
  );
}
export function validateFrameworkReview(w: WorldDraft) {
  if (!w.framework) throw new DomainError("FRAMEWORK_REQUIRED");
  const f = frameworkSchema.parse(w.framework);
  if ([...f.extensions, ...f.envelopes].some((x) => x.decision === "pending"))
    throw new DomainError("EXTENSION_DECISIONS_REQUIRED");
  if (f.issues.some((i) => i.blocking && !i.resolution.trim()))
    throw new DomainError("FRAMEWORK_ISSUES_UNRESOLVED");
  const ids = new Set(w.elements.map((e) => e.id));
  if (!ids.has(f.exploration.startPlace))
    throw new DomainError("FRAMEWORK_START_INVALID");
  if (f.relations.some((r) => !ids.has(r.subjectId) || !ids.has(r.objectId)))
    throw new DomainError("FRAMEWORK_RELATION_INVALID");
}
export async function assertFrameworkReviewed(w: WorldDraft) {
  validateFrameworkReview(w);
  if (
    !w.frameworkApproval ||
    w.frameworkApproval.revision !== w.revision ||
    w.frameworkApproval.hash !== (await frameworkHash(w))
  )
    throw new DomainError("FRAMEWORK_NOT_APPROVED");
}
/** Runtime-only projection: pending/rejected extensions never enter image or publication context. */
export function approvedFrameworkContext(w: WorldDraft) {
  const f = w.framework;
  return f
    ? {
        modules: f.modules,
        anchors: f.anchors,
        extensions: f.extensions.filter((e) => e.decision === "accepted"),
        envelopes: f.envelopes.filter((e) => e.decision === "accepted"),
        naming: f.naming,
        exploration: f.exploration,
        visual: f.visual,
      }
    : null;
}
