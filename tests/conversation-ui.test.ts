import { describe, expect, it } from "vitest";
import {
  mergeConversationEvents,
  currentProposal,
  eventText,
} from "../src/client/conversation-state";
import type {
  ConversationEvent,
  ConversationProposal,
} from "../src/shared/conversation";
const event = (id: number, conversationId = "a"): ConversationEvent => ({
  id,
  conversationId,
  type: "assistant",
  content: `message ${id}`,
  data: {},
  createdAt: "2026-10-27",
});
describe("conversation replay", () => {
  it("deduplicates reconnect events in order and excludes another world", () => {
    expect(
      mergeConversationEvents(
        [event(2)],
        [event(3), event(2), event(1), event(4, "b")],
        "a",
      ).map((e) => e.id),
    ).toEqual([1, 2, 3]);
  });
  it("does not render private metadata as a message", () => {
    expect(
      eventText({
        ...event(1),
        content: "Saved",
        data: { prompt: "private", source: "original" },
      }),
    ).toBe("Saved");
  });
  it("only offers the pending proposal for the matching event", () => {
    const p = {
      id: "p",
      conversationId: "a",
      kind: "direction",
      revision: 2,
      status: "approved",
      content: {},
      hash: "x",
      createdAt: "now",
    } as ConversationProposal;
    expect(currentProposal({ proposalId: "p" }, [p])).toBeNull();
    expect(
      currentProposal({ proposalId: "p" }, [{ ...p, status: "pending" }])?.id,
    ).toBe("p");
  });
});
it("reads nested world and operation proposals without hiding their actual approval scope", async () => {
  const { proposalDetails } = await import("../src/client/conversation-state");
  expect(
    proposalDetails({
      kind: "world",
      content: { world: { elements: [{ id: "e" }] } },
    } as any).elements,
  ).toEqual([{ id: "e" }]);
  expect(
    proposalDetails({
      kind: "operation",
      content: { operation: { maxCalls: 42, scope: "Watch the coast" } },
    } as any).maxCalls,
  ).toBe(42);
});
it("refreshes latest proposal metadata even when the browser already has newer streamed events", async () => {
  const { mergeConversationSnapshot } =
    await import("../src/client/conversation-state");
  const old = {
    conversation: { id: "a", revision: 2 },
    events: [event(1005)],
    cursor: 1005,
    proposals: [],
  } as any;
  const fresh = {
    conversation: { id: "a", revision: 2 },
    events: [event(1000)],
    cursor: 1000,
    proposals: [{ id: "new" }],
  } as any;
  const merged = mergeConversationSnapshot(old, fresh);
  expect(merged.proposals).toEqual([{ id: "new" }]);
  expect(merged.cursor).toBe(1005);
  expect(merged.events).toHaveLength(2);
});
