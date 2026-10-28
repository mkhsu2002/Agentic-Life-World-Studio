export type JobMessage =
  { jobId: string } | { studioTaskId: string } | { studioWakeupId: string };
export interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
  JOBS: Queue<JobMessage>;
  ASSETS: Fetcher;
  MODEL_API_KEY: string;
  STUDIO_PASSWORD: string;
  SESSION_SECRET: string;
  GOOGLE_SERVICE_ACCOUNT?: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_INSTALLATION_ID?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  STUDIO_DEPLOY_TOKEN?: string;
  STUDIO_PUBLIC_ORIGIN?: string;
  OPERATIONS?: Workflow<{ wakeupId: string; dueAt: string }>;
  ENVIRONMENT: string;
  BUILD_REVISION: string;
}
