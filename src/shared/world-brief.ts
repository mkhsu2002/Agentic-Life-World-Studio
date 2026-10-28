import { z } from "zod";
export const briefKeys = [
  "world",
  "visual",
  "viewpoint",
  "time",
  "naming",
  "boundaries",
] as const;
export type BriefKey = (typeof briefKeys)[number];
export const briefLabels: Record<BriefKey, string> = {
  world: "世界的基本樣貌",
  visual: "一致的視覺風格",
  viewpoint: "觀看者與敘述聲音",
  time: "旅程時段與揭露界線",
  naming: "命名與必要專有詞",
  boundaries: "延伸創作範圍",
};
const paragraph = z.string().trim().min(1).max(4000);
export const briefDecisionSchema = z.object({
  id: z.string().min(1).max(120),
  section: z.enum(briefKeys),
  question: z.string().trim().min(1).max(600),
  suggestion: z.string().max(1200),
  answer: z.string().max(2000),
});
export const worldBriefSchema = z.object({
  version: z.literal("world-brief/0.06"),
  world: paragraph,
  visual: paragraph,
  viewpoint: paragraph,
  time: paragraph,
  naming: paragraph,
  boundaries: paragraph,
  decisions: z
    .array(briefDecisionSchema)
    .max(5)
    .refine(
      (items) => new Set(items.map((x) => x.id)).size === items.length,
      "Decision IDs must be unique",
    ),
  evidence: z
    .array(
      z.object({
        section: z.enum(briefKeys),
        segmentId: z.string().min(1),
        quote: z.string().min(1).max(1500),
      }),
    )
    .max(18),
  referenceStatus: z.enum(["reviewed", "not_provided", "unread"]),
});
export type WorldBrief = z.infer<typeof worldBriefSchema>;
