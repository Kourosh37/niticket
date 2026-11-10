import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '@niticket/database';
import { fixtures } from '../helpers/fixtures';
import { getTicket } from '@niticket/core/application/tickets';
import { getMessageReceipts, markMessagesSeen } from '@niticket/core/application/message-receipts';

afterAll(() => db.$disconnect());

it('marks only eligible counterparty messages, preserves the first view and leaves conversation activity unchanged', async () => {
  const f = await fixtures();
  const ticket = await db.ticket.create({
    data: { creatorId: f.student.id, departmentId: f.department.id, subject: 'Receipts' },
  });
  const ids = Array.from({ length: 4 }, () => randomUUID());
  await db.message.createMany({
    data: [
      { id: ids[0], ticketId: ticket.id, senderId: f.student.id, body: 'student' },
      { id: ids[1], ticketId: ticket.id, senderId: f.agent.id, body: 'reply' },
      {
        id: ids[2],
        ticketId: ticket.id,
        senderId: f.agent.id,
        body: 'private',
        visibility: 'INTERNAL',
      },
      { id: ids[3], ticketId: ticket.id, senderId: f.manager.id, body: 'manager reply' },
    ],
  });
  const student = await f.actor(f.student.id),
    agent = await f.actor(f.agent.id),
    manager = await f.actor(f.manager.id);
  await getTicket(student, ticket.id, undefined, undefined, false);
  expect(await db.message.count({ where: { ticketId: ticket.id, readAt: { not: null } } })).toBe(0);
  expect(
    await markMessagesSeen(agent, ticket.id, { messageIds: [ids[0], ids[1], ids[3]] }),
  ).toEqual({ updated: 1, notificationsRead: 0 });
  const first = (await db.message.findUniqueOrThrow({ where: { id: ids[0] } })).readAt;
  expect(first).not.toBeNull();
  expect(await markMessagesSeen(agent, ticket.id, { messageIds: [ids[0]] })).toEqual({
    updated: 0,
    notificationsRead: 0,
  });
  expect((await db.message.findUniqueOrThrow({ where: { id: ids[0] } })).readAt).toEqual(first);
  expect((await getMessageReceipts(student, ticket.id, ids)).items).toEqual([
    { id: ids[0], readAt: first!.toISOString() },
  ]);
  expect(
    await markMessagesSeen(student, ticket.id, { messageIds: [ids[0], ids[1], ids[2], ids[3]] }),
  ).toEqual({ updated: 2, notificationsRead: 0 });
  expect((await db.message.findUniqueOrThrow({ where: { id: ids[2] } })).readAt).toBeNull();
  expect(await markMessagesSeen(manager, ticket.id, { messageIds: [ids[2]] })).toEqual({
    updated: 1,
    notificationsRead: 0,
  });
  const after = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
  expect([after.version, after.updatedAt, after.lastActivityAt]).toEqual([
    ticket.version,
    ticket.updatedAt,
    ticket.lastActivityAt,
  ]);
});

it('rejects administrators, outsiders, revoked members, forged fields and oversized batches', async () => {
  const f = await fixtures();
  const ticket = await db.ticket.create({
    data: { creatorId: f.student.id, departmentId: f.department.id, subject: 'Private receipts' },
  });
  const message = await db.message.create({
    data: { ticketId: ticket.id, senderId: f.student.id, body: 'incoming' },
  });
  const payload = { messageIds: [message.id] };
  await expect(
    markMessagesSeen(await f.actor(f.admin.id), ticket.id, payload),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    markMessagesSeen(await f.actor(f.outsider.id), ticket.id, payload),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    getMessageReceipts(await f.actor(f.outsider.id), ticket.id, [message.id]),
  ).rejects.toMatchObject({ status: 404 });
  const revoked = await f.actor(f.agent.id);
  await db.departmentMembership.updateMany({
    where: { userId: f.agent.id },
    data: { active: false },
  });
  await expect(markMessagesSeen(revoked, ticket.id, payload)).rejects.toMatchObject({
    status: 404,
  });
  const student = await f.actor(f.student.id);
  await expect(
    markMessagesSeen(student, ticket.id, { ...payload, readAt: new Date().toISOString() }),
  ).rejects.toThrow();
  await expect(
    markMessagesSeen(student, ticket.id, {
      messageIds: Array.from({ length: 51 }, () => message.id),
    }),
  ).rejects.toThrow();
  expect((await db.message.findUniqueOrThrow({ where: { id: message.id } })).readAt).toBeNull();
});
