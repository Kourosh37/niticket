import { test, expect } from '@playwright/test';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';

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

test.use({ actionTimeout: 15000 });

test('manages a minimal media library, searches and sends a complete saved reply without losing the current draft', async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const { processScan } = await import('@niticket/core/application/jobs');
  const { scanInContainer } = await import('../helpers/scan-in-container');
  const f = await fixtures();
  const ticket = await db.ticket.create({
    data: {
      departmentId: f.department.id,
      creatorId: f.student.id,
      subject: 'پاسخ آماده',
      messages: { create: { senderId: f.student.id, body: 'درخواست راهنما' } },
    },
  });
  expect(
    (
      await page.request.post('/api/auth/sign-in/phone-number', {
        headers: { origin },
        data: { phoneNumber: f.agent.phoneNumber, password: f.password },
      })
    ).ok(),
  ).toBe(true);
  await page.context().grantPermissions(['microphone']);
  await page.goto('/settings');
  await page.getByRole('link', { name: /پیام‌های آماده/ }).click();
  await expect(page.getByRole('heading', { name: 'پیام‌های آماده', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'پیام جدید', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'پیام آماده جدید', exact: true });
  const title = `راهنمای واحد ${randomUUID().slice(0, 8)}`;
  await editor.getByLabel('عنوان پیام آماده', { exact: true }).fill(title);
  await editor
    .getByLabel('متن پیام آماده', { exact: true })
    .fill('متن پاسخ آماده همراه عکس، سند، ویدیو و صدا');
  await editor
    .getByLabel('پیوست پیام آماده', { exact: true })
    .setInputFiles([
      'tests/fixtures/photo.png',
      'tests/fixtures/document.pdf',
      'tests/fixtures/video.webm',
    ]);
  await editor.getByRole('button', { name: 'ضبط پیام صوتی', exact: true }).click();
  await page.waitForTimeout(1100);
  await editor.getByRole('button', { name: 'پایان ضبط', exact: true }).click();
  await expect(editor.getByLabel('پیش‌شنوی پیام صوتی', { exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'ذخیره پیام آماده', exact: true }).click();
  await expect(editor).toHaveCount(0, { timeout: 30000 });
  const reply = await db.savedReply.findFirstOrThrow({
    where: { title },
    include: { attachments: true },
  });
  expect(reply.attachments).toHaveLength(4);
  for (const attachment of reply.attachments) {
    const event = await db.outboxEvent.findFirstOrThrow({
      where: {
        type: 'SCAN_ATTACHMENT',
        payload: { path: ['attachmentId'], equals: attachment.id },
      },
    });
    if (/^(audio|video)\//.test(attachment.declaredMime)) await scanInContainer(event.id);
    else await processScan(event.id, event.payload);
  }
  await page
    .getByRole('searchbox', { name: 'جستجو در پیام‌های آماده', exact: true })
    .fill('پیدا نمی‌شود');
  await expect(page.getByText('پیامی پیدا نشد.', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/tickets/${ticket.id}`);
  const draft = page.getByLabel('پاسخ شما', { exact: true });
  await draft.fill('پیش‌نویس من باقی بماند');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'پیام‌های آماده', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'پیام‌های آماده', exact: true });
  await picker
    .getByRole('searchbox', { name: 'جستجو در پیام‌های آماده', exact: true })
    .fill('راهنما');
  await picker.getByRole('button', { name: `انتخاب ${title}`, exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(picker.getByLabel('پیش‌نمایش پیام آماده', { exact: true })).toContainText(
    reply.body,
  );
  await expect(picker.locator('video')).toHaveAttribute('preload', 'none');
  await picker.getByRole('button', { name: 'ارسال پیام آماده', exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(draft).toHaveValue('پیش‌نویس من باقی بماند');
  await expect(page.getByText(reply.body, { exact: true })).toBeVisible();
  const sent = await db.message.findFirstOrThrow({
    where: { ticketId: ticket.id, savedReplyId: reply.id },
    include: { attachments: true },
  });
  expect(sent.attachments).toHaveLength(4);
  expect(
    sent.attachments.every(
      (file) => !reply.attachments.some((original) => original.id === file.id),
    ),
  ).toBe(true);
  const student = await browser.newContext();
  expect(
    (
      await student.request.post('/api/auth/sign-in/phone-number', {
        headers: { origin },
        data: { phoneNumber: f.student.phoneNumber, password: f.password },
      })
    ).ok(),
  ).toBe(true);
  const recipient = await student.newPage();
  await recipient.goto(`/tickets/${ticket.id}`);
  await expect(recipient.getByText(reply.body, { exact: true })).toBeVisible();
  const video = sent.attachments.find((file) => file.detectedMime === 'video/webm')!;
  await expect(recipient.getByLabel(`ویدیو ${video.filename}`, { exact: true })).toBeVisible();
  const range = await student.request.get(`/api/v1/attachments/${video.id}/access`, {
    headers: { range: 'bytes=0-15' },
  });
  expect(range.status()).toBe(206);
  expect((await range.body()).length).toBe(16);
  expect(
    (await student.request.get(`/api/v1/attachments/${reply.attachments[0].id}/access`)).status(),
  ).toBe(403);
  await page.goto('/saved-replies');
  await page
    .getByRole('button', { name: `ویرایش ${title}`, exact: true })
    .first()
    .click();
  await page.getByLabel('متن پیام آماده', { exact: true }).fill('متن جدید کتابخانه');
  await page.getByRole('button', { name: 'ذخیره پیام آماده', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: `حذف ${title}`, exact: true }).click();
  await page
    .getByRole('dialog', { name: 'حذف پیام آماده', exact: true })
    .getByRole('button', { name: 'حذف پیام آماده', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await recipient.reload();
  await expect(recipient.getByText(reply.body, { exact: true })).toBeVisible();
  expect((await student.request.get(`/api/v1/attachments/${video.id}/access`)).ok()).toBe(true);
  await student.close();
  await db.$disconnect();
});

test('hides the saved reply library from requesters and administrators and rejects forged send references', async ({
  page,
}) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const { createSavedReply } = await import('@niticket/core/application/saved-replies');
  const f = await fixtures();
  const reply = await createSavedReply(await f.actor(f.agent.id), {
    departmentId: f.department.id,
    clientId: randomUUID(),
    title: 'PRIVATE_LIBRARY',
    body: 'PRIVATE_BODY',
  });
  const ticket = await db.ticket.create({
    data: { creatorId: f.student.id, departmentId: f.department.id, subject: 'Access' },
  });
  for (const user of [f.student, f.admin]) {
    expect(
      (
        await page.request.post('/api/auth/sign-in/phone-number', {
          headers: { origin },
          data: { phoneNumber: user.phoneNumber, password: f.password },
        })
      ).ok(),
    ).toBe(true);
    await page.goto(`/tickets/${ticket.id}`);
    await expect(page.getByRole('button', { name: 'پیام‌های آماده', exact: true })).toHaveCount(0);
    expect((await page.request.get('/api/v1/saved-replies')).status()).toBe(403);
    expect((await page.request.get(`/api/v1/saved-replies/${reply.id}`)).status()).toBe(403);
    expect(
      (
        await page.request.post(`/api/v1/tickets/${ticket.id}/messages`, {
          headers: { origin },
          data: { version: 1, savedReplyId: reply.id, clientId: randomUUID() },
        })
      ).status(),
    ).toBe(403);
    await page.goto('/saved-replies');
    await expect(page.getByRole('heading', { name: 'پیام‌های آماده', exact: true })).toHaveCount(0);
    await page.request.post('/api/auth/sign-out', { headers: { origin }, data: {} });
  }
  expect(await db.message.count({ where: { ticketId: ticket.id } })).toBe(0);
  await db.$disconnect();
});
