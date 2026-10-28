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
    await step.sleepUntil(
      "wait-until-next-exploration",
      new Date(event.payload.dueAt),
    );
    await step.do("dispatch-exploration", async () => {
      await this.env.JOBS.send({ studioWakeupId: event.payload.wakeupId });
      return { dispatched: true };
    });
  }
}
