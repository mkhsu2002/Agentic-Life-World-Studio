import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import type { Env } from "./env";
export class StudioAutonomyWorkflow extends WorkflowEntrypoint<
  Env,
  { wakeupId: string; dueAt: string }
> {
  async run(
    event: WorkflowEvent<{ wakeupId: string; dueAt: string }>,
    step: WorkflowStep,
  ) {
    const due = new Date(event.payload.dueAt);
    if (!Number.isFinite(due.getTime()))
      throw new Error("Invalid exploration schedule");
    const delay = await step.do(
      "calculate-exploration-delay",
      { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" } },
      async () => Math.max(0, due.getTime() - Date.now()),
    );
    // Persist both the decision and duration so replay follows the same steps.
    // A relative timer also cannot become invalid while the step is persisted.
    if (delay > 0) await step.sleep("wait-until-next-exploration", delay);
    await step.do(
      "dispatch-exploration",
      { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" } },
      async () => {
        await this.env.JOBS.send({ studioWakeupId: event.payload.wakeupId });
        return { dispatched: true };
      },
    );
  }
}
