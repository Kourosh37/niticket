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

test('searches every chat, paginates results and opens an old matching message without downloading the whole conversation', async ({
  page,
}) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const f = await fixtures(),
    tag = `lookup${randomUUID().slice(0, 8)}`;
  const ticket = await db.ticket.create({
    data: { creatorId: f.student.id, departmentId: f.department.id, subject: 'آرشیو طولانی' },
  });
  const ids = Array.from({ length: 2000 }, () => randomUUID()),
    start = Date.now() - 3_000_000;
  await db.message.createMany({
    data: ids.map((id, index) => ({
      id,
      ticketId: ticket.id,
      senderId: f.student.id,
      body: index < 45 ? `${tag} کارنامه شماره ${index}` : `پیام آرشیو شماره ${index}`,
      createdAt: new Date(start + index * 1000),
    })),
  });
  const other = await db.ticket.create({
    data: {
      creatorId: f.student.id,
      departmentId: f.destination.id,
      subject: 'گفتگوی دیگر',
      messages: { create: { senderId: f.student.id, body: `${tag} SECOND_UNIT` } },
    },
  });
  const forbidden = await db.message.create({
    data: {
      ticketId: ticket.id,
      senderId: f.agent.id,
      visibility: 'INTERNAL',
      body: `${tag} PRIVATE_SEARCH_SECRET`,
    },
  });
  const foreign = await db.ticket.create({
    data: {
      creatorId: f.outsider.id,
      departmentId: f.department.id,
      subject: 'غیرمجاز',
      messages: { create: { senderId: f.outsider.id, body: `${tag} FOREIGN_SEARCH_SECRET` } },
    },
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page, f.student.phoneNumber!, f.password);
  await page.getByRole('searchbox', { name: 'جستجو در همه پیام‌ها', exact: true }).fill(tag);
  const results = page.locator('[data-search-result]');
  await expect(results).toHaveCount(20);
  expect(new URL(page.url()).pathname).toBe('/');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator(`[data-search-result="${ids[44]}"]`)).toBeVisible();
  await expect(page.getByText('PRIVATE_SEARCH_SECRET', { exact: false })).toHaveCount(0);
  await expect(page.getByText('FOREIGN_SEARCH_SECRET', { exact: false })).toHaveCount(0);
  await expect(results.first()).toContainText('SECOND_UNIT');
  await page.getByRole('button', { name: 'نتایج بیشتر', exact: true }).click();
  await expect(page.locator(`[data-search-result="${ids[24]}"]`)).toBeVisible();
  await expect(results).toHaveCount(20);
  await page.getByRole('button', { name: 'نتایج بیشتر', exact: true }).click();
  await expect(results).toHaveCount(6);
  await expect(page.getByRole('button', { name: 'نتایج بیشتر', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'صفحه قبل', exact: true }).click();
  await expect(results).toHaveCount(20);
  await page.getByRole('button', { name: 'صفحه قبل', exact: true }).click();
  await expect(results.first()).toContainText('SECOND_UNIT');
  await expect(
    page.getByRole('searchbox', { name: 'جستجو در همه پیام‌ها', exact: true }),
  ).toBeInViewport();
  await page.getByRole('searchbox').focus();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const geometry = await page.locator('.message-search-input').evaluate((box) => {
      const input = box.querySelector('input')!;
      const outer = box.getBoundingClientRect(),
        inner = input.getBoundingClientRect();
      return {
        contained: inner.left >= outer.left && inner.right <= outer.right,
        outline: getComputedStyle(input).outlineStyle,
      };
    });
    expect(geometry.contained).toBe(true);
    expect(geometry.outline).toBe('none');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.screenshot({ path: '.local/ui-preview/search-desktop.png' });
  await page.locator(`[data-search-result="${ids[44]}"] .search-result-main`).click();
  await expect(page).toHaveURL(new RegExp(`/tickets/${ticket.id}\\?message=${ids[44]}`));
  const focus = page.locator(`[data-message-id="${ids[44]}"][data-search-focused="true"]`);
  await expect(focus).toBeInViewport();
  await expect(focus.locator('mark')).toContainText(tag);
  await expect(page.getByText('پیام آرشیو شماره 1999', { exact: true })).toHaveCount(0);
  expect(await page.locator('[data-message-id]').count()).toBeLessThan(40);
  expect(
    (
      await page.request.get(
        `/api/v1/tickets/${ticket.id}/messages/context?messageId=${forbidden.id}`,
      )
    ).status(),
  ).toBe(404);
  expect((await page.request.get(`/api/v1/search?q=${tag}&ticketId=${foreign.id}`)).status()).toBe(
    404,
  );
  await page.getByRole('link', { name: 'بازگشت به نتایج جستجو', exact: true }).click();
  await expect(results).toHaveCount(20);
  await expect(results.first()).toContainText('SECOND_UNIT');
  expect(other.id).not.toBe(ticket.id);
  expect(errors).toEqual([]);
  await db.$disconnect();
});

