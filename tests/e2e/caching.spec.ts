import { test, expect, type BrowserContext } from '@playwright/test';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { version } from 'pdfjs-dist/package.json';

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

async function login(context: BrowserContext, phoneNumber: string | null, password: string) {
  expect(
    (
      await context.request.post('/api/auth/sign-in/phone-number', {
        headers: { origin },
        data: { phoneNumber, password },
      })
    ).ok(),
  ).toBe(true);
}

test('serves immutable versioned public assets while reauthorizing every private conditional request', async ({
  browser,
}) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const { putObject } = await import('@niticket/core/infrastructure/storage');
  const f = await fixtures();
  const ticket = await db.ticket.create({
    data: { creatorId: f.student.id, departmentId: f.department.id, subject: 'cache privacy' },
  });
  const key = `clean/${randomUUID()}`,
    bytes = Buffer.from('private approved bytes');
  await putObject(key, bytes, 'text/plain');
  const file = await db.attachment.create({
    data: {
      ticketId: ticket.id,
      uploaderId: f.student.id,
      objectKey: key,
      filename: 'private.txt',
      declaredMime: 'text/plain',
      detectedMime: 'text/plain',
      expectedSize: bytes.length,
      size: bytes.length,
      scanStatus: 'CLEAN',
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  const owner = await browser.newContext(),
    outsider = await browser.newContext();
  try {
    await login(owner, f.student.phoneNumber, f.password);
    await login(outsider, f.outsider.phoneNumber, f.password);
    const asset = await owner.request.head(`/pdf-assets/releases/${version}/pdf.worker.min.mjs`);
    expect(asset.status()).toBe(200);
    expect(asset.headers()['cache-control']).toContain('immutable');
    const path = `/api/v1/attachments/${file.id}/access`;
    const first = await owner.request.get(path),
      etag = first.headers().etag;
    expect(first.status()).toBe(200);
    expect(first.headers()['cache-control']).toBe('private, no-cache, no-transform');
    expect((await first.body()).equals(bytes)).toBe(true);
    expect((await owner.request.get(path, { headers: { 'if-none-match': etag } })).status()).toBe(
      304,
    );
    const head = await owner.request.head(path);
    expect(head.status()).toBe(200);
    expect(head.headers().etag).toBe(etag);
    expect((await head.body()).byteLength).toBe(0);
    // Next.js owns response framing and may omit Content-Length on dynamic HEAD routes.
    if (head.headers()['content-length'])
      expect(head.headers()['content-length']).toBe(String(bytes.length));
    expect(
      (await outsider.request.get(path, { headers: { 'if-none-match': etag } })).status(),
    ).toBe(404);
    const session = (await (await owner.request.get('/api/v1/users/me/sessions')).json()).data
      .current.id;
    await db.session.delete({ where: { id: session } });
    const revoked = await owner.request.get(path, { headers: { 'if-none-match': etag } });
    expect(revoked.status()).toBe(401);
    expect(revoked.headers()['cache-control']).toBe('no-store');
  } finally {
    await owner.close();
    await outsider.close();
    await db.$disconnect();
  }
});

test('reopens and downloads a retained PDF without another binary transfer but checks access each time', async ({
  page,
}) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const { putObject } = await import('@niticket/core/infrastructure/storage');
  const f = await fixtures();
  const ticket = await db.ticket.create({
    data: { creatorId: f.student.id, departmentId: f.department.id, subject: 'warm document' },
  });
  const message = await db.message.create({
    data: { ticketId: ticket.id, senderId: f.student.id, body: 'پیش‌نمایش سند مجاز' },
  });
  const bytes = await readFile('tests/fixtures/persian.pdf'),
    key = `clean/${randomUUID()}`;
  await putObject(key, bytes, 'application/pdf');
  const file = await db.attachment.create({
    data: {
      ticketId: ticket.id,
      messageId: message.id,
      uploaderId: f.student.id,
      objectKey: key,
      filename: 'cached.pdf',
      declaredMime: 'application/pdf',
      detectedMime: 'application/pdf',
      expectedSize: bytes.length,
      size: bytes.length,
      scanStatus: 'CLEAN',
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  try {
    await login(page.context(), f.student.phoneNumber, f.password);
    let binary = 0,
      proofs = 0;
    page.on('request', (request) => {
      if (request.url().endsWith(`/attachments/${file.id}/access`)) binary++;
      if (request.url().endsWith(`/attachments/${file.id}/metadata`)) proofs++;
    });
    await page.goto(`/tickets/${ticket.id}`);
    const open = page.getByRole('button', { name: 'پیش‌نمایش cached.pdf', exact: true });
    await open.click();
    const dialog = page.getByRole('dialog', { name: 'پیش‌نمایش فایل', exact: true });
    await expect(dialog.locator('canvas').first()).toBeVisible();
    await dialog.getByRole('button', { name: 'بستن', exact: true }).click();
    await open.click();
    await expect(dialog.locator('canvas').first()).toBeVisible();
    expect(binary).toBe(1);
    expect(proofs).toBeGreaterThanOrEqual(2);
    const downloaded = page.waitForEvent('download');
    await dialog.locator('.preview-footer').getByRole('button').click();
    expect((await downloaded).suggestedFilename()).toBe('cached.pdf');
    expect(binary).toBe(1);
  } finally {
    await db.$disconnect();
  }
});

test('restores an authorized old message window, reading anchor and text draft across navigation', async ({
  page,
}) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const f = await fixtures();
  const ticket = await db.ticket.create({
    data: { creatorId: f.student.id, departmentId: f.department.id, subject: 'warm conversation' },
  });
  await db.message.createMany({
    data: Array.from({ length: 120 }, (_, i) => ({
      ticketId: ticket.id,
      senderId: f.student.id,
      body: `Cached message ${i}`,
      createdAt: new Date(Date.now() - 200000 + i * 1000),
    })),
  });
  try {
    await login(page.context(), f.student.phoneNumber, f.password);
    await page.goto(`/tickets/${ticket.id}`);
    const area = page.getByLabel('پیام‌های گفتگو', { exact: true });
    await expect(page.getByText('Cached message 119', { exact: true })).toBeInViewport();
    await area.hover();
    await page.mouse.wheel(0, -100000);
    const older = page.waitForResponse((response) =>
      response.url().includes(`/tickets/${ticket.id}/messages?cursor=`),
    );
    await page.getByRole('button', { name: 'پیام‌های قبلی', exact: true }).click();
    expect((await older).ok()).toBe(true);
    await expect(page.getByText('Cached message 70', { exact: true })).toBeInViewport();
    await area.press('Control+Home');
    await expect(page.getByText('Cached message 20', { exact: true })).toBeInViewport();
    await page.getByLabel('پاسخ شما', { exact: true }).fill('پیش‌نویس برای بازگشت');
    await page.getByRole('link', { name: 'بازگشت به گفتگوها', exact: true }).click();
    await page.locator(`a[href="/tickets/${ticket.id}"]`).first().click();
    await expect(page.getByLabel('پاسخ شما', { exact: true })).toHaveValue('پیش‌نویس برای بازگشت');
    await expect(page.getByText('Cached message 20', { exact: true })).toBeInViewport();
    expect(await page.locator('[data-message-id]').count()).toBeLessThan(40);
    await page.reload();
    await expect(page.getByLabel('پاسخ شما', { exact: true })).toHaveValue('پیش‌نویس برای بازگشت');
    await page.getByRole('button', { name: 'ارسال پیام', exact: true }).click();
    await expect(page.getByLabel('پاسخ شما', { exact: true })).toHaveValue('');
    await page.reload();
    await expect(page.getByLabel('پاسخ شما', { exact: true })).toHaveValue('');
  } finally {
    await db.$disconnect();
  }
});

test('invalidates warm unit choices when catalog metadata changes', async ({ page }) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const { saveDepartment } = await import('@niticket/core/application/administration');
  const f = await fixtures();
  try {
    await login(page.context(), f.student.phoneNumber, f.password);
    await page.goto('/tickets/new');
    const search = page.getByLabel('جستجوی واحد', { exact: true });
    await search.fill(f.department.name);
    await expect(
      page.getByRole('button', { name: `انتخاب ${f.department.name}`, exact: true }),
    ).toBeVisible();
    const next = `واحد تازه ${randomUUID().slice(0, 8)}`;
    await saveDepartment(await f.actor(f.admin.id), { name: next }, f.department.id);
    await expect(
      page.getByRole('button', { name: `انتخاب ${f.department.name}`, exact: true }),
    ).toHaveCount(0);
    await search.fill(next);
    await expect(page.getByRole('button', { name: `انتخاب ${next}`, exact: true })).toBeVisible();
  } finally {
    await db.$disconnect();
  }
});

test('removes persisted drafts when signing out from a freshly loaded settings document', async ({
  page,
}) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const f = await fixtures();
  const ticket = await db.ticket.create({
    data: { creatorId: f.student.id, departmentId: f.department.id, subject: 'draft logout' },
  });
  try {
    await login(page.context(), f.student.phoneNumber, f.password);
    await page.goto(`/tickets/${ticket.id}`);
    await page.getByLabel('پاسخ شما', { exact: true }).fill('پیش‌نویس محرمانه');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            Object.keys(sessionStorage).filter((key) => key.startsWith('niticket:draft:')).length,
        ),
      )
      .toBe(1);
    // A hard navigation starts fresh modules without loading the conversation component.
    await page.goto('/settings');
    await page.getByRole('button', { name: 'خروج از حساب', exact: true }).click();
    await expect(page).toHaveURL(origin + '/login');
    expect(
      await page.evaluate(
        () => Object.keys(sessionStorage).filter((key) => key.startsWith('niticket:draft:')).length,
      ),
    ).toBe(0);
    await login(page.context(), f.student.phoneNumber, f.password);
    await page.goto(`/tickets/${ticket.id}`);
    await expect(page.getByLabel('پاسخ شما', { exact: true })).toHaveValue('');
  } finally {
    await db.$disconnect();
  }
});
