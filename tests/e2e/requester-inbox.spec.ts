import { test, expect } from '@playwright/test';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';

try {
  loadEnvFile('.env');
} catch {
  /* CI injects environment. */
}
const database = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!);
if (!process.env.TEST_DATABASE_URL) database.pathname = '/niticket_test';
if (!database.pathname.endsWith('_test')) throw new Error('Test database required');
process.env.DATABASE_URL = database.toString();
const origin = 'http://localhost:3001';

test('categorizes requester chats and dismisses only replies actually seen in the viewport', async ({
  page,
}) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const f = await fixtures();
  const create = (subject: string) =>
    db.ticket.create({ data: { creatorId: f.student.id, departmentId: f.department.id, subject } });
  const [unread, answered, waiting] = await Promise.all([
    create('خوانده نشده'),
    create('پاسخ خوانده شده'),
    create('منتظر پاسخ'),
  ]);
  const ids = Array.from({ length: 62 }, () => randomUUID());
  const start = Date.now() - 120000;
  await db.message.createMany({
    data: ids.map((id, index) => ({
      id,
      ticketId: unread.id,
      senderId: index === 0 || index === 61 ? f.agent.id : f.student.id,
      body: `پیام صندوق ${index}`,
      createdAt: new Date(start + index * 1000),
    })),
  });
  await db.notification.createMany({
    data: [0, 61].map((index) => ({
      eventId: randomUUID(),
      userId: f.student.id,
      ticketId: unread.id,
      messageId: ids[index],
      title: 'پاسخ جدید',
    })),
  });
  await db.message.create({
    data: {
      ticketId: answered.id,
      senderId: f.agent.id,
      body: 'پاسخ قبلاً دیده شده',
      readAt: new Date(),
    },
  });
  await db.message.create({
    data: { ticketId: waiting.id, senderId: f.student.id, body: 'پرسش منتظر پاسخ' },
  });
  expect(
    (
      await page.request.post('/api/auth/sign-in/phone-number', {
        headers: { origin },
        data: { phoneNumber: f.student.phoneNumber, password: f.password },
      })
    ).ok(),
  ).toBe(true);
  await page.goto('/');
  await page.bringToFront();
  await expect(page.locator('.inbox-thread')).toHaveCount(3);
  await expect(page.getByRole('link', { name: 'همه گفتگوها', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'پاسخ داده‌شده', exact: true }).click();
  await expect(page.locator('.inbox-thread')).toHaveCount(1);
  await expect(page.locator('.thread-state')).toHaveText('پاسخ داده‌شده');
  await page.getByRole('link', { name: 'پاسخ‌های جدید', exact: true }).click();
  await expect(page.locator('.inbox-thread')).toHaveCount(1);
  const otherInbox = await page.context().newPage();
  await otherInbox.goto('/?view=action');
  await expect(otherInbox.locator('.inbox-thread')).toHaveCount(1);
  await page.bringToFront();
  await page.locator('.inbox-thread').click();
  await expect(page.getByText('پیام صندوق 61', { exact: true })).toBeInViewport();
  await page.getByLabel('پاسخ شما', { exact: true }).click();
  await expect
    .poll(async () => !!(await db.message.findUniqueOrThrow({ where: { id: ids[61] } })).readAt)
    .toBe(true);
  expect((await db.message.findUniqueOrThrow({ where: { id: ids[0] } })).readAt).toBeNull();
  await expect(page.locator('.dock-unread-count')).toHaveText('۱');
  const scroller = page.getByLabel('پیام‌های گفتگو', { exact: true });
  await scroller.hover();
  await page.mouse.wheel(0, -100000);
  await page.getByRole('button', { name: 'پیام‌های قبلی', exact: true }).click();
  await expect(page.getByRole('button', { name: 'پیام‌های قبلی', exact: true })).toHaveCount(0);
  await scroller.focus();
  await scroller.press('Control+Home');
  await expect(page.getByText('پیام صندوق 0', { exact: true })).toBeInViewport();
  await expect(page.locator('.dock-unread-count')).toHaveCount(0);
  await otherInbox.bringToFront();
  await expect(otherInbox.locator('.inbox-thread')).toHaveCount(0);
  await otherInbox.close();
  await page.bringToFront();
  await page.getByRole('link', { name: 'بازگشت به گفتگوها', exact: true }).click();
  await page.getByRole('link', { name: 'پاسخ‌های جدید', exact: true }).click();
  await expect(page.locator('.inbox-thread')).toHaveCount(0);
  await page.getByRole('link', { name: 'پاسخ داده‌شده', exact: true }).click();
  await expect(page.locator('.inbox-thread')).toHaveCount(2);
  await db.$disconnect();
});
