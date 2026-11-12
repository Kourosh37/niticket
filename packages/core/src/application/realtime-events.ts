import type { Prisma, Attachment } from '@prisma/client';
import type { RealtimeTopic } from '../domain/realtime';
import { enqueueRealtime } from '../infrastructure/realtime';

export async function ticketChanged(
  tx: Prisma.TransactionClient,
  ticketId: string,
  topics: RealtimeTopic[] = ['conversation', 'inbox'],
  internal = false,
) {
  const ticket = await tx.ticket.findUnique({
    where: { id: ticketId },
    select: { creatorId: true, departmentId: true },
  });
  if (ticket) await enqueueRealtime(tx, { scope: 'ticket', ticketId, ...ticket, internal, topics });
}

export async function attachmentChanged(
  tx: Prisma.TransactionClient,
  file: Pick<
    Attachment,
    'uploaderId' | 'ticketId' | 'messageId' | 'noteId' | 'savedReplyId' | 'avatarOwnerId'
  >,
) {
  await enqueueRealtime(tx, { scope: 'user', userId: file.uploaderId, topics: ['attachments'] });
  if (file.ticketId) {
    const message = file.messageId
      ? await tx.message.findUnique({ where: { id: file.messageId }, select: { visibility: true } })
      : null;
    await ticketChanged(
      tx,
      file.ticketId,
      ['conversation', 'attachments'],
      !!file.noteId || message?.visibility === 'INTERNAL',
    );
  }
  if (file.savedReplyId) {
    const reply = await tx.savedReply.findUnique({
      where: { id: file.savedReplyId },
      select: { departmentId: true },
    });
    if (reply)
      await enqueueRealtime(tx, {
        scope: 'department',
        departmentId: reply.departmentId,
        topics: ['saved-replies', 'attachments'],
      });
  }
  if (file.avatarOwnerId) await enqueueRealtime(tx, { scope: 'everyone', topics: ['access'] });
}
