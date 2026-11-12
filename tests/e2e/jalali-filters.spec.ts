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
// Exercise a device outside Iran; the selected civil day must still be Iranian.
test.use({ timezoneId: 'America/Los_Angeles' });

test('filters messages at Tehran midnight using Persian leap dates and preserves the range after reload', async ({
  page,
}) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const f = await fixtures();
  const ticket = await db.ticket.create({
    data: { creatorId: f.student.id, departmentId: f.department.id, subject: 'مرز تقویم ایران' },
  });
  await db.message.createMany({
    data: [
      ['2025-03-20T20:29:59.999Z', 'روز کبیسه'],
      ['2025-03-20T20:30:00.000Z', 'آغاز نوروز'],
      ['2025-03-21T20:29:59.999Z', 'پایان نوروز'],
      ['2025-03-21T20:30:00.000Z', 'روز دوم'],
    ].map(([createdAt, body]) => ({
      ticketId: ticket.id,
      senderId: f.student.id,
      createdAt: new Date(createdAt),
      body,
    })),
  });
  expect(
    (
      await page.request.post('/api/auth/sign-in/phone-number', {
        headers: { origin: 'http://localhost:3001' },
        data: { phoneNumber: f.student.phoneNumber, password: f.password },
      })
    ).ok(),
  ).toBe(true);
  await page.goto('/search?from=2025-03-20&to=2025-03-21');
  await page.getByText('فیلترهای بیشتر', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'از تاریخ، ۳۰ اسفند ۱۴۰۳' })).toBeVisible();
  await page.getByRole('button', { name: 'از تاریخ، ۳۰ اسفند ۱۴۰۳' }).click();
  await page.getByRole('button', { name: 'رفتن به ماه بعد' }).click();
  await page.getByRole('button', { name: /^جمعه ۱-ام فروردین ۱۴۰۴$/ }).click();
  await expect(page).toHaveURL(/from=2025-03-21/);
  const results = page.locator('[data-search-result]');
  await expect(results).toHaveCount(2);
  await expect(results.filter({ hasText: 'آغاز نوروز' })).toHaveCount(1);
  await expect(results.filter({ hasText: 'پایان نوروز' })).toHaveCount(1);
  await page.reload();
  await page.getByText('فیلترهای بیشتر', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'از تاریخ، ۱ فروردین ۱۴۰۴' })).toBeVisible();
  await expect(results).toHaveCount(2);
  await db.$disconnect();
});

test('submits report dates, supports month/year shortcuts, Escape and compact viewports without overflow', async ({
  page,
}) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const f = await fixtures();
  expect(
    (
      await page.request.post('/api/auth/sign-in/phone-number', {
        headers: { origin: 'http://localhost:3001' },
        data: { phoneNumber: f.manager.phoneNumber, password: f.password },
      })
    ).ok(),
  ).toBe(true);
  await page.goto('/reports?from=2025-03-20&to=2025-03-21');
  const trigger = page.getByRole('button', { name: 'از تاریخ، ۳۰ اسفند ۱۴۰۳' });
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 844, height: 390 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'از تاریخ', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'پاک کردن تاریخ' })).toBeInViewport();
    expect(
      await dialog.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return (
          box.left >= 0 &&
          box.right <= innerWidth &&
          box.top >= 0 &&
          box.bottom <= innerHeight &&
          element.scrollHeight <= element.clientHeight + 1
        );
      }),
    ).toBe(true);
    if (viewport.width === 320)
      await page.screenshot({
        path: '.local/ui-preview/jalali-calendar-320.png',
        animations: 'disabled',
      });
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  }
  await trigger.click();
  await page.getByRole('combobox', { name: 'سال را انتخاب کنید' }).click();
  await page.getByRole('option', { name: '۱۴۰۴', exact: true }).click();
  await page.getByRole('combobox', { name: 'ماه را انتخاب کنید' }).click();
  await page.getByRole('option', { name: 'فروردین', exact: true }).click();
  await page.getByRole('button', { name: /^جمعه ۱-ام فروردین ۱۴۰۴$/ }).click();
  await page.getByRole('button', { name: 'نمایش گزارش', exact: true }).click();
  await expect(page).toHaveURL(/from=2025-03-21/);
  await expect(page).toHaveURL(/to=2025-03-21/);
  await expect(page.getByRole('button', { name: 'از تاریخ، ۱ فروردین ۱۴۰۴' })).toBeVisible();
  // Invalid manually edited addresses must not crash the report page.
  await page.goto('/reports?from=2025-02-30&to=garbage');
  await expect(page.getByRole('heading', { name: 'گزارش‌ها و آمار' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'از تاریخ، انتخاب تاریخ' })).toBeVisible();
  // Historical summer days used UTC+04:30. Check both edges independently so an
  // excluded first reply cannot be masked by an incorrectly included next-day reply.
  await db.ticket.createMany({
    data: [
      {
        creatorId: f.student.id,
        departmentId: f.department.id,
        subject: 'ابتدای روز ایران',
        createdAt: new Date('2020-07-19T19:30:00.000Z'),
      },
      {
        creatorId: f.outsider.id,
        departmentId: f.department.id,
        subject: 'پیش از روز ایران',
        createdAt: new Date('2020-07-19T19:29:59.999Z'),
      },
    ],
  });
  await page.goto(`/reports?departmentId=${f.department.id}&from=2020-07-20&to=2020-07-20`);
  const total = page.locator('.stat-card').filter({ hasText: 'همه درخواست‌ها' }).locator('strong');
  await expect(total).toHaveText('۱');
  await db.ticket.updateMany({
    where: { creatorId: f.student.id, departmentId: f.department.id },
    data: { createdAt: new Date('2020-07-20T19:29:59.999Z') },
  });
  await db.ticket.updateMany({
    where: { creatorId: f.outsider.id, departmentId: f.department.id },
    data: { createdAt: new Date('2020-07-20T19:30:00.000Z') },
  });
  await page.reload();
  await expect(total).toHaveText('۱');
  await db.$disconnect();
});
