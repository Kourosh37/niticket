import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '@niticket/database';
import { fixtures } from '../helpers/fixtures';
import { createTicket, addMessage } from '@niticket/core/application/tickets';
import { processNotification } from '@niticket/core/application/jobs';

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
