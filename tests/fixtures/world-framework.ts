import { frameworkSchema, moduleKeys } from "../../src/shared/world-framework";
import type { WorldDraft } from "../../src/shared/contracts";
export function frameworkFixture() {
  return frameworkSchema.parse({
    version: "world-framework/0.03",
    modules: moduleKeys.map((key) => ({
      key,
      summary: key === "identity" ? "An enclosed world" : "Unknown",
      status: key === "identity" ? "known" : "unknown",
      basis: "source_explicit",
      evidence: [],
    })),
    anchors: [
      {
        id: "a1",
        module: "identity",
        definition: "The enclosure is a defining boundary.",
        evidence: [],
      },
    ],
    extensions: [],
    envelopes: [],
    naming: {
      world: "Preserve original names",
      places: "Unknown",
      life: "Not applicable",
      objects: "Unknown",
      translation: "Preserve identity across languages",
    },
    audience: { intent: "Curious readers", tone: "Quiet observation" },
    exploration: {
      observer: "A limited observer",
      knowledgeBoundary: "Only what is observed",
      disclosure: "No unseen events",
      intervention: "No changes",
      startTime: "Initial sequence",
      startPlace: "e",
      initialConditions: "As described",
      allowedTransitions: "No new settings",
    },
    relations: [],
    issues: [],
    fidelity: { verdict: "pass", notes: [] },
    visual: {
      referenceStatus: "not_provided",
      characteristics: "Text-derived proposal",
      invariants: ["Preserve boundaries"],
      forbidden: ["Unrelated motifs"],
    },
  });
}
export function frameworkWorld(): WorldDraft {
  return {
    id: "w",
    sourceId: "s",
    revision: 1,
    title: "Enclosure",
    summary: "An enclosed world",
    era: "Unknown",
    geography: "Enclosure",
    ecology: "Unknown",
    rules: [],
    elements: [
      {
        id: "e",
        kind: "place",
        sourceName: "Enclosure",
        names: { en: "Enclosure", "zh-Hant": "封閉空間", ja: "囲い" },
        definition: "A closed place",
        aliases: [],
        features: [],
      },
    ],
    questions: [],
    styles: [],
    status: "draft",
    selectedStyleId: null,
    visualApproval: null,
    mode: "landscape",
    translations: {},
    previews: [],
    createdAt: "now",
    updatedAt: "now",
    framework: frameworkFixture(),
  };
}
