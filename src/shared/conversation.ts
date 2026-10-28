export type StudioLocale = "en" | "zh-Hant" | "ja";
export type StudioRole =
  | "director"
  | "reader"
  | "review"
  | "world"
  | "journey"
  | "visual"
  | "image"
  | "editorial"
  | "translation"
  | "site"
  | "publish"
  | "operation";
export type ProposalKind =
  "direction" | "world" | "visual" | "site" | "operation";
export type TaskStatus =
  "queued" | "running" | "completed" | "failed" | "cancelled";
export type StudioAttachment = {
  name: string;
  kind: "text" | "image" | "url";
  text?: string;
  url?: string;
  dataUrl?: string;
  originalDataUrl?: string;
  originalKey?: string;
};
export type Direction = {
  core: string;
  extension: string;
  exploration: string;
  continuity: string;
  visual: string;
  audience: string;
};
export type WorldElement = {
  id: string;
  kind: "place" | "life" | "object" | "character" | "other";
  names: Record<StudioLocale, string>;
  definition: string;
  appearance: string;
  features: string[];
  relations: string[];
  origin: "source" | "inference" | "extension" | "author";
};
export type WorldCandidate = {
  title: string;
  summary: string;
  elements: WorldElement[];
};
export type JourneyCandidate = {
  title: string;
  purpose: string;
  placeIds: string[];
  elementIds: string[];
  encounters: string[];
  changes: string[];
};
export type OperationPolicy = {
  enabled: boolean;
  frequencyHours: number;
  maxCalls: number;
  usedCalls: number;
  scope: string;
  nextRunAt: string | null;
};
export type ConversationDocument = {
  direction: Direction | null;
  world: WorldCandidate | null;
  visual: { assetIds: string[]; selectedAssetId: string | null } | null;
  journey: JourneyCandidate | null;
  publication: Record<string, unknown> | null;
  operation: OperationPolicy | null;
  [key: string]: unknown;
};
export type Conversation = {
  id: string;
  title: string;
  revision: number;
  status: "idle" | "working" | "attention";
  document: ConversationDocument;
  createdAt: string;
  updatedAt: string;
};
export type ConversationEvent = {
  id: number;
  conversationId: string;
  type:
    | "user"
    | "assistant"
    | "progress"
    | "proposal"
    | "image"
    | "preview"
    | "error"
    | "operation";
  content: string;
  data: Record<string, unknown>;
  createdAt: string;
};
export type ConversationProposal = {
  id: string;
  conversationId: string;
  kind: ProposalKind;
  revision: number;
  status: "pending" | "approved" | "superseded" | "rejected";
  content: Record<string, unknown>;
  hash: string;
  createdAt: string;
};
export type ConversationAsset = {
  id: string;
  conversationId: string;
  url: string;
  kind: "reference" | "image" | "site" | "original";
  name: string;
  contentType: string;
  createdAt: string;
};
export type ConversationTask = {
  id: string;
  conversationId: string;
  role: StudioRole;
  status: TaskStatus;
  attempts: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};
export type SourceStats = {
  count: number;
  characters: number;
  images: number;
  read: number;
  unavailable: number;
};
export type ConversationSnapshot = {
  conversation: Conversation;
  events: ConversationEvent[];
  cursor: number;
  watermark?: number;
  olderCursor?: number | null;
  tasks: ConversationTask[];
  proposals: ConversationProposal[];
  assets: ConversationAsset[];
  sourceStats: SourceStats;
  usage?: {
    requests: number;
    uncertain: number;
    inputTokens: number;
    outputTokens: number;
  };
};
export type ConversationTurnInput = {
  clientMessageId: string;
  message: string;
  attachments?: StudioAttachment[];
};
export type ConversationTurnAccepted = {
  accepted: true;
  taskId: string;
  duplicate: boolean;
};
