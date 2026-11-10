import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '@niticket/database';
import { fixtures } from '../helpers/fixtures';
import { createTicket, addMessage } from '@niticket/core/application/tickets';
import { processNotification } from '@niticket/core/application/jobs';
import { markMessagesSeen } from '@niticket/core/application/message-receipts';
import { readNotification } from '@niticket/core/application/administration';

let f: Awaited<ReturnType<typeof fixtures>>;
beforeAll(async () => {
  f = await fixtures();
});
afterAll(async () => {
  await db.$disconnect();
});

async function ticket() {
  return createTicket(
    await f.actor(f.student.id),
    {
      departmentId: f.department.id,
      subject: 'آزمون خوانده‌شدن اعلان پس از پاسخ',
      body: 'بررسی اعلان‌های تیکت بعد از پاسخ مسئول واحد',
    },
    randomUUID(),
  );
}

async function notice(ticketId: string, userId = f.agent.id, readAt: Date | null = null) {
  return db.notification.create({
    data: { eventId: randomUUID(), ticketId, userId, title: 'اعلان آزمایشی', readAt },
  });
}

async function creation(id: string) {
  return db.outboxEvent.findFirstOrThrow({
    where: { type: 'TICKET_NOTIFICATION', payload: { path: ['ticketId'], equals: id } },
  });
}

it('reads only the responding officer’s notifications for the replied ticket in the reply transaction', async () => {
  const a = await ticket(),
    b = await ticket();
  const old = new Date('2026-01-01T00:00:00Z');
  const [first, second, read, otherTicket, colleague, student] = await Promise.all([
    notice(a.id),
    notice(a.id),
    notice(a.id, f.agent.id, old),
    notice(b.id),
    notice(a.id, f.manager.id),
    notice(a.id, f.student.id),
  ]);
  await addMessage(await f.actor(f.agent.id), a.id, {
    version: 1,
    body: 'پاسخ مسئول به دانشجو',
    visibility: 'PUBLIC',
  });
  const rows = await db.notification.findMany({
    where: { id: { in: [first.id, second.id, read.id, otherTicket.id, colleague.id, student.id] } },
  });
  const state = (id: string) => rows.find((n) => n.id === id)!.readAt;
  expect(state(first.id)).not.toBeNull();
  expect(state(second.id)).not.toBeNull();
  expect(state(read.id)).toEqual(old);
  for (const id of [otherTicket.id, colleague.id, student.id]) expect(state(id)).toBeNull();
});

it('keeps notifications unread for a failed reply, an internal note, or a student reply', async () => {
  const a = await ticket(),
    notification = await notice(a.id);
  const staff = await f.actor(f.agent.id);
  await expect(
    addMessage(staff, a.id, { version: 99, body: 'پاسخ با نسخه نامعتبر', visibility: 'PUBLIC' }),
  ).rejects.toThrow();
  await expect(
    addMessage(await f.actor(f.outsider.id), a.id, {
      version: 1,
      body: 'پاسخ غیرمجاز',
      visibility: 'PUBLIC',
    }),
  ).rejects.toThrow();
  await addMessage(staff, a.id, { version: 1, body: 'یادداشت داخلی واحد', visibility: 'INTERNAL' });
  await addMessage(await f.actor(f.student.id), a.id, {
    version: 2,
    body: 'توضیح تکمیلی دانشجو',
    visibility: 'PUBLIC',
  });
  expect(
    (await db.notification.findUniqueOrThrow({ where: { id: notification.id } })).readAt,
  ).toBeNull();
});

it('does not resurrect unread notices when an older queued event is delivered after the reply', async () => {
  const a = await ticket(),
    event = await creation(a.id);
  await addMessage(await f.actor(f.agent.id), a.id, {
    version: 1,
    body: 'پاسخ قبل از پردازش اعلان',
    visibility: 'PUBLIC',
  });
  await processNotification(event.id, event.payload);
  const officer = await db.notification.findUniqueOrThrow({
    where: { eventId_userId: { eventId: event.id, userId: f.agent.id } },
  });
  const colleague = await db.notification.findUniqueOrThrow({
    where: { eventId_userId: { eventId: event.id, userId: f.manager.id } },
  });
  expect(officer.readAt).not.toBeNull();
  expect(colleague.readAt).toBeNull();
  await addMessage(await f.actor(f.student.id), a.id, {
    version: 2,
    body: 'پیام تازه پس از پاسخ مسئول',
    visibility: 'PUBLIC',
  });
  const newer = await db.outboxEvent.findFirstOrThrow({
    where: {
      type: 'TICKET_NOTIFICATION',
      AND: [
        { payload: { path: ['ticketId'], equals: a.id } },
        { payload: { path: ['actorId'], equals: f.student.id } },
        { payload: { path: ['type'], equals: 'PUBLIC_REPLY' } },
      ],
    },
  });
  await processNotification(newer.id, newer.payload);
  expect(
    (
      await db.notification.findUniqueOrThrow({
        where: { eventId_userId: { eventId: newer.id, userId: f.agent.id } },
      })
    ).readAt,
  ).toBeNull();
});

