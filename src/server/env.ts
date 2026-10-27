export type JobMessage = { jobId: string };
export interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
  JOBS: Queue<JobMessage>;
  ASSETS: Fetcher;
  MODEL_API_KEY: string;
  STUDIO_PASSWORD: string;
  SESSION_SECRET: string;
  GOOGLE_SERVICE_ACCOUNT?: string;
  ENVIRONMENT: string;
  BUILD_REVISION: string;
}
