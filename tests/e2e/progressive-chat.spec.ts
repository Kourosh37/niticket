import { test, expect, type Page } from '../helpers/e2e-test';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

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

async function login(page: Page, phone: string, password: string) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'ورود با رمز', exact: true }).click();
  await page.getByLabel('شماره موبایل', { exact: true }).fill(phone);
  await page.getByLabel('رمز عبور', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'ورود', exact: true }).click();
  await expect(page).toHaveURL(origin + '/');
}

test('accepts local, zero-less and spaced international numbers in the UI and requests a numeric keyboard', async ({
  browser,
}) => {
  const { fixtures } = await import('../helpers/fixtures');

  const f = await fixtures(),
    number = f.student.phoneNumber!;
  for (const value of [number.replace('+98', '0'), number.slice(3), `+98 ${number.slice(3)}`]) {
    const context = await browser.newContext(),
      page = await context.newPage();
    await login(page, value, f.password);
    await context.close();
  }
  const context = await browser.newContext(),
    page = await context.newPage();
  await page.goto('/login');
  const input = page.getByLabel('شماره موبایل', { exact: true });
  await expect(input).toHaveAttribute('inputmode', 'numeric');
  await expect(input).toHaveAttribute('type', 'tel');
  await input.fill(`+98 ${number.slice(3)}`);
  const sent = page.waitForRequest((r) => r.url().endsWith('/phone-number/send-otp'));
  await page.getByRole('button', { name: 'دریافت کد ورود', exact: true }).click();
  expect((await sent).postDataJSON()).toEqual({ phoneNumber: number });
  const codeInput = page.getByLabel('کد ۶ رقمی', { exact: true });
  await expect(codeInput).toHaveAttribute('inputmode', 'numeric');
  await expect(codeInput).toHaveAttribute('autocomplete', 'one-time-code');
  let code = '';
  await expect
    .poll(async () => {
      for (const line of (await readFile('.local/e2e-auth.log', 'utf8')).split('\n').reverse()) {
        try {
          const row = JSON.parse(line);
          if (row.event === 'sms.otp' && row.phoneNumber === number) {
            code = row.otpCode;
            break;
          }
        } catch {
          /* Other logs. */
        }
      }
      return !!code;
    })
    .toBe(true);
  await codeInput.fill(code.replace(/\d/g, (digit) => String.fromCharCode(1776 + Number(digit))));
  await expect(codeInput).toHaveValue(code);
  await page.getByRole('button', { name: 'ورود', exact: true }).click();
  await expect(page).toHaveURL(origin + '/');
  await context.close();
});

