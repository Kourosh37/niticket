import { test, expect, type Page } from '@playwright/test';
import { loadEnvFile } from 'node:process';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

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
test.use({ acceptDownloads: true });

async function login(page: Page, phoneNumber: string, password: string) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'ورود با رمز', exact: true }).click();
  await page.getByLabel('شماره موبایل', { exact: true }).fill(phoneNumber);
  await page.getByLabel('رمز عبور', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'ورود', exact: true }).click();
  await expect(page).toHaveURL(origin + '/');
}

test('shows real transferred bytes, cancels and retries downloads after their message is virtualized away', async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const { putObject } = await import('@niticket/core/infrastructure/storage');
  const f = await fixtures(),
    ticket = await db.ticket.create({
      data: { creatorId: f.student.id, departmentId: f.department.id, subject: 'دریافت پیش‌رونده' },
    });
  const ids = Array.from({ length: 100 }, () => randomUUID()),
    start = Date.now() - 200000;
  await db.message.createMany({
    data: ids.map((id, index) => ({
      id,
      ticketId: ticket.id,
      senderId: f.student.id,
      body: `پیام دانلود ${index}`,
      createdAt: new Date(start + index * 1000),
    })),
  });
  const bytes = Buffer.alloc(1048576, 'download-test\n'),
    key = `clean/${randomUUID()}`,
    filename = 'فایل آزمون.txt';
  await putObject(key, bytes, 'text/plain');
  const file = await db.attachment.create({
    data: {
      ticketId: ticket.id,
      messageId: ids[99],
      uploaderId: f.student.id,
      objectKey: key,
      filename,
      declaredMime: 'text/plain',
      detectedMime: 'text/plain',
      expectedSize: bytes.length,
      size: bytes.length,
      scanStatus: 'CLEAN',
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  let requests = 0;
  page.on('request', (request) => {
    if (request.url().endsWith(`/attachments/${file.id}/access`)) requests++;
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page, f.student.phoneNumber!, f.password);
  await page.goto(`/tickets/${ticket.id}`);
  await expect(page.getByRole('button', { name: `دریافت ${filename}`, exact: true })).toBeVisible();
  expect(requests).toBe(0);
  const network = await context.newCDPSession(page);
  await network.send('Network.enable');
  await network.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 20,
    downloadThroughput: 128 * 1024,
    uploadThroughput: -1,
  });
  await page.getByRole('button', { name: `دریافت ${filename}`, exact: true }).click();
  const tray = page.getByRole('complementary', { name: 'دریافت فایل‌ها', exact: true }),
    row = tray.locator(`[data-download-id="${file.id}"]`);
  const progress = row.getByRole('progressbar', { name: `دریافت ${filename}`, exact: true });
  await expect(progress).toBeVisible();
  await expect
    .poll(async () => Number(await progress.getAttribute('aria-valuenow')))
    .toBeGreaterThan(0);
  expect(Number(await progress.getAttribute('aria-valuenow'))).toBeLessThan(100);
  await expect(row.locator('.download-size')).toHaveText(/^\d+\.\d{2} MB \/ 1\.00 MB$/);
  await expect(row.locator('.download-size')).toHaveAttribute('dir', 'ltr');
  await expect(row.locator('.download-kilobytes')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await tray.screenshot({ path: '.local/ui-preview/download-progress-390.png' });
  await expect(page.getByLabel('پاسخ شما', { exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.messenger-scroll').evaluate((node) => {
    node.scrollTop = 0;
  });
  await expect(page.locator(`[data-message-id="${ids[99]}"]`)).toHaveCount(0);
  await row.getByRole('button', { name: `لغو دریافت ${filename}`, exact: true }).click();
  await expect(row.getByRole('status')).toHaveText('دریافت لغو شد');
  await expect(progress).toHaveCount(0);
  await network.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: 512 * 1024,
    uploadThroughput: -1,
  });
  const complete = page.waitForEvent('download');
  await row.getByRole('button', { name: `تلاش دوباره برای ${filename}`, exact: true }).click();
  const download = await complete;
  expect(download.suggestedFilename()).toBe(filename);
  expect(await download.failure()).toBeNull();
  const saved = await readFile((await download.path())!);
  expect(createHash('sha256').update(saved).digest('hex')).toBe(
    createHash('sha256').update(bytes).digest('hex'),
  );
  await expect(row.getByRole('status')).toHaveText('دریافت کامل شد');
  await expect(row.locator('.download-size')).toHaveText('1.00 MB / 1.00 MB');
  expect(requests).toBe(2);
  expect(errors).toEqual([]);
  await network.detach();
  await db.$disconnect();
});

test('uses an icon-only send button and supports Enter, Shift+Enter, touch keyboards and IME composition', async ({
  browser,
}) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const f = await fixtures();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const ticket = await db.ticket.create({
    data: { creatorId: f.student.id, departmentId: f.department.id, subject: 'ارسال با اینتر' },
  });
  await login(page, f.student.phoneNumber!, f.password);
  await page.goto(`/tickets/${ticket.id}`);
  const input = page.getByLabel('پاسخ شما', { exact: true }),
    send = page.getByRole('button', { name: 'ارسال پیام', exact: true });
  await expect(send).toHaveText('');
  await expect(send.locator('svg')).toHaveCount(1);
  await expect(input).toHaveAttribute('enterkeyhint', 'send');
  await input.fill('خط اول');
  await input.press('Shift+Enter');
  await input.pressSequentially('خط دوم');
  await expect(input).toHaveValue('خط اول\nخط دوم');
  expect(await db.message.count({ where: { ticketId: ticket.id } })).toBe(0);
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect(page.locator('.message-body')).toHaveText('خط اول\nخط دوم');
  expect(await db.message.count({ where: { ticketId: ticket.id } })).toBe(1);
  await input.fill('متن در حال ترکیب');
  await input.dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    isComposing: true,
    bubbles: true,
  });
  await expect(input).toHaveValue('متن در حال ترکیب');
  expect(await db.message.count({ where: { ticketId: ticket.id } })).toBe(1);
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect(page.locator('.message-body')).toHaveCount(2);
  await expect(send).toBeDisabled();
  await context.close();
  await db.$disconnect();
});
