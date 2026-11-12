import { test, expect, type Page } from '@playwright/test';
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

async function login(page: Page, phoneNumber: string, password: string) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'ورود با رمز', exact: true }).click();
  await page.getByLabel('شماره موبایل', { exact: true }).fill(phoneNumber);
  await page.getByLabel('رمز عبور', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'ورود', exact: true }).click();
  await expect(page).toHaveURL(origin + '/');
}

test('keeps requester and officer navigation at the bottom and shares private unread counts with settings', async ({
  page,
}) => {
  test.setTimeout(90000);
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const f = await fixtures();
  const ticket = await db.ticket.create({
    data: {
      creatorId: f.student.id,
      departmentId: f.department.id,
      subject: 'ناوبری ساده',
      messages: { create: { senderId: f.student.id, body: 'پیام آزمایش ناوبری' } },
    },
  });
  await db.notification.createMany({
    data: [
      ...Array.from({ length: 3 }, () => ({
        userId: f.student.id,
        ticketId: ticket.id,
        title: 'اعلان تازه دانشجو',
        eventId: randomUUID(),
      })),
      ...Array.from({ length: 2 }, () => ({
        userId: f.agent.id,
        ticketId: ticket.id,
        title: 'اعلان تازه مسئول',
        eventId: randomUUID(),
      })),
      ...Array.from({ length: 7 }, () => ({
        userId: f.outsider.id,
        title: 'اعلان کاربر دیگر',
        eventId: randomUUID(),
      })),
    ],
  });
  await login(page, f.student.phoneNumber!, f.password);
  const dock = page.getByRole('navigation', { name: 'ناوبری اصلی', exact: true });
  const badge = dock.locator('.dock-unread-count');
  await expect(page.locator('header')).toHaveCount(0);
  await expect(dock.getByRole('link')).toHaveCount(3);
  await expect(badge).toHaveText('۳');
  await expect(
    page.getByRole('link', { name: '۳ اعلان جدید دارید مشاهده', exact: true }),
  ).toBeVisible();
  await dock.getByRole('link', { name: 'تنظیمات', exact: true }).click();
  await expect(page).toHaveURL(origin + '/settings');
  await expect(page.getByRole('heading', { name: 'تنظیمات', exact: true })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'حالت تاریک' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'اطلاعات حساب', exact: true })).toBeVisible();
  await expect(page.getByLabel('شماره موبایل', { exact: true })).toHaveValue(
    f.student.phoneNumber!.replace('+98', '0'),
  );
  await expect(page.getByRole('heading', { name: 'نشست‌های فعال', exact: true })).toBeVisible();
  await expect(page.locator('header')).toHaveCount(0);
  await expect(page.locator('.settings-preferences .dock-unread-count')).toHaveText('۳');
  await page
    .locator('.settings-preferences')
    .getByRole('link', { name: /اعلان‌ها/ })
    .click();
  await page.getByRole('button', { name: 'خواندن همه', exact: true }).click();
  await expect(badge).toHaveCount(0);
  expect(await db.notification.count({ where: { userId: f.outsider.id, readAt: null } })).toBe(7);
  await page.goto(`/tickets/${ticket.id}`);
  await expect(page.locator('.messenger-header')).toBeInViewport();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByLabel('پاسخ شما', { exact: true })).toBeInViewport();
    if (width < 768) await expect(dock).toBeHidden();
    else await expect(dock).toBeInViewport();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth &&
          document.documentElement.scrollHeight <= innerHeight + 1,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText('پیام آزمایش ناوبری', { exact: true })).toBeVisible();
  await page.screenshot({ path: '.local/ui-preview/simple-chat-navigation-390.png' });
  await page.getByRole('button', { name: 'گزینه‌های گفتگو', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'گزینه‌های گفتگو', exact: true })
    .getByRole('link', { name: 'تنظیمات', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'تنظیمات', exact: true })).toBeVisible();
  await expect(page.locator('.settings-preferences')).toBeVisible();
  await page.screenshot({ path: '.local/ui-preview/simple-settings-390.png', fullPage: true });
  await page.request.post('/api/auth/sign-out', { headers: { origin }, data: {} });
  await login(page, f.agent.phoneNumber!, f.password);
  await expect(dock.getByRole('link')).toHaveCount(2);
  await expect(badge).toHaveText('۲');
  await expect(page.locator('header')).toHaveCount(0);
  const { transaction } = await import('@niticket/core/infrastructure/transaction');
  const { enqueueRealtime } = await import('@niticket/core/infrastructure/realtime');
  await transaction(async (tx) => {
    await tx.notification.createMany({
      data: Array.from({ length: 100 }, () => ({
        userId: f.agent.id,
        eventId: randomUUID(),
        title: 'اعلان جدید',
      })),
    });
    await enqueueRealtime(tx, { scope: 'user', userId: f.agent.id, topics: ['notifications'] });
  });
  await page.evaluate(() => window.dispatchEvent(new Event('notifications:changed')));
  await expect(badge).toHaveText('۹۹+');
  await expect(dock.getByRole('status')).toHaveText('۱۰۲ اعلان خوانده‌نشده');
  await page.screenshot({ path: '.local/ui-preview/simple-officer-navigation-390.png' });
  await db.$disconnect();
});