test('uses a bottom desktop dock and fills the available workspace with responsive cards', async ({
  page,
}) => {
  const { fixtures } = await import('../helpers/fixtures');

  const f = await fixtures();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await login(page, f.student.phoneNumber!, f.password);
  await expect(page.getByRole('region', { name: 'فهرست گفتگوها', exact: true })).toBeVisible();
  const dock = page.getByRole('navigation', { name: 'ناوبری اصلی' });
  const dockBox = (await dock.boundingBox())!,
    mainBox = (await page.locator('main').boundingBox())!;
  expect(dockBox.y).toBeGreaterThan(950);
  expect(mainBox.width).toBeGreaterThan(1300);
  await page.screenshot({ path: '.local/ui-preview/desktop-inbox-1920.png', fullPage: true });
  await page.goto('/profile');
  const forms = page.locator('.easy-profile > form'),
    a = (await forms.nth(0).boundingBox())!,
    b = (await forms.nth(1).boundingBox())!;
  expect(Math.abs(a.y - b.y)).toBeLessThan(2);
  expect(a.x).toBeGreaterThan(b.x + b.width);
  await page.screenshot({ path: '.local/ui-preview/desktop-profile-1920.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await forms.nth(1).boundingBox())!.y).toBeGreaterThan(
    (await forms.nth(0).boundingBox())!.y,
  );
});

test('keeps a 2000-message chat bounded, defers history and audio downloads, and preserves typing during paging', async ({
  page,
}) => {
  test.setTimeout(90000);
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const { putObject } = await import('@niticket/core/infrastructure/storage');
  const f = await fixtures();
  const ticket = await db.ticket.create({
    data: {
      creatorId: f.student.id,
      departmentId: f.department.id,
      subject: 'گفتگوی طولانی برای آزمون رندر',
    },
  });
  const start = Date.now() - 3_000_000;
  await db.message.createMany({
    data: Array.from({ length: 2000 }, (_, index) => ({
      ticketId: ticket.id,
      senderId: f.student.id,
      body: `بارگذاری تدریجی ${index}: ${'پیام آزمایشی با ارتفاع متغیر. '.repeat((index % 4) + 1)}`,
      createdAt: new Date(start + index * 1000),
    })),
  });
  const last = await db.message.findFirstOrThrow({
    where: { ticketId: ticket.id },
    orderBy: { createdAt: 'desc' },
  });
  // A short valid silent WAV fixture; scanner correctness is covered by media integration tests.
  const wav = Buffer.alloc(320044);
  wav.write('RIFF');
  wav.writeUInt32LE(320036, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(320000, 40);
  const key = `clean/${randomUUID()}`;
  await putObject(key, wav, 'audio/wav');
  const attachment = await db.attachment.create({
    data: {
      ticketId: ticket.id,
      messageId: last.id,
      uploaderId: f.student.id,
      filename: 'lazy.wav',
      objectKey: key,
      declaredMime: 'audio/wav',
      detectedMime: 'audio/wav',
      expectedSize: wav.length,
      size: wav.length,
      durationSeconds: 20,
      waveform: Array(80).fill(0),
      scanStatus: 'CLEAN',
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  const mediaRequests: string[] = [],
    historyRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes(`/attachments/${attachment.id}/access`)) mediaRequests.push(r.url());
    if (r.url().includes(`/tickets/${ticket.id}/history`)) historyRequests.push(r.url());
  });
  await login(page, f.student.phoneNumber!, f.password);
  await page.goto(`/tickets/${ticket.id}`);
  await expect(page.locator(`[data-message-id="${last.id}"]`)).toBeInViewport();
  await expect(page.locator('[data-testid="virtuoso-item-list"]')).toHaveCSS(
    'visibility',
    'visible',
  );
  expect(await page.locator('[data-message-id]').count()).toBeLessThan(40);
  expect(mediaRequests).toHaveLength(0);
  expect(historyRequests).toHaveLength(0);
  await page.getByRole('button', { name: 'پخش پیام صوتی', exact: true }).click();
  await expect.poll(() => mediaRequests.length).toBeGreaterThan(0);
  const area = page.locator('.messenger-scroll');
  for (let i = 0; i < 3; i++) {
    await area.evaluate((el) => {
      el.scrollTop = 0;
    });
    const older = page.getByRole('button', { name: 'پیام‌های قبلی', exact: true });
    await expect(older).toBeInViewport();
    const response = page.waitForResponse(
      (r) => r.url().includes(`/tickets/${ticket.id}/messages?cursor=`) && r.status() === 200,
    );
    await older.click();
    expect((await (await response).json()).data.items).toHaveLength(50);
    expect(await page.locator('[data-message-id]').count()).toBeLessThan(40);
  }
  await expect(page.getByRole('button', { name: 'مکث پخش صوتی فعال', exact: true })).toBeVisible();
  const draft = page.getByLabel('پاسخ شما', { exact: true });
  await draft.fill('تایپ در گفتگوی طولانی بدون بازسازی تاریخچه');
  await expect(draft).toHaveValue('تایپ در گفتگوی طولانی بدون بازسازی تاریخچه');
  expect(historyRequests).toHaveLength(0);
});
