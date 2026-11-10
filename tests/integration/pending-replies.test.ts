import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '@niticket/database';
import { fixtures } from '../helpers/fixtures';
import { reports } from '@niticket/core/application/administration';
import { addMessage, createTicket, openConversation } from '@niticket/core/application/tickets';
import { markMessagesSeen } from '@niticket/core/application/message-receipts';

afterAll(() => db.$disconnect());

it('counts only conversations whose latest public message needs an officer reply, including legacy states', async () => {
  const f = await fixtures();
  const student = await f.actor(f.student.id),
    officer = await f.actor(f.agent.id),
    admin = await f.actor(f.admin.id);
  const count = async () =>
    (await reports(admin, { departmentId: f.department.id })).pendingReplies;
  await openConversation(student, { departmentId: f.department.id });
  expect(await count()).toBe(0);
  const ticket = await createTicket(
    student,
    {
      departmentId: f.department.id,
      subject: 'درخواست منتظر پاسخ مسئول',
      body: 'اولین پیام عمومی برای بررسی شمارنده مدیر',
    },
    randomUUID(),
  );
  expect(await count()).toBe(1);
  const first = await db.message.findFirstOrThrow({ where: { ticketId: ticket.id } });
  await markMessagesSeen(officer, ticket.id, { messageIds: [first.id] });
  await addMessage(officer, ticket.id, {
    version: 1,
    body: 'یادداشت خصوصی مسئول',
    visibility: 'INTERNAL',
  });
  expect(await count()).toBe(1);
  await addMessage(officer, ticket.id, { version: 2, body: 'پاسخ عمومی به دانشجو' });
  expect(await count()).toBe(0);
  // Historical status edits must not turn an answered conversation into pending work.
  await db.ticket.update({ where: { id: ticket.id }, data: { status: 'IN_PROGRESS' } });
  expect(await count()).toBe(0);
  await addMessage(student, ticket.id, { version: 3, body: 'پرسش تکمیلی دانشجو پس از پاسخ' });
  await addMessage(officer, ticket.id, {
    version: 4,
    body: 'یادداشت خصوصی بعد از پرسش',
    visibility: 'INTERNAL',
  });
  await db.ticket.update({ where: { id: ticket.id }, data: { status: 'CLOSED' } });
  expect(await count()).toBe(1);
  expect((await reports(student)).pendingReplies).toBe(1);
  expect((await reports(await f.actor(f.outsider.id))).pendingReplies).toBe(0);
  expect((await reports(admin, { departmentId: f.destination.id })).pendingReplies).toBe(0);
  expect(
    (await reports(admin, { departmentId: f.department.id, to: '2000-01-01T00:00:00Z' }))
      .pendingReplies,
  ).toBe(0);
});
