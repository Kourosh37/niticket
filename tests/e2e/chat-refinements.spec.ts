import { test, expect, type Page } from '@playwright/test';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
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

async function login(page: Page, phoneNumber: string, password: string) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'ورود با رمز', exact: true }).click();
  await page.getByLabel('شماره موبایل', { exact: true }).fill(phoneNumber);
  await page.getByLabel('رمز عبور', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'ورود', exact: true }).click();
  await expect(page).toHaveURL(origin + '/');
}

test('shows the responsible contact photo, compact composer controls and vertically stacked attachments', async ({
  page,
}) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const { putObject } = await import('@niticket/core/infrastructure/storage');
  const f = await fixtures(),
    bytes = await readFile('tests/fixtures/photo.png'),
    objectKey = `clean/${randomUUID()}`;
  await putObject(objectKey, bytes, 'image/png');
  const avatar = await db.attachment.create({
    data: {
      uploaderId: f.manager.id,
      avatarOwnerId: f.manager.id,
      objectKey,
      filename: 'contact.png',
      declaredMime: 'image/png',
      detectedMime: 'image/png',
      expectedSize: bytes.length,
      size: bytes.length,
      scanStatus: 'CLEAN',
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  await db.user.update({
    where: { id: f.manager.id },
    data: { image: `/api/v1/avatars/${f.manager.id}`, avatarAttachmentId: avatar.id },
  });
  const ticket = await db.ticket.create({
    data: { creatorId: f.student.id, departmentId: f.department.id, subject: 'Chat details' },
  });
  const message = await db.message.create({
    data: { ticketId: ticket.id, senderId: f.student.id, body: 'پیوست‌های یک پیام' },
  });
  await db.attachment.createMany({
    data: Array.from({ length: 3 }, (_, i) => ({
      ticketId: ticket.id,
      messageId: message.id,
      uploaderId: f.student.id,
      objectKey: randomUUID(),
      filename: `document-${i}.txt`,
      declaredMime: 'text/plain',
      detectedMime: 'text/plain',
      expectedSize: 10,
      size: 10,
      scanStatus: 'CLEAN' as const,
      expiresAt: new Date(Date.now() + 86400000),
    })),
  });
  await login(page, f.student.phoneNumber!, f.password);
  await page.goto(`/tickets/${ticket.id}`);
  const photo = page.getByAltText(`تصویر ${f.manager.name}`, { exact: true });
  await expect(photo).toBeVisible();
  await expect
    .poll(() => photo.evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await expect(page.locator('.messenger-contact p')).toContainText(f.manager.name);
  const textarea = page.getByLabel('پاسخ شما', { exact: true });
  await textarea.fill(Array.from({ length: 30 }, () => 'متن طولانی').join('\n'));
  expect(await textarea.evaluate((node) => getComputedStyle(node).scrollbarWidth)).toBe('none');
  expect(
    await textarea.evaluate((node) => {
      node.scrollTop = 50;
      return node.scrollTop;
    }),
  ).toBeGreaterThan(0);
  await textarea.fill('آزمایش کادر پیام');
  const microphone = page.getByRole('button', { name: 'ضبط پیام صوتی', exact: true });
  await expect(microphone).toHaveText('');
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(photo).toBeInViewport();
    const send = (await page
        .getByRole('button', { name: 'ارسال پیام', exact: true })
        .boundingBox())!,
      mic = (await microphone.boundingBox())!,
      file = (await page.locator('label.messenger-attach').boundingBox())!;
    expect(Math.abs(send.y - mic.y)).toBeLessThan(2);
    expect(Math.abs(send.y - file.y)).toBeLessThan(2);
    const cards = page.locator('.message-attachments .attachment-card');
    await expect(cards).toHaveCount(3);
    for (let i = 1; i < 3; i++) {
      const prior = (await cards.nth(i - 1).boundingBox())!,
        next = (await cards.nth(i).boundingBox())!;
      expect(next.y).toBeGreaterThanOrEqual(prior.y + prior.height);
      expect(Math.abs(next.x - prior.x)).toBeLessThan(1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({ path: '.local/ui-preview/chat-refinements-light.png' });
  await page.getByRole('link', { name: 'تنظیمات', exact: true }).click();
  await page.getByRole('switch', { name: 'حالت تاریک' }).click();
  await page.goto(`/tickets/${ticket.id}`);
  await expect(photo).toBeVisible();
  await expect(page.locator('.attachment-card')).toHaveCount(3);
  await expect(page.getByText('پیوست‌های یک پیام', { exact: true })).toBeInViewport();
  await page.screenshot({ path: '.local/ui-preview/chat-refinements-dark.png' });
  await db.$disconnect();
});

test('shows double ticks only after visible counterparty views and never marks hidden or offscreen messages', async ({
  browser,
}) => {
  test.setTimeout(90000);
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const f = await fixtures(),
    ticket = await db.ticket.create({
      data: { creatorId: f.student.id, departmentId: f.department.id, subject: 'Visible receipts' },
    });
  const ids = Array.from({ length: 150 }, () => randomUUID()),
    start = Date.now() - 300000;
  await db.message.createMany({
    data: ids.map((id, i) => ({
      id,
      ticketId: ticket.id,
      senderId: f.student.id,
      body: `پیام رسید ${i}`,
      createdAt: new Date(start + i * 1000),
    })),
  });
  const sender = await browser.newContext(),
    recipient = await browser.newContext();
  const s = await sender.newPage(),
    r = await recipient.newPage();
  await login(s, f.student.phoneNumber!, f.password);
  await s.goto(`/tickets/${ticket.id}`);
  const latest = s.locator(`[data-message-id="${ids[149]}"]`);
  await expect(latest).toHaveAttribute('data-read', 'false');
  await login(r, f.agent.phoneNumber!, f.password);
  await r.addInitScript(() =>
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }),
  );
  await r.goto(`/tickets/${ticket.id}`);
  await expect(r.getByText('پیام رسید 149', { exact: true })).toBeInViewport();
  await r.waitForTimeout(1000); // Negative dwell assertion: a background tab must not acknowledge messages.
  expect((await db.message.findUniqueOrThrow({ where: { id: ids[149] } })).readAt).toBeNull();
  await r.bringToFront();
  await r.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  await r.getByLabel('پاسخ شما', { exact: true }).click();
  await expect
    .poll(async () => !!(await db.message.findUniqueOrThrow({ where: { id: ids[149] } })).readAt)
    .toBe(true);
  expect((await db.message.findUniqueOrThrow({ where: { id: ids[100] } })).readAt).toBeNull();
  expect(
    await db.message.count({ where: { ticketId: ticket.id, readAt: { not: null } } }),
  ).toBeLessThan(15);
  await s.bringToFront();
  await expect(latest).toHaveAttribute('data-read', 'true');
  await expect(latest.getByLabel('دیده شد', { exact: true })).toBeVisible();
  await r.bringToFront();
  await r.getByLabel('پاسخ شما', { exact: true }).fill('پاسخ دارای رسید');
  await r.getByRole('button', { name: 'ارسال پیام', exact: true }).click();
  await expect(r.getByText('پاسخ دارای رسید', { exact: true })).toBeVisible();
  await s.bringToFront();
  await expect(s.getByText('پاسخ دارای رسید', { exact: true })).toBeInViewport();
  const reply = await db.message.findFirstOrThrow({
    where: { ticketId: ticket.id, senderId: f.agent.id, body: 'پاسخ دارای رسید' },
  });
  await expect
    .poll(async () => !!(await db.message.findUniqueOrThrow({ where: { id: reply.id } })).readAt)
    .toBe(true);
  await r.bringToFront();
  await expect(r.locator(`[data-message-id="${reply.id}"]`)).toHaveAttribute('data-read', 'true');
  expect(
    (
      await r.request.post(`/api/v1/tickets/${ticket.id}/read`, {
        data: { messageIds: [ids[100]] },
      })
    ).status(),
  ).toBe(403);
  await sender.close();
  await recipient.close();
  await db.$disconnect();
});
