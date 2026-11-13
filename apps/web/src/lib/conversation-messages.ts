import type { getTicket } from '@niticket/core/application/tickets';

export type ConversationMessage = Awaited<ReturnType<typeof getTicket>>['messages'][number];

type ChatMessage = ConversationMessage;

export function mergeConversationMessages(previous: ChatMessage[], incoming: ChatMessage[]) {
  let changed = false;
  const byId = new Map(previous.map((message) => [message.id, message]));
  for (const message of incoming) {
    const previous = byId.get(message.id);
    if (
      !previous ||
      previous.body !== message.body ||
      previous.visibility !== message.visibility ||
      String(previous.readAt) !== String(message.readAt) ||
      previous.sender.name !== message.sender.name ||
      previous.sender.image !== message.sender.image ||
      JSON.stringify(previous.attachments) !== JSON.stringify(message.attachments)
    ) {
      byId.set(message.id, message);
      changed = true;
    }
  }
  if (!changed) return previous;
  return [...byId.values()].sort(
    (a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id.localeCompare(b.id),
  );
}
