import { z } from "zod";
import type { EvidenceProblem, EvidenceDecision } from "../shared/contracts";
import {
  extractionSchema,
  extractedElementSchema,
  featureSchema,
} from "../shared/contracts";
import { DomainError, resolveQuote } from "./domain";
export type Extraction = z.infer<typeof extractionSchema>;
/** Formatting uncertainty remains a proposal for world-level review, never verified evidence. */
export function prepareWorldReading(
  source: string,
  value: Extraction,
  segmentId: string,
) {
  const { candidate, problems } = inspectEvidence(source, value, segmentId);
  const invalid = new Set(problems.map((p) => p.id));
  candidate.elements.forEach((e, i) => {
    if (!e.features.length)
      e.features = [
        {
          id: "definition",
          text: e.definition,
          quote: "",
          segmentId,
          origin: "inferred",
          locked: false,
        },
      ];
    e.features.forEach((f, j) => {
      if (
        invalid.has(`element:${i}:feature:${j}`) ||
        invalid.has(`element:${i}:definition`)
      ) {
        f.origin = "inferred";
        f.quote = "";
        f.locked = false;
        f.segmentId = segmentId;
      }
    });
  });
  candidate.facts = candidate.facts.filter((_, i) => !invalid.has(`fact:${i}`));
  candidate.warnings.push(
    ...problems.map((p) => `unverified candidate (${segmentId}): ${p.claim}`),
  );
  return candidate;
}
export const resolvedExtractionSchema = extractionSchema.extend({
  elements: z.array(
    extractedElementSchema.extend({
      features: z.array(
        featureSchema.extend({
          origin: z.enum(["source", "inferred", "user"]),
        }),
      ),
    }),
  ),
  facts: z.array(
    z.object({
      text: z.string(),
      quote: z.string(),
      segmentId: z.string(),
      origin: z.enum(["source", "user"]).optional(),
    }),
  ),
});
export type ResolvedExtraction = z.infer<typeof resolvedExtractionSchema>;
export function inspectEvidence(
  source: string,
  value: Extraction,
  segmentId: string,
) {
  const candidate = structuredClone(value),
    problems: EvidenceProblem[] = [];
  candidate.elements.forEach((element, i) => {
    if (!element.features.length) {
      problems.push({
        id: `element:${i}:definition`,
        kind: "feature",
        elementName: element.sourceName,
        claim: element.definition,
        quote: "",
      });
      return;
    }
    // The definition is derived from the evidence-bearing features, so removed claims cannot survive in prose.
    element.definition = element.features.map((f) => f.text).join("; ");
    element.features.forEach((feature, j) => {
      const quote = resolveQuote(source, feature.quote);
      if (quote) {
        feature.quote = quote;
        feature.segmentId = segmentId;
      } else
        problems.push({
          id: `element:${i}:feature:${j}`,
          kind: "feature",
          elementName: element.sourceName,
          claim: feature.text,
          quote: feature.quote,
        });
    });
  });
  candidate.facts.forEach((fact, i) => {
    const quote = resolveQuote(source, fact.quote);
    if (quote) {
      fact.quote = quote;
      fact.segmentId = segmentId;
    } else
      problems.push({
        id: `fact:${i}`,
        kind: "fact",
        elementName: null,
        claim: fact.text,
        quote: fact.quote,
      });
  });
  return { candidate, problems };
}
export function applyEvidenceDecisions(
  source: string,
  value: Extraction,
  decisions: Record<string, EvidenceDecision>,
  segmentId: string,
): ResolvedExtraction {
  const { candidate, problems } = inspectEvidence(source, value, segmentId);
  if (
    Object.keys(decisions).length !== problems.length ||
    problems.some((p) => !decisions[p.id]) ||
    Object.keys(decisions).some((id) => !problems.some((p) => p.id === id))
  )
    throw new DomainError("EVIDENCE_DECISIONS_INCOMPLETE");
  const apply = (
    id: string,
    claim: {
      text: string;
      quote: string;
      segmentId: string;
      origin?: string;
      locked?: boolean;
    },
  ) => {
    const decision = decisions[id];
    if (!decision) return claim;
    if (decision.action === "exclude") return null;
    const text = decision.text?.trim() || claim.text;
    if (decision.action === "author_confirm")
      return {
        ...claim,
        text,
        quote: "",
        segmentId,
        origin: "user",
        locked: true,
      };
    const quote = resolveQuote(source, decision.quote || "");
    if (!quote) throw new DomainError("EVIDENCE_REPLACEMENT_INVALID");
    return { ...claim, text, quote, segmentId, origin: "source" };
  };
  const elements = candidate.elements.flatMap((e, i) => {
    if (!e.features.length) {
      const resolved = apply(`element:${i}:definition`, {
        text: e.definition,
        quote: "",
        segmentId,
        origin: "source",
        locked: false,
      });
      return resolved
        ? [
            {
              ...e,
              definition: resolved.text,
              features: [{ ...resolved, id: "definition" }],
            },
          ]
        : [];
    }
    const features = e.features.flatMap((f, j) => {
      const next = apply(`element:${i}:feature:${j}`, f);
      return next ? [next] : [];
    });
    if (e.features.length && !features.length) return [];
    const touched = problems.some((p) => p.id.startsWith(`element:${i}:`));
    return [
      {
        ...e,
        features,
        definition: touched
          ? features.map((f) => f.text).join("; ")
          : e.definition,
      },
    ];
  });
  const facts = candidate.facts.flatMap((f, i) => {
    const next = apply(`fact:${i}`, f);
    return next ? [next] : [];
  });
  return resolvedExtractionSchema.parse({ ...candidate, elements, facts });
}
