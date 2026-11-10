import { test, expect } from '@playwright/test';
import { loadEnvFile } from 'node:process';

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

test('opens a unit history from administration and reads its conversations and private activity notes', async ({
  page,
}) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const { createTicket, addActivityNote } = await import('@niticket/core/application/tickets');
  const f = await fixtures();
  const ticket = await createTicket(
    await f.actor(f.student.id),
    {
      departmentId: f.department.id,
      subject: 'درخواست آزمون تاریخچه مدیر',
      body: 'متن قابل مشاهده در تاریخچه واحد',
    },
    crypto.randomUUID(),
  );
  const activity = await db.activity.findFirstOrThrow({ where: { ticketId: ticket.id } });
  await addActivityNote(await f.actor(f.agent.id), ticket.id, activity.id, {
    body: 'یادداشت خصوصی قابل مشاهده برای مدیر',
  });
  await db.activity.createMany({
    data: Array.from({ length: 105 }, (_, index) => ({
      ticketId: ticket.id,
      actorId: f.agent.id,
      type: 'INTERNAL_NOTE',
      visibility: 'INTERNAL',
      metadata: {},
      createdAt: new Date(Date.now() + index),
    })),
  });
  const login = await page.request.post('/api/auth/sign-in/phone-number', {
    headers: { origin },
    data: { phoneNumber: f.admin.phoneNumber, password: f.password },
  });
  expect(login.status()).toBe(200);
  const { reports } = await import('@niticket/core/application/administration');
  await page.goto('/');
  const pending = (await reports(await f.actor(f.admin.id))).pendingReplies;
  await expect(
    page.locator('.stat-card').filter({ hasText: 'در حال پیگیری' }).locator('strong'),
  ).toHaveText(new Intl.NumberFormat('fa-IR').format(pending));
  await page.goto(`/admin/departments?q=${encodeURIComponent(f.department.name)}`);
  await page.getByRole('link', { name: 'تاریخچه واحد', exact: true }).click();
  await expect(page.getByRole('heading', { name: `تاریخچه ${f.department.name}` })).toBeVisible();
  await page.locator('.ticket-row').filter({ hasText: 'درخواست آزمون تاریخچه مدیر' }).click();
  await expect(page).toHaveURL(`${origin}/tickets/${ticket.id}?history=1`);
  await expect(page.getByLabel('پاسخ شما', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'اطلاعات گفتگو' })).toBeVisible();
  await expect(page.locator('.history-event')).toHaveCount(50);
  await page.clock.install();
  await expect(page.getByText('یادداشت خصوصی قابل مشاهده برای مدیر', { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'رویدادهای قبلی', exact: true }).click();
  await expect(page.locator('.history-event')).toHaveCount(100);
  await page.clock.fastForward(15000);
  await page.getByRole('button', { name: 'رویدادهای قبلی', exact: true }).click();
  await expect(page.locator('.history-event')).toHaveCount(106);
  await expect(
    page.getByText('یادداشت خصوصی قابل مشاهده برای مدیر', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'بستن', exact: true }).click();
  await expect(page.getByText('متن قابل مشاهده در تاریخچه واحد', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'اطلاعات گفتگو', exact: true }).click();
  await page.getByText('تاریخچه و یادداشت‌های واحد', { exact: true }).click();
  await expect(
    page.getByText('یادداشت خصوصی قابل مشاهده برای مدیر', { exact: true }),
  ).toBeVisible();
  await page.request.post('/api/auth/sign-out', { headers: { origin }, data: {} });
  expect(
    (
      await page.request.post('/api/auth/sign-in/phone-number', {
        headers: { origin },
        data: { phoneNumber: f.student.phoneNumber, password: f.password },
      })
    ).status(),
  ).toBe(200);
  await page.goto(`/tickets/${ticket.id}?history=1`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('یادداشت خصوصی قابل مشاهده برای مدیر', { exact: true })).toHaveCount(
    0,
  );
  const studentHistory = await (
    await page.request.get(`/api/v1/tickets/${ticket.id}/history`)
  ).json();
  expect(JSON.stringify(studentHistory)).not.toContain('یادداشت خصوصی قابل مشاهده برای مدیر');
  await db.$disconnect();
});
