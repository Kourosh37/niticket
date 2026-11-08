import { test, expect, type Page } from '@playwright/test';
import { loadEnvFile } from 'node:process';

try {
  loadEnvFile('.env');
} catch {
  /* CI provides environment. */
}
const testUrl = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!);
if (!process.env.TEST_DATABASE_URL) testUrl.pathname = '/niticket_test';
if (!testUrl.pathname.endsWith('_test')) throw new Error('Test database required');
process.env.DATABASE_URL = testUrl.toString();

async function login(page: Page, identifier: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('ایمیل، شماره دانشجویی یا نام کاربری').fill(identifier);
  await page.getByLabel('رمز عبور', { exact: true }).fill(password);
  const response = page.waitForResponse((r) => r.url().endsWith('/api/auth/sign-in/email'));
  await page.getByRole('button', { name: 'ورود به حساب', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page).toHaveURL('http://localhost:3001/');
}

test('requesters and officers use a simple inbox with scoped action tabs and responsive conversations', async ({
  browser,
}) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const f = await fixtures();
  await db.user.update({ where: { id: f.student.id }, data: { name: 'امیر رضایی' } });
  await db.user.update({ where: { id: f.agent.id }, data: { name: 'مسئول آموزش' } });
  await db.department.update({
    where: { id: f.department.id },
    data: { name: 'آموزش و امور دانشجویی' },
  });
  const tickets = await Promise.all(
    (['WAITING_FOR_USER', 'OPEN', 'RESOLVED'] as const).map((status, index) =>
      db.ticket.create({
        data: {
          departmentId: f.department.id,
          creatorId: f.student.id,
          subject: [
            'بررسی مدارک انتخاب واحد',
            'دریافت گواهی اشتغال به تحصیل',
            'راهنمای پرداخت شهریه',
          ][index],
          status,
          resolvedAt: status === 'RESOLVED' ? new Date() : null,
          messages: {
            create: [
              {
                senderId: f.student.id,
                body: 'سلام، برای تکمیل درخواست به راهنمایی شما نیاز دارم.',
                createdAt: new Date(Date.now() - 60000),
              },
              {
                senderId: f.agent.id,
                body: 'سلام، لطفاً تصویر فرم تکمیل‌شده را در همین گفتگو بفرستید.',
                createdAt: new Date(Date.now() - 30000),
              },
              { senderId: f.agent.id, body: 'PRIVATE_INBOX_NOTE', visibility: 'INTERNAL' },
            ],
          },
        },
      }),
    ),
  );
  // Independent clients must not consume one shared IP's authentication quota.
  const student = await browser.newContext({
      extraHTTPHeaders: { 'x-real-ip': '192.0.2.41', 'x-forwarded-for': '192.0.2.41' },
    }),
    officer = await browser.newContext({
      extraHTTPHeaders: { 'x-real-ip': '192.0.2.42', 'x-forwarded-for': '192.0.2.42' },
    });
  const s = await student.newPage(),
    o = await officer.newPage();
  await login(s, f.student.email, f.password);
  await expect(s.getByRole('heading', { name: 'گفتگوهای من', exact: true })).toBeVisible();
  await expect(s.locator('.sidebar, .stats-grid, .ticket-table-head')).toHaveCount(0);
  await expect(s.locator('.inbox-thread')).toHaveCount(3);
  await expect(s.getByText('PRIVATE_INBOX_NOTE')).toHaveCount(0);
  await s.getByRole('link', { name: 'نوبت پاسخ من', exact: true }).click();
  await expect(s.locator('.inbox-thread')).toHaveCount(1);
  await expect(s.locator('.inbox-thread')).toContainText('بررسی مدارک انتخاب واحد');
  await login(o, f.agent.email, f.password);
  await expect(o.getByRole('heading', { name: 'گفتگوهای واحد', exact: true })).toBeVisible();
  await expect(o.getByRole('link', { name: 'درخواست جدید', exact: true })).toHaveCount(0);
  await o.getByRole('link', { name: 'نیاز به پاسخ', exact: true }).click();
  await expect(o.locator('.inbox-thread')).toHaveCount(1);
  await expect(o.locator('.inbox-thread')).toContainText('دریافت گواهی اشتغال به تحصیل');
  for (const [page, role] of [
    [s, 'requester'],
    [o, 'officer'],
  ] as const) {
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      if (role === 'officer')
        await expect(page.getByRole('link', { name: 'نیاز به پاسخ', exact: true })).toHaveAttribute(
          'aria-current',
          'page',
        );
      await expect(page.locator('h1')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if ([390, 1440].includes(width))
        await page.screenshot({
          path: `test-results/simple-${role}-inbox-${width}.png`,
          fullPage: true,
        });
      await page.goto(`/tickets/${tickets[0].id}`);
      await expect(page.getByLabel('پاسخ شما', { exact: true })).toBeVisible();
      await expect(page.locator('.chat-heading')).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if ([390, 1440].includes(width))
        await page.screenshot({
          path: `test-results/simple-${role}-chat-${width}.png`,
          fullPage: false,
        });
    }
  }
  await s.getByRole('tab', { name: 'گفتگو', exact: true }).focus();
  await s.keyboard.press('ArrowLeft');
  await expect(s.getByRole('tab', { name: 'تاریخچه کامل', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await student.close();
  await officer.close();
  await db.$disconnect();
});

test('the two-step request form preserves text and clears a category when changing units', async ({
  page,
}) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const f = await fixtures();
  await page.setExtraHTTPHeaders({ 'x-real-ip': '192.0.2.43', 'x-forwarded-for': '192.0.2.43' });
  await login(page, f.student.email, f.password);
  await page.getByRole('link', { name: 'درخواست جدید', exact: true }).click();
  await page.getByRole('button', { name: `انتخاب ${f.department.name}`, exact: true }).click();
  await page.getByLabel('موضوع درخواست', { exact: true }).fill('درخواست راهنمایی برای ثبت نام');
  await page
    .getByLabel('شرح درخواست', { exact: true })
    .fill('لطفاً برای تکمیل ثبت نام و مدارک لازم راهنمایی کنید.');
  await page.getByText('دسته‌بندی پیام (اختیاری)', { exact: true }).click();
  await page.getByLabel('دسته‌بندی', { exact: true }).selectOption(f.category.id);
  await page.getByRole('button', { name: 'تغییر واحد', exact: true }).click();
  await page.getByRole('button', { name: `انتخاب ${f.destination.name}`, exact: true }).click();
  await expect(page.getByLabel('موضوع درخواست', { exact: true })).toHaveValue(
    'درخواست راهنمایی برای ثبت نام',
  );
  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByLabel('شرح درخواست', { exact: true }).blur();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByRole('button', { name: 'ارسال درخواست', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'test-results/simple-new-request-390.png' });
  await page.getByRole('button', { name: 'ارسال درخواست', exact: true }).click();
  await expect(page).toHaveURL(/\/tickets\/[a-f0-9-]+$/);
  const ticket = await db.ticket.findUniqueOrThrow({
    where: { id: page.url().split('/').at(-1)! },
  });
  expect(ticket.departmentId).toBe(f.destination.id);
  expect(ticket.categoryId).toBeNull();
  await db.$disconnect();
});
