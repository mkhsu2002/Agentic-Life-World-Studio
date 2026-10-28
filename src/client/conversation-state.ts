import type {
  ConversationEvent,
  ConversationProposal,
  ConversationSnapshot,
} from "../shared/conversation";
export function mergeConversationEvents(
  previous: ConversationEvent[],
  incoming: ConversationEvent[],
  conversationId: string,
): ConversationEvent[] {
  return [
    ...new Map(
      [...previous, ...incoming]
        .filter((e) => e.conversationId === conversationId)
        .map((e) => [e.id, e]),
    ).values(),
  ].sort((a, b) => a.id - b.id);
}
export function currentProposal(
  data: Record<string, unknown>,
  proposals: ConversationProposal[],
) {
  return (
    proposals.find((p) => p.id === data.proposalId && p.status === "pending") ||
    null
  );
}
export const eventText = (event: ConversationEvent) => event.content;

export function mergeConversationSnapshot(
  previous: ConversationSnapshot | null,
  incoming: ConversationSnapshot,
): ConversationSnapshot {
  if (!previous || previous.conversation.id !== incoming.conversation.id)
    return incoming;
  const fresh =
    incoming.conversation.revision >= previous.conversation.revision
      ? incoming
      : previous;
  return {
    ...fresh,
    cursor: Math.max(previous.cursor, incoming.cursor),
    events: mergeConversationEvents(
      previous.events,
      incoming.events,
      incoming.conversation.id,
    ),
  };
}

export const proposalCommand = (proposal: ConversationProposal) =>
  `採用提案 ${proposal.id}`;
export const visualChoiceCommand = (
  proposal: ConversationProposal,
  index: number,
) => `採用第${index + 1}張視覺 ${proposal.id}`;
export const retryCommand = "重試上一項工作";
export function proposalDetails(
  proposal: ConversationProposal,
): Record<string, unknown> {
  const nested =
    proposal.content[
      proposal.kind === "direction"
        ? "direction"
        : proposal.kind === "world"
          ? "world"
          : proposal.kind === "operation"
            ? "operation"
            : ""
    ];
  return nested && typeof nested === "object"
    ? (nested as Record<string, unknown>)
    : proposal.content;
}
