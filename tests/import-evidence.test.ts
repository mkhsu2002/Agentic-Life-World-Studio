import { expect, it } from "vitest";
import {
  inspectEvidence,
  applyEvidenceDecisions,
} from "../src/server/import-evidence";

const source =
  "The silver bridge spans a dry valley.\nNo river flows below it.";
const candidate = () => ({
  elements: [
    {
      key: "bridge",
      kind: "place",
      sourceName: "Silver Bridge",
      englishName: "Silver Bridge",
      definition: "A bridge above a flowing river",
      aliases: [],
      features: [
        {
          id: "material",
          text: "Silver bridge",
          quote: "silver bridge",
          segmentId: "wrong",
          origin: "source" as const,
          locked: false,
        },
        {
          id: "water",
          text: "A river flows underneath",
          quote: "A river flows underneath",
          segmentId: "wrong",
          origin: "source" as const,
          locked: false,
        },
      ],
    },
  ],
  facts: [
    { text: "The valley is dry", quote: "a dry valley", segmentId: "wrong" },
  ],
  warnings: [],
});
it("preserves valid evidence and exposes only uncertain claims for confirmation", () => {
  const result = inspectEvidence(source, candidate(), "s1");
  expect(result.problems).toHaveLength(1);
  expect(result.problems[0]).toMatchObject({
    id: "element:0:feature:1",
    claim: "A river flows underneath",
  });
  expect(result.candidate.elements[0].features[0].segmentId).toBe("s1");
  expect(result.candidate.facts[0].segmentId).toBe("s1");
});
it("accepts an author-supplied exact quotation while preserving original source", () => {
  const result = applyEvidenceDecisions(
    source,
    candidate(),
    {
      "element:0:feature:1": {
        action: "replace_quote",
        quote: "No river flows below it.",
        text: "No river flows beneath the bridge",
      },
    },
    "s1",
  );
  expect(result.elements[0].features[1]).toMatchObject({
    text: "No river flows beneath the bridge",
    quote: "No river flows below it.",
    origin: "source",
    segmentId: "s1",
  });
});
it("does not allow invented replacement quotations to become source evidence", () => {
  expect(() =>
    applyEvidenceDecisions(
      source,
      candidate(),
      {
        "element:0:feature:1": {
          action: "replace_quote",
          quote: "There is a river",
        },
      },
      "s1",
    ),
  ).toThrow("EVIDENCE_REPLACEMENT_INVALID");
});
it("keeps author-confirmed supplements distinct from source quotations", () => {
  const result = applyEvidenceDecisions(
    source,
    candidate(),
    { "element:0:feature:1": { action: "author_confirm" } },
    "s1",
  );
  expect(result.elements[0].features[1]).toMatchObject({
    quote: "",
    origin: "user",
    locked: true,
  });
});
it("excludes unsupported features and removes their definition residue", () => {
  const result = applyEvidenceDecisions(
    source,
    candidate(),
    { "element:0:feature:1": { action: "exclude" } },
    "s1",
  );
  expect(result.elements[0].features).toHaveLength(1);
  expect(result.elements[0].definition).not.toContain("river");
});
it("requires an explicit decision for every problem and rejects extra decisions", () => {
  expect(() => applyEvidenceDecisions(source, candidate(), {}, "s1")).toThrow(
    "EVIDENCE_DECISIONS_INCOMPLETE",
  );
  expect(() =>
    applyEvidenceDecisions(
      source,
      candidate(),
      {
        "element:0:feature:1": { action: "exclude" },
        unknown: { action: "exclude" },
      },
      "s1",
    ),
  ).toThrow("EVIDENCE_DECISIONS_INCOMPLETE");
});
it("records explicit author confirmation for uncertain facts", () => {
  const value = candidate();
  value.elements = [];
  value.facts = [
    { text: "Floating valley", quote: "floating valley", segmentId: "wrong" },
  ];
  const result = applyEvidenceDecisions(
    source,
    value,
    { "fact:0": { action: "author_confirm" } },
    "s1",
  );
  expect(result.facts[0]).toMatchObject({
    origin: "user",
    quote: "",
    segmentId: "s1",
  });
});

it("requires confirmation for an element definition that has no supporting feature", () => {
  const value = candidate();
  value.elements[0].features = [];
  const result = inspectEvidence(source, value, "s1");
  expect(result.problems).toEqual([
    expect.objectContaining({
      id: "element:0:definition",
      claim: "A bridge above a flowing river",
    }),
  ]);
  const resolved = applyEvidenceDecisions(
    source,
    value,
    {
      "element:0:definition": {
        action: "author_confirm",
        text: "An ancient bridge",
      },
    },
    "s1",
  );
  expect(resolved.elements[0]).toMatchObject({
    definition: "An ancient bridge",
    features: [{ origin: "user", quote: "" }],
  });
});
it("does not retain unsupported definition prose when a repair drops a feature", () => {
  const value = candidate();
  value.elements[0].features.pop();
  const inspected = inspectEvidence(source, value, "s1");
  expect(inspected.problems).toHaveLength(0);
  expect(inspected.candidate.elements[0].definition).not.toContain("river");
});
