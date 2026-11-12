import { z } from 'zod';
import { db, type Prisma } from '@niticket/database';
import type { Actor } from '../domain/authorization';
import {
  assertParticipant,
  assertRead,
  canReadInternal,
  isStaff,
  userRole,
} from '../domain/authorization';
import { fail } from '../domain/errors';
import { uuid } from '../validation';
import { transaction } from '../infrastructure/transaction';
import { refreshActor } from './context';
import { ticketChanged } from './realtime-events';
import { enqueueRealtime } from '../infrastructure/realtime';

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
    const publicChange =
      !isStaff(actor, ticket) ||
      !!(await tx.message.findFirst({
        where: {
          ticketId,
          id: { in: data.messageIds },
          visibility: 'PUBLIC',
          senderId: ticket.creatorId,
          readAt: null,
        },
        select: { id: true },
      }));
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
    // Only the student's visible public replies dismiss notifications. Viewing a
    // student's message still records a receipt but never dismisses a staff task.
    const notifications =
      userRole(actor) === 'STUDENT'
        ? await tx.notification.updateMany({
            where: {
              userId: actor.id,
              ticketId,
              readAt: null,
              messageId: { in: [...new Set(data.messageIds)] },
              message: {
                ticketId,
                visibility: 'PUBLIC',
                senderId: { not: actor.id },
                readAt: { not: null },
              },
            },
            data: { readAt: new Date() },
          })
        : { count: 0 };
    // Receipt-only changes do not advance the ticket revision or activity time.
    if (result.count) await ticketChanged(tx, ticketId, ['receipts'], !publicChange);
    if (result.count || notifications.count)
      await enqueueRealtime(tx, {
        scope: 'user',
        userId: actor.id,
        topics: ['inbox', 'notifications'],
      });
    return { updated: result.count, notificationsRead: notifications.count };
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
