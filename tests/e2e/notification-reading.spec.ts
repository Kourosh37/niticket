import { test, expect } from '@playwright/test';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';

try {
  loadEnvFile('.env');
} catch {
  /* CI supplies the environment. */
}
const database = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!);
if (!process.env.TEST_DATABASE_URL) database.pathname = '/niticket_test';
if (!database.pathname.endsWith('_test')) throw new Error('Test database required');
process.env.DATABASE_URL = database.toString();
const origin = 'http://localhost:3001';

test('keeps officer notifications until reply and clears student notifications only when the reply is visible', async ({
  browser,
}) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const { createTicket } = await import('@niticket/core/application/tickets');
  const { processNotification } = await import('@niticket/core/application/jobs');
  const f = await fixtures();
  const ticket = await createTicket(
    await f.actor(f.student.id),
    {
      departmentId: f.department.id,
      subject: 'آزمون اعلان و رسید مشاهده',
      body: 'پرسش دانشجو برای بررسی اعلان مسئول واحد',
    },
    randomUUID(),
  );
  const event = await db.outboxEvent.findFirstOrThrow({
    where: { type: 'TICKET_NOTIFICATION', payload: { path: ['ticketId'], equals: ticket.id } },
  });
  await processNotification(event.id, event.payload);
  const officer = await browser.newContext(),
    student = await browser.newContext();
  for (const [context, user] of [
    [officer, f.agent],
    [student, f.student],
  ] as const) {
    expect(
      (
        await context.request.post('/api/auth/sign-in/phone-number', {
          headers: { origin },
          data: { phoneNumber: user.phoneNumber, password: f.password },
        })
      ).status(),
    ).toBe(200);
  }
  const o = await officer.newPage(),
    s = await student.newPage();
  await o.goto('/notifications');
  await expect(o.getByRole('button', { name: 'خواندن همه', exact: true })).toHaveCount(0);
  await expect(o.getByRole('button', { name: 'خوانده شد', exact: true })).toHaveCount(0);
  await o.getByRole('link', { name: 'درخواست جدید ثبت شد', exact: true }).click();
  await o.bringToFront();
  await o.getByLabel('پاسخ شما', { exact: true }).click();
  const first = await db.message.findFirstOrThrow({ where: { ticketId: ticket.id } });
  await expect
    .poll(async () => !!(await db.message.findUniqueOrThrow({ where: { id: first.id } })).readAt)
    .toBe(true);
  await expect(o.locator('.dock-unread-count')).toHaveText('۱');
  expect(
    (
      await officer.request.patch('/api/v1/notifications', { headers: { origin }, data: {} })
    ).status(),
  ).toBe(403);
  await o.getByLabel('پاسخ شما', { exact: true }).fill('پاسخ مسئول برای مشاهده دانشجو');
  await o.getByRole('button', { name: 'ارسال پیام', exact: true }).click();
  await expect(o.getByText('پاسخ مسئول برای مشاهده دانشجو', { exact: true })).toBeVisible();
  await expect(o.locator('.dock-unread-count')).toHaveCount(0);
  const reply = await db.message.findFirstOrThrow({
    where: { ticketId: ticket.id, senderId: f.agent.id },
  });
  const replyEvent = await db.outboxEvent.findFirstOrThrow({
    where: { type: 'TICKET_NOTIFICATION', payload: { path: ['messageId'], equals: reply.id } },
  });
  await processNotification(replyEvent.id, replyEvent.payload);
  await s.goto('/');
  await s.bringToFront();
  await expect(s.locator('.dock-unread-count')).toHaveText('۱');
  await s.goto('/notifications');
  await s.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await s.getByRole('link', { name: 'پاسخ جدیدی برای درخواست ثبت شد', exact: true }).click();
  await expect(s.getByText('پاسخ مسئول برای مشاهده دانشجو', { exact: true })).toBeInViewport();
  expect(
    (
      await db.notification.findUniqueOrThrow({
        where: { eventId_userId: { eventId: replyEvent.id, userId: f.student.id } },
      })
    ).readAt,
  ).toBeNull();
  await s.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  await s.getByLabel('پاسخ شما', { exact: true }).click();
  await expect(s.locator('.dock-unread-count')).toHaveCount(0);
  await expect
    .poll(
      async () =>
        !!(
          await db.notification.findUniqueOrThrow({
            where: { eventId_userId: { eventId: replyEvent.id, userId: f.student.id } },
          })
        ).readAt,
    )
    .toBe(true);
  await officer.close();
  await student.close();
  await db.$disconnect();
});
