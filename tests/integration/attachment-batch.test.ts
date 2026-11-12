import { afterAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '@niticket/database';
import { fixtures } from '../helpers/fixtures';
import { uploadStatuses } from '@niticket/core/application/attachments';

afterAll(() => db.$disconnect());

it('reads a batch once and shares fresh ticket/message lookups only within that request', async () => {
  const f = await fixtures(),
    actor = await f.actor(f.student.id);
  const ticket = await db.ticket.create({
    data: { creatorId: actor.id, departmentId: f.department.id, subject: 'batch authorization' },
  });
  const message = await db.message.create({
    data: { ticketId: ticket.id, senderId: actor.id, body: 'files' },
  });
  const ids = Array.from({ length: 5 }, () => randomUUID());
  await db.attachment.createMany({
    data: ids.map((id) => ({
      id,
      ticketId: ticket.id,
      messageId: message.id,
      uploaderId: actor.id,
      filename: `${id}.txt`,
      objectKey: id,
      declaredMime: 'text/plain',
      expectedSize: 10,
      expiresAt: new Date(Date.now() + 60000),
    })),
  });
  const ticketRead = vi.spyOn(db.ticket, 'findUnique'),
    messageRead = vi.spyOn(db.message, 'findUnique');
  const singleFile = vi.spyOn(db.attachment, 'findUnique');
  try {
    expect(await uploadStatuses(actor, [...ids, ids[0], randomUUID()])).toHaveLength(5);
    expect(ticketRead).toHaveBeenCalledTimes(1);
    expect(messageRead).toHaveBeenCalledTimes(1);
    expect(singleFile).not.toHaveBeenCalled();
    await db.message.update({ where: { id: message.id }, data: { visibility: 'INTERNAL' } });
    expect(await uploadStatuses(actor, ids)).toEqual([]);
    expect(ticketRead).toHaveBeenCalledTimes(2);
    expect(messageRead).toHaveBeenCalledTimes(2);
  } finally {
    vi.restoreAllMocks();
  }
});
