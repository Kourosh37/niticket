import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '@niticket/database';
import { getTicket, listTickets } from '@niticket/core/application/tickets';
import { fixtures } from '../helpers/fixtures';

let f: Awaited<ReturnType<typeof fixtures>>;
beforeAll(async () => {
  f = await fixtures();
});
afterAll(async () => {
  await db.$disconnect();
});

it('scopes the simple action and finished inboxes to the current role and hides private previews', async () => {
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
  expect(studentAction.items.map((t) => t.id)).toEqual([tickets[1].id]);
  const staffAction = await listTickets(staff, { view: 'action', scope: 'department' });
  expect(staffAction.items.map((t) => t.id)).toEqual([tickets[0].id]);
  const done = await listTickets(student, { view: 'done', scope: 'mine' });
  expect(new Set(done.items.map((t) => t.id))).toEqual(new Set([tickets[2].id, tickets[3].id]));
  expect(JSON.stringify(studentAction)).not.toContain('PRIVATE_PREVIEW');
  expect(studentAction.items[0].messages[0].body).toBe('PUBLIC_PREVIEW');
  expect(
    (await listTickets(await f.actor(f.outsider.id), { view: 'action', scope: 'department' }))
      .items,
  ).toEqual([]);
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
