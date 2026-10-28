import { it, expect, vi } from "vitest";
import { StudioAutonomyWorkflow } from "../src/server/conversation-workflow";
it("dispatches an overdue authorized wakeup without asking Cloudflare to sleep into the past", async () => {
  const send = vi.fn().mockResolvedValue(undefined);
  const workflow = new StudioAutonomyWorkflow(
    {} as any,
    { JOBS: { send } } as any,
  );
  const sleep = vi.fn(async (_name: string, duration: number) => {
    if (duration <= 0)
      throw new Error(
        "You can't sleep until a time in the past, time-traveler",
      );
  });
  const step = {
    sleep,
    do: async (_name: string, configOrFn: any, fn?: any) =>
      (fn || configOrFn)(),
  };
  await workflow.run(
    { payload: { wakeupId: "due", dueAt: "2020-01-01T00:00:00Z" } } as any,
    step as any,
  );
  expect(send).toHaveBeenCalledWith({ studioWakeupId: "due" });
  expect(sleep).not.toHaveBeenCalled();
});
it("uses the durable platform timer for a future wakeup and bounds queue dispatch retries", async () => {
  const send = vi.fn().mockResolvedValue(undefined),
    sleep = vi.fn().mockResolvedValue(undefined),
    calls: any[] = [];
  const workflow = new StudioAutonomyWorkflow(
    {} as any,
    { JOBS: { send } } as any,
  );
  await workflow.run(
    { payload: { wakeupId: "future", dueAt: "2099-01-01T00:00:00Z" } } as any,
    {
      sleep,
      do: async (name: string, config: any, fn: any) => {
        calls.push({ name, config });
        return fn();
      },
    } as any,
  );
  expect(sleep).toHaveBeenCalledOnce();
  expect(
    calls.find((call) => call.name === "dispatch-exploration").config.retries
      .limit,
  ).toBe(2);
  expect(send).toHaveBeenCalledOnce();
});
it("replays the same durable step path after a future deadline has passed", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-10-28T00:00:00Z"));
    const send = vi.fn().mockResolvedValue(undefined),
      cache = new Map<string, unknown>();
    let path: string[] = [];
    const workflow = new StudioAutonomyWorkflow(
      {} as any,
      { JOBS: { send } } as any,
    );
    const step = {
      do: async (name: string, configOrFn: any, fn?: any) => {
        path.push(name);
        if (!cache.has(name)) cache.set(name, await (fn || configOrFn)());
        return cache.get(name);
      },
      sleep: async (name: string) => {
        path.push(name);
      },
    };
    const event = {
      payload: { wakeupId: "replayed", dueAt: "2026-10-28T00:01:00Z" },
    } as any;
    await workflow.run(event, step as any);
    const first = [...path];
    path = [];
    vi.setSystemTime(new Date("2026-10-28T00:02:00Z"));
    await workflow.run(event, step as any);
    expect(path).toEqual(first);
    expect(first).toContain("wait-until-next-exploration");
    expect(send).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
