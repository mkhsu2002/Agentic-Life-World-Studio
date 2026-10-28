import type { Env } from "./env";
import { DomainError, newId, now } from "./domain";
export type UsageReceipt = {
  usageId: string;
  usage: { input: number; output: number };
};
/** Reconcile only the original billable operation; cached results never create a bill. */
export async function restoreUsage(
  env: Env,
  job: { world_id: string; id: string },
  stage: string,
  model: string,
  receipt: UsageReceipt,
) {
  const restored = await env.DB.prepare(
    "UPDATE usage_ledger SET status='incurred',input_tokens=?,output_tokens=? WHERE id=? AND job_id=? AND world_id=? AND stage=? AND model=?",
  )
    .bind(
      receipt.usage.input,
      receipt.usage.output,
      receipt.usageId,
      job.id,
      job.world_id,
      stage,
      model,
    )
    .run();
  if (restored.meta.changes !== 1)
    throw new DomainError("USAGE_CHECKPOINT_INVALID");
}
export async function usage<T>(
  env: Env,
  job: { world_id: string; id?: string },
  stage: string,
  model: string,
  work: () => Promise<T>,
  onResult?: (result: T, usageId: string) => Promise<void>,
): Promise<T> {
  const id = newId("usage");
  await env.DB.prepare(
    "INSERT INTO usage_ledger(id,world_id,job_id,model,stage,status,created_at) VALUES(?,?,?,?,?,'reserved',?)",
  )
    .bind(id, job.world_id, job.id || null, model, stage, now())
    .run();
  try {
    const result = await work();
    // A successful provider response must survive any subsequent D1 failure.
    await onResult?.(result, id);
    const u = (result as { usage?: { input: number; output: number } }).usage;
    await env.DB.prepare(
      "UPDATE usage_ledger SET status='incurred',input_tokens=?,output_tokens=? WHERE id=?",
    )
      .bind(u?.input || 0, u?.output || 0, id)
      .run();
    return result;
  } catch (e) {
    try {
      await env.DB.prepare(
        "UPDATE usage_ledger SET status='uncertain' WHERE id=?",
      )
        .bind(id)
        .run();
    } catch {
      // Leave the reservation intact when D1 is unavailable; preserve the cause.
    }
    throw e;
  }
}