it('keeps queue delivery and a simultaneous officer reply consistent', async () => {
  for (let attempt = 0; attempt < 4; attempt++) {
    const a = await ticket(),
      event = await creation(a.id);
    await Promise.all([
      processNotification(event.id, event.payload),
      addMessage(await f.actor(f.agent.id), a.id, {
        version: 1,
        body: 'پاسخ هم‌زمان با پردازش اعلان',
        visibility: 'PUBLIC',
      }),
    ]);
    expect(
      (
        await db.notification.findUniqueOrThrow({
          where: { eventId_userId: { eventId: event.id, userId: f.agent.id } },
        })
      ).readAt,
    ).not.toBeNull();
  }
});

it('keeps officer alerts unread on actual views and rejects manual dismissal until a public reply', async () => {
  const a = await ticket(),
    event = await creation(a.id),
    staff = await f.actor(f.agent.id);
  await processNotification(event.id, event.payload);
  const incoming = await db.message.findFirstOrThrow({ where: { ticketId: a.id } });
  const notification = await db.notification.findUniqueOrThrow({
    where: { eventId_userId: { eventId: event.id, userId: f.agent.id } },
  });
  await markMessagesSeen(staff, a.id, { messageIds: [incoming.id] });
  expect(
    (await db.message.findUniqueOrThrow({ where: { id: incoming.id } })).readAt,
  ).not.toBeNull();
  await expect(readNotification(staff, { id: notification.id })).rejects.toMatchObject({
    code: 'REPLY_REQUIRED',
  });
  await expect(readNotification(staff, {})).rejects.toMatchObject({ code: 'REPLY_REQUIRED' });
  expect(
    (await db.notification.findUniqueOrThrow({ where: { id: notification.id } })).readAt,
  ).toBeNull();
  await addMessage(staff, a.id, { version: 1, body: 'پاسخ عمومی مسئول واحد' });
  expect(
    (await db.notification.findUniqueOrThrow({ where: { id: notification.id } })).readAt,
  ).not.toBeNull();
});

it('dismisses only the student alerts for visible public replies, without touching unseen or unrelated replies', async () => {
  const a = await ticket(),
    b = await ticket(),
    staff = await f.actor(f.agent.id),
    student = await f.actor(f.student.id);
  const first = await addMessage(staff, a.id, { version: 1, body: 'پاسخ اول قابل مشاهده' });
  const second = await addMessage(staff, a.id, { version: 2, body: 'پاسخ دوم خارج از دید' });
  const privateNote = await addMessage(staff, a.id, {
    version: 3,
    body: 'یادداشت خصوصی',
    visibility: 'INTERNAL',
  });
  const other = await addMessage(staff, b.id, { version: 1, body: 'پاسخ گفتگوی دیگر' });
  const events = await db.outboxEvent.findMany({
    where: {
      type: 'TICKET_NOTIFICATION',
      OR: [first, second, other].map((message) => ({
        payload: { path: ['messageId'], equals: message.id },
      })),
    },
  });
  for (const event of events) await processNotification(event.id, event.payload);
  const before = await db.ticket.findUniqueOrThrow({ where: { id: a.id } });
  expect(
    await markMessagesSeen(student, a.id, {
      messageIds: [first.id, privateNote.id, other.id],
    }),
  ).toEqual({ updated: 1, notificationsRead: 1 });
  const notices = await db.notification.findMany({
    where: { userId: f.student.id, messageId: { in: [first.id, second.id, other.id] } },
  });
  expect(notices).toHaveLength(3);
  expect(notices.find((n) => n.messageId === first.id)!.readAt).not.toBeNull();
  expect(notices.find((n) => n.messageId === second.id)!.readAt).toBeNull();
  expect(notices.find((n) => n.messageId === other.id)!.readAt).toBeNull();
  expect(await markMessagesSeen(student, a.id, { messageIds: [first.id] })).toEqual({
    updated: 0,
    notificationsRead: 0,
  });
  const after = await db.ticket.findUniqueOrThrow({ where: { id: a.id } });
  expect([after.version, after.updatedAt, after.lastActivityAt]).toEqual([
    before.version,
    before.updatedAt,
    before.lastActivityAt,
  ]);
});

it('delivers already-viewed replies as read even for legacy or concurrently processed events', async () => {
  const student = await f.actor(f.student.id),
    staff = await f.actor(f.agent.id);
  for (const mode of ['late', 'legacy', 'concurrent'] as const) {
    const a = await ticket();
    const reply = await addMessage(staff, a.id, { version: 1, body: `پاسخ با اعلان ${mode}` });
    const event = await db.outboxEvent.findFirstOrThrow({
      where: { type: 'TICKET_NOTIFICATION', payload: { path: ['messageId'], equals: reply.id } },
    });
    const payload =
      mode === 'legacy'
        ? { ticketId: a.id, actorId: f.agent.id, type: 'PUBLIC_REPLY' }
        : event.payload;
    const view = () => markMessagesSeen(student, a.id, { messageIds: [reply.id] });
    if (mode === 'concurrent') await Promise.all([processNotification(event.id, payload), view()]);
    else {
      await view();
      await processNotification(event.id, payload);
    }
    const notification = await db.notification.findUniqueOrThrow({
      where: { eventId_userId: { eventId: event.id, userId: f.student.id } },
    });
    expect(notification.messageId).toBe(reply.id);
    expect(notification.readAt).not.toBeNull();
  }
});