test('searches inside a chat, navigates matches across result pages and preserves drafts and bounded message rendering', async ({
  page,
}) => {
  test.setTimeout(90000);
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const f = await fixtures(),
    tag = `inside${randomUUID().slice(0, 8)}`;
  const ticket = await db.ticket.create({
    data: { creatorId: f.student.id, departmentId: f.department.id, subject: 'جستجوی گفتگو' },
  });
  const ids = Array.from({ length: 500 }, () => randomUUID()),
    start = Date.now() - 1_000_000;
  await db.message.createMany({
    data: ids.map((id, index) => ({
      id,
      ticketId: ticket.id,
      senderId: f.student.id,
      body: index < 400 && index % 10 === 0 ? `${tag} نتیجه ${index}` : `متن پیام ${index}`,
      createdAt: new Date(start + index * 1000),
    })),
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page, f.student.phoneNumber!, f.password);
  await page.goto(`/tickets/${ticket.id}`);
  await expect(page.getByText('متن پیام 499', { exact: true })).toBeInViewport();
  await page.getByLabel('پاسخ شما', { exact: true }).fill('پیش‌نویس هنگام جستجو باقی بماند');
  await page.keyboard.press('Control+f');
  const dialog = page.getByRole('region', { name: 'جستجو در این گفتگو', exact: true });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('searchbox', { name: 'جستجو در پیام‌های این گفتگو', exact: true })
    .fill(tag);
  await expect(dialog.locator('[data-search-result]')).toHaveCount(20);
  await dialog.locator(`[data-search-result="${ids[200]}"] .search-result-main`).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.locator(`[data-message-id="${ids[200]}"][data-search-focused="true"]`),
  ).toBeInViewport();
  await expect(page.getByLabel('پاسخ شما', { exact: true })).toHaveValue(
    'پیش‌نویس هنگام جستجو باقی بماند',
  );
  await page.getByRole('button', { name: 'نتیجه بعدی', exact: true }).click();
  await expect(
    page.locator(`[data-message-id="${ids[190]}"][data-search-focused="true"]`),
  ).toBeInViewport();
  await page.getByRole('button', { name: 'نتیجه قبلی', exact: true }).click();
  await expect(
    page.locator(`[data-message-id="${ids[200]}"][data-search-focused="true"]`),
  ).toBeInViewport();
  await page.getByRole('button', { name: 'مشاهده نتایج', exact: true }).click();
  await expect(dialog.locator('[data-search-result]')).toHaveCount(20);
  await expect(dialog.getByRole('searchbox')).toHaveValue(tag);
  await expect(dialog.locator('.message-search-results')).toHaveAttribute('aria-busy', 'false');
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.screenshot({ path: '.local/ui-preview/search-chat-390.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 450 });
    await expect(dialog.getByRole('searchbox')).toBeInViewport();
    await expect(dialog.getByRole('button', { name: 'نتایج بیشتر', exact: true })).toBeInViewport();
    expect((await dialog.locator('.message-search-results').boundingBox())!.height).toBeGreaterThan(
      40,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await dialog.getByRole('button', { name: 'بستن جستجو', exact: true }).click();
  await page.getByRole('button', { name: 'آخرین پیام‌ها', exact: true }).click();
  await expect(page.getByText('متن پیام 499', { exact: true })).toBeInViewport();
  await expect(page.getByLabel('پاسخ شما', { exact: true })).toHaveValue(
    'پیش‌نویس هنگام جستجو باقی بماند',
  );
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page.getByLabel('پاسخ شما', { exact: true })).toBeInViewport();
  }
  expect(await page.locator('[data-message-id]').count()).toBeLessThan(40);
  expect(errors).toEqual([]);
  await db.$disconnect();
});

test('filters file names and audio without downloading attachments and chooses only visible senders', async ({
  page,
}) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const f = await fixtures(),
    tag = `filter${randomUUID().slice(0, 8)}`;
  const ticket = await db.ticket.create({
    data: { creatorId: f.student.id, departmentId: f.department.id, subject: 'فیلتر پیام' },
  });
  const doc = await db.message.create({
    data: { ticketId: ticket.id, senderId: f.student.id, body: 'فایل کارنامه' },
  });
  const audio = await db.message.create({
    data: { ticketId: ticket.id, senderId: f.agent.id, body: 'پیام صوتی واحد' },
  });
  await db.message.create({
    data: {
      ticketId: ticket.id,
      senderId: f.manager.id,
      body: 'PRIVATE_FILTER_SENDER',
      visibility: 'INTERNAL',
    },
  });
  await db.attachment.createMany({
    data: [
      {
        ticketId: ticket.id,
        messageId: doc.id,
        filename: `${tag}-كارنامه۱۲۳.pdf`,
        declaredMime: 'application/pdf',
        detectedMime: 'application/pdf',
      },
      {
        ticketId: ticket.id,
        messageId: audio.id,
        filename: 'voice.webm',
        declaredMime: 'audio/webm',
        detectedMime: 'audio/webm',
      },
    ].map((file) => ({
      ...file,
      uploaderId: f.student.id,
      objectKey: randomUUID(),
      expectedSize: 10,
      size: 10,
      scanStatus: 'CLEAN' as const,
      expiresAt: new Date(Date.now() + 86400000),
    })),
  });
  let downloads = 0;
  page.on('request', (request) => {
    if (/\/attachments\/.+\/access/.test(request.url())) downloads++;
  });
  await login(page, f.student.phoneNumber!, f.password);
  await page.goto(`/search?ticketId=${ticket.id}`);
  const search = page.getByRole('searchbox');
  await search.fill(`${tag} کارنامه123`);
  await expect(page.locator('[data-search-result]')).toHaveCount(1);
  await expect(page.locator(`[data-search-result="${doc.id}"] mark`)).toHaveCount(2);
  await page.getByRole('button', { name: 'پاک کردن جستجو', exact: true }).click();
  await page.getByRole('button', { name: 'صداها', exact: true }).click();
  await expect(page.locator(`[data-search-result="${audio.id}"]`)).toBeVisible();
  await expect(page.locator('[data-search-result]')).toHaveCount(1);
  await page.getByText('فیلترهای بیشتر', { exact: true }).click();
  await page.getByRole('button', { name: 'انتخاب فرستنده', exact: true }).click();
  await expect(page.locator('.search-sender-options button')).toHaveCount(2);
  await expect(page.locator('.search-sender-options')).not.toContainText(f.manager.name);
  await page
    .locator('.search-sender-options')
    .getByRole('button', { name: f.student.name, exact: true })
    .click();
  await expect(
    page.getByText('پیامی پیدا نشد. عبارت یا فیلترها را تغییر دهید.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('نمایش پیام‌ها', { exact: true })).toHaveCount(0);
  expect(downloads).toBe(0);
  await db.$disconnect();
});

test('filters administrative lists live and searches messages in place without a dialog', async ({
  page,
}) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const f = await fixtures(),
    tag = `live${randomUUID().slice(0, 8)}`;
  const ticket = await db.ticket.create({
    data: {
      creatorId: f.student.id,
      departmentId: f.department.id,
      subject: `${tag} subject`,
      messages: { create: { senderId: f.student.id, body: `${tag} message` } },
    },
  });
  await db.ticket.create({
    data: {
      creatorId: f.outsider.id,
      departmentId: f.department.id,
      subject: 'Other history record',
    },
  });
  await login(page, f.admin.phoneNumber!, f.password);
  await page.goto('/admin/departments');
  await page.getByRole('searchbox', { name: 'جستجوی واحدها', exact: true }).fill(f.department.name);
  await expect(page.locator('.admin-card h2')).toHaveCount(1);
  await expect(page.locator('.admin-card h2')).toHaveText(f.department.name);
  await expect(page).toHaveURL(/\/admin\/departments\?q=/);
  await page.goto(`/admin/departments/${f.department.id}/history`);
  await expect(page.locator('.ticket-row')).toHaveCount(2);
  await page.getByRole('searchbox', { name: 'جستجو در تاریخچه واحد', exact: true }).fill(tag);
  await expect(page.locator('.ticket-row')).toHaveCount(1);
  await expect(page.locator('.ticket-row')).toHaveAttribute('href', `/tickets/${ticket.id}`);
  const path = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'جستجو در همه پیام‌ها', exact: true }).click();
  await page.getByRole('searchbox', { name: 'جستجو در همه پیام‌ها', exact: true }).fill(tag);
  await expect(page.locator('[data-search-result]')).toHaveCount(1);
  expect(new URL(page.url()).pathname).toBe(path);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'بستن جستجو', exact: true }).click();
  await expect(page.locator('[data-search-result]')).toHaveCount(0);
  await db.$disconnect();
});
