import { describe, it, expect } from "vitest";
import {
  validateConfirmation,
  validateLocale,
  assertRevision,
  splitSegments,
  decisionKey,
} from "../src/server/domain";
import type { WorldDraft } from "../src/shared/contracts";
const world = (): WorldDraft => ({
  id: "w",
  title: "World",
  revision: 2,
  status: "draft",
  sourceId: "s",
  summary: "World summary",
  era: "Unknown",
  geography: "Unknown",
  ecology: "Unknown",
  rules: [],
  elements: [],
  questions: [
    {
      id: "q",
      question: "Choose era",
      context: "Unknown",
      options: ["A", "B"],
      answer: null,
    },
  ],
  styles: [],
  selectedStyleId: null,
  visualApproval: null,
  mode: "mixed",
  translations: {},
  previews: [],
  createdAt: "now",
  updatedAt: "now",
});
describe("world approval invariants", () => {
  it("rejects incomplete source coverage", () =>
    expect(() => validateConfirmation(world(), 1, 2)).toThrow(
      "SOURCE_INCOMPLETE",
    ));
  it("rejects unanswered material questions", () =>
    expect(() => validateConfirmation(world(), 2, 2)).toThrow(
      "UNRESOLVED_QUESTIONS",
    ));
  it("requires a calibrated image approval from the same revision", () => {
    const w = world();
    w.questions[0].answer = "A";
    w.resolvedDecisions = decisionKey(w);
    expect(() => validateConfirmation(w, 2, 2)).toThrow("VISUAL_NOT_APPROVED");
  });
  it("rejects stale updates", () =>
    expect(() => assertRevision(world(), 1)).toThrow("REVISION_CONFLICT"));
  it("rejects locale coverage with missing elements", () =>
    expect(() =>
      validateLocale(world(), {
        locale: "ja",
        status: "review",
        sourceRevision: 2,
        title: "世界",
        tagline: "旅",
        introduction: "紹介",
        elements: {},
        issues: ["missing terms"],
        approvedAt: null,
      }),
    ).toThrow("TRANSLATION_REVIEW_REQUIRED"));
});
describe("complete and stable source segmentation", () => {
  it("preserves all Unicode characters without splitting surrogate pairs", () => {
    const text = "A𠮷😀世界\n".repeat(6000);
    const segments = splitSegments(text, 7000);
    expect(segments.map((s) => s.text).join("")).toBe(text);
    expect(segments.every((s) => Array.from(s.text).length <= 7000)).toBe(true);
    expect(segments.at(-1)?.end).toBe(Array.from(text).length);
  });
});

it("normalizes only whitespace when recovering an exact source quotation", async () => {
  const { resolveQuote } = await import("../src/server/domain");
  expect(resolveQuote("Alpha\n  city is quiet.", "Alpha city is quiet.")).toBe(
    "Alpha\n  city is quiet.",
  );
  expect(resolveQuote("The gate is closed.", "The gate is open.")).toBeNull();
});
