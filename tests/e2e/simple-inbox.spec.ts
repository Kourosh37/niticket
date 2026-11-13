import { test, expect, type Page } from '@playwright/test';
import { loadEnvFile } from 'node:process';

try {
  loadEnvFile('.env');
} catch {
  /* CI supplies environment. */
}
const testUrl = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!);
if (!process.env.TEST_DATABASE_URL) testUrl.pathname = '/niticket_test';
if (!testUrl.pathname.endsWith('_test')) throw new Error('Test database required');
process.env.DATABASE_URL = testUrl.toString();
const origin = 'http://localhost:3001';

async function login(page: Page, identifier: string, password: string) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'ورود با رمز', exact: true }).click();
  await page.getByLabel('شماره موبایل', { exact: true }).fill(identifier);
  await page.getByLabel('رمز عبور', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'ورود', exact: true }).click();
  await expect(page).toHaveURL(origin + '/');
}

test('unit selection opens a persistent chat immediately, accepts an attachment first and sorts officer replies automatically', async ({
  browser,
}) => {
  test.setTimeout(90000);
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const { processScan } = await import('@niticket/core/application/jobs');
  const f = await fixtures();
  const student = await browser.newContext({
      extraHTTPHeaders: { 'x-real-ip': '192.0.2.71', 'x-forwarded-for': '192.0.2.71' },
    }),
    officer = await browser.newContext({
      extraHTTPHeaders: { 'x-real-ip': '192.0.2.72', 'x-forwarded-for': '192.0.2.72' },
    });
  const s = await student.newPage(),
    o = await officer.newPage();
  await login(s, f.student.phoneNumber!, f.password);
  await s.getByRole('link', { name: 'پیام جدید', exact: true }).click();
  await expect(s.getByRole('heading', { name: 'به کدام واحد پیام می‌دهید؟' })).toBeVisible();
  if (await s.getByLabel('جستجوی واحد', { exact: true }).count())
    await s.getByLabel('جستجوی واحد', { exact: true }).fill(f.department.name);
  await s.getByRole('button', { name: `انتخاب ${f.department.name}`, exact: true }).click();
  await expect(s).toHaveURL(/\/tickets\/[a-f0-9-]+$/);
  const id = s.url().split('/').at(-1)!;
  await expect(s.getByLabel('موضوع درخواست')).toHaveCount(0);
  await expect(s.getByLabel('شرح درخواست')).toHaveCount(0);
  await expect(s.getByLabel('پاسخ شما', { exact: true })).toBeInViewport();
  expect(await db.message.count({ where: { ticketId: id } })).toBe(0);
  expect(
    await db.outboxEvent.count({
      where: { type: 'TICKET_NOTIFICATION', payload: { path: ['ticketId'], equals: id } },
    }),
  ).toBe(0);
  await s.locator('#attachment').setInputFiles('tests/fixtures/photo.png');
  await s.getByRole('button', { name: 'ارسال پیام', exact: true }).click();
  await expect.poll(() => db.attachment.count({ where: { ticketId: id } })).toBe(1);
  const file = await db.attachment.findFirstOrThrow({ where: { ticketId: id } });
  await expect
    .poll(
      async () => (await db.attachment.findUniqueOrThrow({ where: { id: file.id } })).scanStatus,
    )
    .toBe('QUARANTINED');
  const event = await db.outboxEvent.findFirstOrThrow({
    where: { type: 'SCAN_ATTACHMENT', payload: { path: ['attachmentId'], equals: file.id } },
  });
  await processScan(event.id, event.payload);
  await s.getByRole('link', { name: 'بازگشت به گفتگوها', exact: true }).click();
  await s.getByRole('link', { name: 'پیام جدید', exact: true }).click();
  await expect(s.getByRole('heading', { name: 'به کدام واحد پیام می‌دهید؟' })).toBeVisible();
  if (await s.getByLabel('جستجوی واحد', { exact: true }).count())
    await s.getByLabel('جستجوی واحد', { exact: true }).fill(f.department.name);
  await s.getByRole('button', { name: `انتخاب ${f.department.name}`, exact: true }).click();
  await expect(s).toHaveURL(`${origin}/tickets/${id}`);
  expect(
    await db.ticket.count({ where: { creatorId: f.student.id, departmentId: f.department.id } }),
  ).toBe(1);
  await login(o, f.agent.phoneNumber!, f.password);
  await expect(o.getByRole('link', { name: 'پیام‌های جدید', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(o.locator('.inbox-thread')).toHaveCount(1);
  await o.locator('.inbox-thread').click();
  await expect(o.getByRole('button', { name: /پایان رسیدگی|بستن نهایی/ })).toHaveCount(0);
  await o
    .getByLabel('پاسخ شما', { exact: true })
    .fill('سلام، تصویر شما دریافت شد. از همین‌جا پیگیری می‌کنیم.');
  await o.getByRole('button', { name: 'ارسال پیام', exact: true }).click();
  await expect(
    o
      .locator('.message-body')
      .filter({ hasText: 'سلام، تصویر شما دریافت شد. از همین‌جا پیگیری می‌کنیم.' }),
  ).toBeVisible();
  await o.getByRole('link', { name: 'بازگشت به گفتگوها', exact: true }).click();
  await expect(o.locator('.inbox-thread')).toHaveCount(0);
  await o.getByRole('link', { name: 'پاسخ داده‌شده', exact: true }).click();
  await expect(o.locator('.inbox-thread')).toHaveCount(1);
  await db.ticket.update({ where: { id }, data: { status: 'IN_PROGRESS' } });
  await o.reload();
  await expect(o.locator('.inbox-thread')).toHaveCount(1);
  await expect(o.locator('.thread-state')).toHaveText('پاسخ داده‌شده');
  await expect(o.locator('.inbox-thread')).not.toHaveClass(/thread-action/);
  await s.getByLabel('پاسخ شما', { exact: true }).fill('ممنون، این هم توضیح تکمیلی من.');
  await s.getByRole('button', { name: 'ارسال پیام', exact: true }).click();
  await expect(
    s.locator('.message-body').filter({ hasText: 'ممنون، این هم توضیح تکمیلی من.' }),
  ).toBeVisible();
  await o.goto('/');
  await expect(o.locator('.inbox-thread')).toHaveCount(1);
  await o.setViewportSize({ width: 390, height: 844 });
  await o.screenshot({ path: '.local/ui-preview/officer-inbox-390.png', fullPage: true });
  await o.locator('.inbox-thread').click();
  await expect(o.locator('.messenger-header')).toBeInViewport();
  await expect(o.getByLabel('پاسخ شما', { exact: true })).toBeInViewport();
  await o.screenshot({ path: '.local/ui-preview/officer-chat-390.png' });
  await student.close();
  await officer.close();
  await db.$disconnect();
});

test('long chats use a single message scroller, preserve older-message position and keep drafts during live updates', async ({
  browser,
}) => {
  test.setTimeout(90000);
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const { transaction } = await import('@niticket/core/infrastructure/transaction');
  const { ticketChanged } = await import('@niticket/core/application/realtime-events');
  const f = await fixtures();
  await db.department.update({
    where: { id: f.department.id },
    data: { name: 'آموزش و امور دانشجویی' },
  });
  const ticket = await db.ticket.create({
    data: {
      creatorId: f.student.id,
      departmentId: f.department.id,
      subject: 'گفتگوی طولانی',
      status: 'CLOSED',
      closedAt: new Date(),
    },
  });
  const start = Date.now() - 200000;
  await db.message.createMany({
    data: Array.from({ length: 160 }, (_, index) => ({
      ticketId: ticket.id,
      senderId: f.student.id,
      body: `پیام شماره ${index} برای بررسی گفتگو`,
      createdAt: new Date(start + index * 1000),
    })),
  });
  const context = await browser.newContext({
    extraHTTPHeaders: { 'x-real-ip': '192.0.2.73', 'x-forwarded-for': '192.0.2.73' },
  });
  const page = await context.newPage();
  await login(page, f.student.phoneNumber!, f.password);
  await page.goto(`/tickets/${ticket.id}`);
  const area = page.locator('.messenger-scroll');
  await expect(page.getByLabel('پاسخ شما', { exact: true })).toBeInViewport();
  await expect(page.getByText('پیام شماره 159 برای بررسی گفتگو', { exact: true })).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator('[data-testid="virtuoso-item-list"]')).toHaveCSS(
    'visibility',
    'visible',
  );
  await area.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(page.getByText('پیام شماره 110 برای بررسی گفتگو', { exact: true })).toBeInViewport();
  const oldMessage = page.getByText('پیام شماره 110 برای بررسی گفتگو', { exact: true });
  const before = (await oldMessage.boundingBox())!.y;
  const olderResponse = page.waitForResponse(
    (r) => r.url().includes(`/tickets/${ticket.id}/messages?cursor=`) && r.status() === 200,
  );
  await page.getByRole('button', { name: 'پیام‌های قبلی', exact: true }).click();
  expect((await (await olderResponse).json()).data.items[0].body).toContain('پیام شماره 60');
  await expect(oldMessage).toBeInViewport();
  expect(await page.locator('[data-message-id]').count()).toBeLessThan(35);
  await expect
    .poll(async () => {
      const box = await oldMessage.boundingBox();
      return box ? Math.abs(box.y - before) : Infinity;
    })
    .toBeLessThan(4);
  const top = await area.evaluate((element) => element.scrollTop);
  await page.getByLabel('پاسخ شما', { exact: true }).fill('پیش‌نویس من حفظ شود');
  const staff = await browser.newContext({
    extraHTTPHeaders: { 'x-real-ip': '192.0.2.74', 'x-forwarded-for': '192.0.2.74' },
  });
  const loginResponse = await staff.request.post('/api/auth/sign-in/phone-number', {
    headers: { origin },
    data: { phoneNumber: f.agent.phoneNumber, password: f.password },
  });
  expect(loginResponse.status()).toBe(200);
  const reply = await staff.request.post(`/api/v1/tickets/${ticket.id}/messages`, {
    headers: { origin },
    data: { version: 1, body: 'پاسخ جدید واحد برای گفتگو' },
  });
  expect(reply.status()).toBe(200);
  const s = page;
  await expect(s.getByRole('button', { name: 'پیام جدید', exact: true })).toBeVisible({
    timeout: 15000,
  });
  await expect(s.getByLabel('پاسخ شما', { exact: true })).toHaveValue('پیش‌نویس من حفظ شود');
  expect(Math.abs((await area.evaluate((element) => element.scrollTop)) - top)).toBeLessThan(4);
  expect(top).toBeGreaterThan(0);
  await s.getByRole('button', { name: 'پیام جدید', exact: true }).click();
  await expect(s.getByText('پاسخ جدید واحد برای گفتگو', { exact: true })).toBeInViewport();
  // Simulate receiving more than a page while disconnected, then fill the gap in place.
  const later = Date.now() + 1000;
  // Bulk fixtures model a committed change, including its normal invalidation.
  await transaction(async (tx) => {
    await tx.message.createMany({
      data: Array.from({ length: 55 }, (_, index) => ({
        ticketId: ticket.id,
        senderId: f.agent.id,
        body: `پیام پس از اتصال ${index}`,
        createdAt: new Date(later + index * 1000),
      })),
    });
    await tx.ticket.update({ where: { id: ticket.id }, data: { updatedAt: new Date() } });
    await ticketChanged(tx, ticket.id);
  });
  await expect(s.getByText('پیام پس از اتصال 54', { exact: true })).toBeInViewport({
    timeout: 15000,
  });
  // Keep a real upward scroll immediately after the new batch is painted: the
  // virtualizer must not pull the reader back down while measuring new rows.
  await area.hover();
  await s.mouse.wheel(0, -100000);
  await expect(s.getByRole('button', { name: 'پیام‌های قبلی', exact: true })).toBeInViewport();
  const preserved = s.getByText('پیام شماره 60 برای بررسی گفتگو', { exact: true });
  await expect(preserved).toBeInViewport();
  const position = (await preserved.boundingBox())!.y;
  const gapResponse = s.waitForResponse(
    (r) => r.url().includes(`/tickets/${ticket.id}/messages?cursor=`) && r.status() === 200,
  );
  await s.getByRole('button', { name: 'پیام‌های قبلی', exact: true }).click();
  expect(
    (await (await gapResponse).json()).data.items.some(
      (m: { body: string }) => m.body === 'پیام پس از اتصال 0',
    ),
  ).toBe(true);
  await expect(preserved).toBeInViewport();
  await expect
    .poll(async () => {
      const box = await preserved.boundingBox();
      return box ? Math.abs(box.y - position) : Infinity;
    })
    .toBeLessThan(4);
  // Resume following through reader input, not a virtualizer-like programmatic correction.
  await area.hover();
  await s.mouse.wheel(0, 100000);
  await expect(s.getByText('پیام پس از اتصال 54', { exact: true })).toBeInViewport();
  await expect
    .poll(() =>
      area.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop),
    )
    .toBeLessThan(2);
  await transaction(async (tx) => {
    await tx.message.create({
      data: {
        ticketId: ticket.id,
        senderId: f.agent.id,
        body: 'پاسخ پس از بازگشت به انتهای گفتگو',
        createdAt: new Date(later + 55000),
      },
    });
    await tx.ticket.update({ where: { id: ticket.id }, data: { updatedAt: new Date() } });
    await ticketChanged(tx, ticket.id);
  });
  await expect(s.getByText('پاسخ پس از بازگشت به انتهای گفتگو', { exact: true })).toBeInViewport({
    timeout: 15000,
  });
  await expect(s.getByLabel('پاسخ شما', { exact: true })).toHaveValue('پیش‌نویس من حفظ شود');
  for (const [width, height] of [
    [320, 600],
    [390, 844],
    [390, 450],
    [768, 800],
    [1440, 900],
  ]) {
    await s.setViewportSize({ width, height });
    await expect(s.locator('.messenger-header')).toBeInViewport();
    await expect(s.getByLabel('پاسخ شما', { exact: true })).toBeInViewport();
    expect(
      await s.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth &&
          document.documentElement.scrollHeight <= innerHeight + 1 &&
          window.scrollY === 0,
      ),
    ).toBe(true);
    if ((width === 390 && height === 844) || width === 1440)
      await s.screenshot({ path: `.local/ui-preview/chat-${width}.png` });
  }
  await context.close();
  await staff.close();
  await db.$disconnect();
});
