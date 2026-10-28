import { z } from "zod";

export const moduleKeys = [
  "identity",
  "time",
  "laws",
  "space",
  "environment",
  "life",
  "civilization",
  "visual",
] as const;
export type ModuleKey = (typeof moduleKeys)[number];
export const moduleLabels: Record<ModuleKey, string> = {
  identity: "世界識別與定位",
  time: "時代、變遷與現況",
  laws: "世界運作法則",
  space: "空間與區域差異",
  environment: "環境與感官條件",
  life: "生命、行動者與生態",
  civilization: "文明、文化與人造物",
  visual: "視覺規範",
};
const text = z.string().max(6000);
const nonempty = z.string().trim().min(1).max(6000);
export const evidenceSchema = z.object({ segmentId: z.string(), quote: text });
export const moduleSchema = z.object({
  key: z.enum(moduleKeys),
  summary: nonempty,
  status: z.enum(["known", "unknown", "not_applicable"]),
  basis: z.enum([
    "source_explicit",
    "source_inferred",
    "author_supplied",
    "proposed_extension",
  ]),
  evidence: z.array(evidenceSchema).max(20),
});
const decision = z.enum(["pending", "accepted", "rejected"]);
export const frameworkSchema = z
  .object({
    version: z.literal("world-framework/0.03"),
    modules: z
      .array(moduleSchema)
      .length(8)
      .refine(
        (m) => new Set(m.map((x) => x.key)).size === 8,
        "Each world module must occur once",
      ),
    anchors: z
      .array(
        z.object({
          id: z.string().min(1),
          module: z.enum(moduleKeys),
          definition: nonempty,
          evidence: z.array(evidenceSchema).max(20),
        }),
      )
      .min(1)
      .max(120),
    extensions: z
      .array(
        z.object({
          id: z.string().min(1),
          module: z.enum(moduleKeys),
          title: nonempty,
          definition: nonempty,
          reason: nonempty,
          limits: nonempty,
          decision,
        }),
      )
      .max(90),
    envelopes: z
      .array(
        z.object({
          id: z.string().min(1),
          title: nonempty,
          scope: nonempty,
          allowedChanges: z.array(nonempty).min(1).max(20),
          limits: z.array(nonempty).min(1).max(20),
          prohibitedChanges: z.array(nonempty).min(1).max(20),
          decision,
        }),
      )
      .max(20),
    naming: z.object({
      world: nonempty,
      places: nonempty,
      life: nonempty,
      objects: nonempty,
      translation: nonempty,
    }),
    audience: z.object({ intent: nonempty, tone: nonempty }),
    exploration: z.object({
      observer: nonempty,
      knowledgeBoundary: nonempty,
      disclosure: nonempty,
      intervention: nonempty,
      startTime: nonempty,
      startPlace: nonempty,
      initialConditions: nonempty,
      allowedTransitions: nonempty,
    }),
    relations: z
      .array(
        z.object({
          id: z.string().min(1),
          subjectId: z.string().min(1),
          predicate: nonempty,
          objectId: z.string().min(1),
          definition: nonempty,
        }),
      )
      .max(200),
    issues: z
      .array(
        z.object({
          id: z.string().min(1),
          module: z.enum(moduleKeys),
          message: nonempty,
          recommendation: nonempty,
          blocking: z.boolean(),
          resolution: text,
        }),
      )
      .max(5000),
    fidelity: z.object({
      verdict: z.enum(["pass", "needs_confirmation"]),
      notes: z.array(text).max(3000),
    }),
    visual: z.object({
      referenceStatus: z.enum(["reviewed", "not_provided", "unread"]),
      characteristics: nonempty,
      invariants: z.array(nonempty).max(30),
      forbidden: z.array(nonempty).max(30),
    }),
  })
  .superRefine((f, ctx) => {
    for (const key of [
      "anchors",
      "extensions",
      "envelopes",
      "issues",
      "relations",
    ] as const) {
      if (new Set(f[key].map((x) => x.id)).size !== f[key].length)
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "IDs must be unique",
        });
    }
  });
export type WorldFramework = z.infer<typeof frameworkSchema>;
export type FrameworkApproval = {
  hash: string;
  revision: number;
  approvedAt: string;
} | null;
export type SourceImage = {
  id: string;
  assetId: string;
  label: string;
  sha256: string;
  status: "available" | "reviewed";
};
