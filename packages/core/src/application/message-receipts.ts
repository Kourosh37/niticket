import { z } from 'zod';
import { db, type Prisma } from '@niticket/database';
import type { Actor } from '../domain/authorization';
import { assertParticipant, assertRead, canReadInternal, isStaff } from '../domain/authorization';
import { fail } from '../domain/errors';
import { uuid } from '../validation';
import { transaction } from '../infrastructure/transaction';
import { refreshActor } from './context';

const messageIds = z.array(uuid).min(1).max(50);

export async function markMessagesSeen(actor: Actor, ticketId: string, input: unknown) {
  uuid.parse(ticketId);
  const data = z.object({ messageIds }).strict().parse(input);
  return transaction(async (tx) => {
    actor = await refreshActor(tx, actor);
    const ticket = await tx.ticket.findUnique({
      where: { id: ticketId },
      select: { creatorId: true, departmentId: true },
    });
    if (!ticket) fail();
    assertParticipant(actor, ticket);
    const eligible: Prisma.MessageWhereInput = isStaff(actor, ticket)
      ? {
          OR: [
            { visibility: 'PUBLIC', senderId: ticket.creatorId },
            { visibility: 'INTERNAL', senderId: { not: actor.id } },
          ],
        }
      : { visibility: 'PUBLIC', senderId: { not: actor.id } };
    const result = await tx.message.updateMany({
      where: {
        AND: [
          {
            ticketId,
            id: { in: [...new Set(data.messageIds)] },
            readAt: null,
            senderId: { not: actor.id },
          },
          eligible,
        ],
      },
      data: { readAt: new Date() },
    });
    // No ticket version, activity time, notification or audit write for receipt-only changes.
    return { updated: result.count };
  });
}

export async function getMessageReceipts(actor: Actor, ticketId: string, input: unknown) {
  uuid.parse(ticketId);
  const ids = messageIds.parse(input);
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: { creatorId: true, departmentId: true },
  });
  if (!ticket) fail();
  assertRead(actor, ticket);
  const items = await db.message.findMany({
    where: {
      ticketId,
      id: { in: [...new Set(ids)] },
      senderId: actor.id,
      ...(!canReadInternal(actor, ticket) ? { visibility: 'PUBLIC' as const } : {}),
    },
    take: 50,
    select: { id: true, readAt: true },
  });
  return {
    items: items.map((item) => ({ id: item.id, readAt: item.readAt?.toISOString() ?? null })),
  };
}
