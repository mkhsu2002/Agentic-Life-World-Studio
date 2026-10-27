import type { Env } from "./env";
import { newId, now } from "./domain";
export async function usage<T>(
  env: Env,
  job: { world_id: string; id?: string },
  stage: string,
  model: string,
  work: () => Promise<T>,
): Promise<T> {
  const id = newId("usage");
  await env.DB.prepare(
    "INSERT INTO usage_ledger(id,world_id,job_id,model,stage,status,created_at) VALUES(?,?,?,?,?,'reserved',?)",
  )
    .bind(id, job.world_id, job.id || null, model, stage, now())
    .run();
  try {
    const result = await work();
    const u = (result as { usage?: { input: number; output: number } }).usage;
    await env.DB.prepare(
      "UPDATE usage_ledger SET status='incurred',input_tokens=?,output_tokens=? WHERE id=?",
    )
      .bind(u?.input || 0, u?.output || 0, id)
      .run();
    return result;
  } catch (e) {
    await env.DB.prepare(
      "UPDATE usage_ledger SET status='uncertain' WHERE id=?",
    )
      .bind(id)
      .run();
    throw e;
  }
}
