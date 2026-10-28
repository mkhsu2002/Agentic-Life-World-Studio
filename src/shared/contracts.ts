import { z } from "zod";
import type { WorldBrief } from "./world-brief";
import type {
  WorldFramework,
  FrameworkApproval,
  SourceImage,
} from "./world-framework";
export const locales = ["en", "zh-Hant", "ja"] as const;
export type Locale = (typeof locales)[number];
export type SourceKind = "text" | "url" | "docx" | "pdf" | "google-doc";
export type Feature = {
  id: string;
  text: string;
  quote: string;
  segmentId: string;
  origin: "source" | "inferred" | "user";
  locked: boolean;
};
export type Element = {
  id: string;
  kind: string;
  sourceName: string;
  names: Record<Locale, string>;
  definition: string;
  features: Feature[];
  aliases: string[];
};
export type Question = {
  id: string;
  question: string;
  context: string;
  options: string[];
  answer: string | null;
};
export type VisualStyle = {
  id: string;
  name: string;
  description: string;
  medium: string;
  palette: string[];
  lighting: string;
  materials: string[];
  forbidden: string[];
  evidence: string[];
};
export type VisualPreview = {
  id: string;
  styleId: string;
  elementId: string;
  assetId: string;
  revision: number;
  feedback: string;
  review: { verdict: "pass" | "revise"; notes: string[] };
  createdAt: string;
};
export type VisualApproval = {
  previewId: string;
  revision: number;
  approvedAt: string;
} | null;
export type Translation = {
  locale: Locale;
  status: "draft" | "review" | "approved" | "stale";
  sourceRevision: number;
  title: string;
  tagline: string;
  introduction: string;
  elements: Record<
    string,
    { name: string; definition: string; features: Record<string, string> }
  >;
  issues: string[];
  approvedAt: string | null;
};
export type ImportBrief = {
  timeframe: string;
  scope: string;
  visualStyle: string;
  notes: string;
  confirmedAt: string | null;
};
export type EvidenceProblem = {
  id: string;
  kind: "feature" | "fact";
  elementName: string | null;
  claim: string;
  quote: string;
};
export type EvidenceDecision = {
  action: "replace_quote" | "author_confirm" | "exclude";
  quote?: string;
  text?: string;
};
export type ImportReview = {
  id: string;
  jobId: string;
  kind: "evidence" | "processing" | "brief";
  message: string;
  segmentOrdinal: number | null;
  sourceText: string;
  problems: EvidenceProblem[];
  createdAt: string;
};
export type WorldDraft = {
  brief?: WorldBrief;
  briefApproval?: FrameworkApproval;
  framework?: WorldFramework;
  frameworkApproval?: FrameworkApproval;
  sourceImages?: SourceImage[];
  imageCoverageNote?: string;
  id: string;
  recordVersion?: number;
  resolvedDecisions?: string;
  importBrief?: ImportBrief;
  title: string;
  revision: number;
  status: "reading" | "draft" | "confirmed";
  sourceId: string;
  summary: string;
  era: string;
  geography: string;
  ecology: string;
  rules: string[];
  elements: Element[];
  questions: Question[];
  styles: VisualStyle[];
  selectedStyleId: string | null;
  visualApproval: VisualApproval;
  mode: "landscape" | "ecology" | "mixed";
  translations: Partial<Record<Locale, Translation>>;
  previews: VisualPreview[];
  createdAt: string;
  updatedAt: string;
};
export type SourceInfo = {
  id: string;
  title: string;
  kind: SourceKind;
  url: string | null;
  sha256: string;
  charCount: number;
  segmentCount: number;
  processedCount: number;
  createdAt: string;
};
export type Job = {
  id: string;
  worldId: string | null;
  kind: string;
  status: "queued" | "running" | "waiting_user" | "succeeded" | "failed";
  stage: string;
  completed: number;
  total: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};
export type AuditEvent = {
  id: string;
  worldId: string | null;
  type: string;
  message: string;
  createdAt: string;
};
export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};
export type SiteRelease = {
  id: string;
  worldId: string;
  slug: string;
  revision: number;
  status: "preview" | "verifying" | "active" | "failed" | "superseded";
  locales: Locale[];
  url: string;
  hash: string;
  createdAt: string;
};
export type WorldDetail = {
  briefHash?: string | null;
  frameworkHash: string | null;
  importReview: ImportReview | null;
  importSuggestions: string[];
  world: WorldDraft;
  source: SourceInfo;
  jobs: Job[];
  audit: AuditEvent[];
  messages: ChatMessage[];
  releases: SiteRelease[];
};
export type StudioOverview = {
  worlds: WorldDraft[];
  jobs: Job[];
  audit: AuditEvent[];
  version: string;
  capabilities: { meta: boolean; image: boolean; google: boolean };
};
export type PublicWorld = {
  releaseId: string;
  slug: string;
  revision: number;
  locale: Locale;
  locales: Locale[];
  title: string;
  tagline: string;
  introduction: string;
  elements: {
    id: string;
    kind: string;
    name: string;
    definition: string;
    features: string[];
  }[];
  imageUrl: string | null;
  palette: string[];
  createdAt: string;
};
export const featureSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  quote: z.string(),
  segmentId: z.string(),
  origin: z.enum(["source", "inferred"]),
  locked: z.boolean(),
});
export const extractedElementSchema = z.object({
  key: z.string(),
  kind: z.string(),
  sourceName: z.string(),
  englishName: z.string(),
  definition: z.string(),
  aliases: z.array(z.string()),
  features: z.array(featureSchema),
});
export const extractionSchema = z.object({
  worldOverview: z.string().max(3000).optional(),
  guidance: z.array(z.string()).max(6).optional(),
  elements: z.array(extractedElementSchema),
  facts: z.array(
    z.object({ text: z.string(), quote: z.string(), segmentId: z.string() }),
  ),
  warnings: z.array(z.string()),
});
export const synthesisSchema = z.object({
  title: z.string(),
  summary: z.string(),
  era: z.string(),
  geography: z.string(),
  ecology: z.string(),
  rules: z.array(z.string()),
  questions: z.array(
    z.object({
      id: z.string(),
      question: z.string(),
      context: z.string(),
      options: z.array(z.string()),
    }),
  ),
  styles: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      medium: z.string(),
      palette: z.array(z.string()),
      lighting: z.string(),
      materials: z.array(z.string()),
      forbidden: z.array(z.string()),
      evidence: z.array(z.string()),
    }),
  ),
});
export const translationSchema = z.object({
  title: z.string(),
  tagline: z.string(),
  introduction: z.string(),
  elements: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      definition: z.string(),
      features: z.array(z.object({ id: z.string(), text: z.string() })),
    }),
  ),
});
export const reviewSchema = z.object({
  verdict: z.enum(["pass", "revise"]),
  issues: z.array(z.string()),
});
