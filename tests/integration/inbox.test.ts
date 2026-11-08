import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '@niticket/database';
import {
  getTicket,
  listTickets,
  openConversation,
  addMessage,
  changeStatus,
} from '@niticket/core/application/tickets';
import { fixtures } from '../helpers/fixtures';
import { createUpload } from '@niticket/core/application/attachments';

let f: Awaited<ReturnType<typeof fixtures>>;
beforeAll(async () => {
  f = await fixtures();
});
afterAll(async () => {
  await db.$disconnect();
});

it('scopes new and answered inboxes to the current role and hides private previews', async () => {
  const statuses = ['OPEN', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED'] as const;
  const tickets = await Promise.all(
    statuses.map((status) =>
      db.ticket.create({
        data: {
          departmentId: f.department.id,
          creatorId: f.student.id,
          subject: `INBOX_${status}`,
          status,
          messages: {
            create: [
              {
                senderId: f.student.id,
                body: 'PUBLIC_PREVIEW',
                createdAt: new Date('2026-11-01T10:00:00Z'),
              },
              {
                senderId: f.agent.id,
                body: 'PRIVATE_PREVIEW',
                visibility: 'INTERNAL',
                createdAt: new Date('2026-11-01T10:01:00Z'),
              },
            ],
          },
        },
      }),
    ),
  );
  const student = await f.actor(f.student.id),
    staff = await f.actor(f.agent.id);
  const studentAction = await listTickets(student, { view: 'action', scope: 'mine' });
  expect(new Set(studentAction.items.map((t) => t.id))).toEqual(
    new Set([tickets[1].id, tickets[2].id, tickets[3].id]),
  );
  const staffAction = await listTickets(staff, { view: 'action', scope: 'department' });
  expect(staffAction.items.map((t) => t.id)).toEqual([tickets[0].id]);
  const done = await listTickets(student, { view: 'answered', scope: 'mine' });
  expect(new Set(done.items.map((t) => t.id))).toEqual(
    new Set([tickets[1].id, tickets[2].id, tickets[3].id]),
  );
  expect(JSON.stringify(studentAction)).not.toContain('PRIVATE_PREVIEW');
  expect((await listTickets(student, { scope: 'mine', q: 'PRIVATE_PREVIEW' })).items).toEqual([]);
  expect(studentAction.items[0].messages[0].body).toBe('PUBLIC_PREVIEW');
  expect(
    (await listTickets(await f.actor(f.outsider.id), { view: 'action', scope: 'department' }))
      .items,
  ).toEqual([]);
});

it('opens one persistent unit chat concurrently without a title, initial message or premature notification', async () => {
  const student = await f.actor(f.student.id);
  const chats = await Promise.all(
    Array.from({ length: 4 }, () => openConversation(student, { departmentId: f.destination.id })),
  );
  expect(new Set(chats.map((chat) => chat.id)).size).toBe(1);
  const id = chats[0].id;
  expect(await db.message.count({ where: { ticketId: id } })).toBe(0);
  expect(
    await db.outboxEvent.count({ where: { payload: { path: ['ticketId'], equals: id } } }),
  ).toBe(0);
  await expect(
    openConversation(await f.actor(f.agent.id), { departmentId: f.destination.id }),
  ).rejects.toThrow();
  await expect(
    openConversation(await f.actor(f.admin.id), { departmentId: f.destination.id }),
  ).rejects.toThrow();
  const actor = await f.actor(f.student.id);
  const clientId = randomUUID();
  const message = { version: 1, body: 'پیام صوتی', clientId };
  const first = await addMessage(actor, id, message);
  expect(await addMessage(actor, id, message)).toEqual(first);
  expect(await db.message.count({ where: { ticketId: id } })).toBe(1);
  await db.department.update({
    where: { id: f.destination.id },
    data: { acceptingTickets: false },
  });
  expect(await openConversation(student, { departmentId: f.destination.id })).toEqual({ id });
  await expect(
    openConversation(await f.actor(f.outsider.id), { departmentId: f.destination.id }),
  ).rejects.toThrow();
  const notification = await db.outboxEvent.findFirstOrThrow({
    where: { payload: { path: ['ticketId'], equals: id } },
  });
  expect(notification.payload).toMatchObject({ type: 'TICKET_CREATED' });
});

it('allows messages and uploads to continue in legacy closed conversations and never closes them again', async () => {
  const ticket = await db.ticket.create({
    data: {
      creatorId: f.student.id,
      departmentId: f.department.id,
      subject: 'گفتگوی قدیمی',
      status: 'CLOSED',
      closedAt: new Date(),
    },
  });
  const actor = await f.actor(f.student.id);
  expect((await getTicket(actor, ticket.id)).permissions.reply).toBe(true);
  const upload = await createUpload(actor, {
    ticketId: ticket.id,
    filename: 'continued.txt',
    mime: 'text/plain',
    size: 8,
  });
  expect(upload.id).toBeTruthy();
  await addMessage(actor, ticket.id, { version: 1, body: 'ادامه همین گفتگو' });
  const updated = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
  expect(updated.status).toBe('OPEN');
  expect(updated.closedAt).toBeNull();
  await expect(
    changeStatus(await f.actor(f.agent.id), ticket.id, { version: 2, status: 'RESOLVED' }),
  ).rejects.toThrow();
});

it('opens a long conversation at its latest messages and pages backward without overlap or private leaks', async () => {
  const ticket = await db.ticket.create({
    data: {
      departmentId: f.department.id,
      creatorId: f.student.id,
      subject: 'گفتگوی بلند آزمایشی',
    },
  });
  const start = Date.parse('2026-11-01T11:00:00Z');
  await db.message.createMany({
    data: Array.from({ length: 55 }, (_, index) => ({
      id: randomUUID(),
      ticketId: ticket.id,
      senderId: f.student.id,
      body: `MESSAGE_${index}`,
      createdAt: new Date(start + index * 1000),
    })),
  });
  await db.message.create({
    data: {
      ticketId: ticket.id,
      senderId: f.agent.id,
      body: 'PRIVATE_LAST_MESSAGE',
      visibility: 'INTERNAL',
      createdAt: new Date(start + 56000),
    },
  });
  const actor = await f.actor(f.student.id);
  const latest = await getTicket(actor, ticket.id);
  expect(latest.messages).toHaveLength(50);
  expect(latest.messages[0].body).toBe('MESSAGE_5');
  expect(latest.messages.at(-1)?.body).toBe('MESSAGE_54');
  expect(JSON.stringify(latest)).not.toContain('PRIVATE_LAST_MESSAGE');
  const previous = await getTicket(actor, ticket.id, latest.nextMessageCursor!);
  expect(previous.messages.map((m) => m.body)).toEqual([
    'MESSAGE_0',
    'MESSAGE_1',
    'MESSAGE_2',
    'MESSAGE_3',
    'MESSAGE_4',
  ]);
  expect(previous.nextMessageCursor).toBeNull();
});
