import { test, expect, type Page } from '@playwright/test';
import { loadEnvFile } from 'node:process';
import { randomUUID, randomInt } from 'node:crypto';

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

async function login(page: Page, phoneNumber: string, password: string) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'ورود با رمز', exact: true }).click();
  await page.getByLabel('شماره موبایل', { exact: true }).fill(phoneNumber);
  await page.getByLabel('رمز عبور', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'ورود', exact: true }).click();
  await expect(page).toHaveURL(origin + '/');
}

test('manages devices from an older valid login and logs out other devices immediately', async ({
  browser,
}) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const f = await fixtures(),
    current = await browser.newContext(),
    other = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
    });
  const page = await current.newPage();
  await login(page, f.student.phoneNumber!, f.password);
  expect(
    (
      await other.request.post('/api/auth/sign-in/phone-number', {
        headers: { origin },
        data: { phoneNumber: f.student.phoneNumber, password: f.password },
      })
    ).status(),
  ).toBe(200);
  const ownData = (await (await current.request.get('/api/v1/users/me/sessions')).json()).data;
  const otherId = (await (await other.request.get('/api/v1/users/me/sessions')).json()).data.current
    .id;
  await db.session.update({
    where: { id: ownData.current.id },
    data: { createdAt: new Date(Date.now() - 600000) },
  });
  await page.goto('/profile');
  const section = page.getByRole('region', { name: 'نشست‌های فعال' });
  await expect(section.getByText('این دستگاه', { exact: true })).toBeVisible();
  const otherCard = section.locator(`[data-session-id="${otherId}"]`);
  await expect(otherCard).toContainText('Safari 18');
  await expect(otherCard).toContainText('iOS');
  await expect(otherCard.getByText('زمان ورود', { exact: true })).toBeVisible();
  await expect(otherCard.getByText('آخرین فعالیت', { exact: true })).toBeVisible();
  page.on('dialog', (dialog) => dialog.accept());
  await otherCard.getByRole('button', { name: 'خروج از دستگاه', exact: true }).click();
  const proof = section.getByRole('group', { name: 'تأیید هویت برای ادامه عملیات' });
  await expect(otherCard).toHaveCount(0);
  await expect(proof).toHaveCount(0);
  expect((await other.request.get('/api/v1/users/me')).status()).toBe(401);
  expect((await current.request.get('/api/v1/users/me')).status()).toBe(200);
  for (let index = 0; index < 2; index++)
    expect(
      (
        await other.request.post('/api/auth/sign-in/phone-number', {
          headers: { origin },
          data: { phoneNumber: f.student.phoneNumber, password: f.password },
        })
      ).status(),
    ).toBe(200);
  await section.getByRole('button', { name: 'به‌روزرسانی نشست‌ها', exact: true }).click();
  await expect(section.getByRole('button', { name: 'خروج از دستگاه', exact: true })).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await section.screenshot({ path: '.local/ui-preview/account-sessions-390.png' });
  await section.getByRole('button', { name: 'خروج از همه دستگاه‌های دیگر', exact: true }).click();
  await expect(section.getByRole('button', { name: 'خروج از دستگاه', exact: true })).toHaveCount(0);
  expect(await db.session.count({ where: { userId: f.student.id } })).toBe(1);
  await section.getByRole('button', { name: 'خروج از این دستگاه', exact: true }).click();
  await expect(page).toHaveURL(origin + '/login');
  await current.close();
  await other.close();
  await db.$disconnect();
});

test('shows mobile numbers and navigates bounded user pages in both directions', async ({
  page,
}) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const f = await fixtures(),
    name = `BrowserUsers-${randomUUID()}`,
    root = randomUUID().slice(0, 8),
    number = `+989${randomInt(100000000, 999999999)}`;
  await db.user.createMany({
    data: Array.from({ length: 67 }, (_, index) => ({
      id: `${root}-0000-4000-8000-${String(index).padStart(12, '0')}`,
      name: `${name}-${index}`,
      email: `${randomUUID()}@identity.niticket.invalid`,
      ...(index === 0 ? { phoneNumber: number } : {}),
    })),
  });
  await login(page, f.admin.phoneNumber!, f.password);
  await page.goto(`/admin/users?q=${encodeURIComponent(name)}`);
  const rows = page.locator('.user-management-row');
  await expect(rows).toHaveCount(30);
  await expect(rows.first()).toContainText(number.replace('+98', '0'));
  await expect(rows.first().locator('.status')).toHaveText('کاربر · فعال');
  await expect(page.locator('body')).not.toContainText('دانشجو');
  await page.getByRole('link', { name: 'صفحه بعد', exact: true }).click();
  await expect(page.getByRole('heading', { name: `${name}-30`, exact: true })).toBeVisible();
  await expect(rows).toHaveCount(30);
  await page.getByRole('link', { name: 'صفحه بعد', exact: true }).click();
  await expect(rows).toHaveCount(7);
  await page.getByRole('link', { name: 'صفحه قبل', exact: true }).click();
  await expect(rows).toHaveCount(30);
  await expect(page.getByRole('heading', { name: `${name}-30`, exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'صفحه قبل', exact: true }).click();
  await expect(page.getByRole('heading', { name: `${name}-0`, exact: true })).toBeVisible();
  await page
    .getByRole('searchbox', { name: 'جستجوی کاربران', exact: true })
    .fill(`+98 ${number.slice(3)}`);
  await expect(page.getByRole('button', { name: 'جستجو', exact: true })).toHaveCount(0);
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText(number.replace('+98', '0'));
  await db.$disconnect();
});

function twoPagePdf() {
  const stream = (text: string) => {
    const content = `BT /F1 18 Tf 40 740 Td (${text}) Tj ET`;
    return `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  };
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
    stream('First page'),
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    stream('Second page'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let text = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(text));
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(text);
  text +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
      .join('');
  return Buffer.from(
    text + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  );
}

test('downloads and parses a PDF only once while changing its preview pages', async ({ page }) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const { openConversation, addMessage } = await import('@niticket/core/application/tickets');
  const { createUpload, completeUpload } = await import('@niticket/core/application/attachments');
  const { processScan } = await import('@niticket/core/application/jobs');
  const f = await fixtures(),
    actor = await f.actor(f.student.id),
    ticket = await openConversation(actor, { departmentId: f.department.id });
  const message = await addMessage(actor, ticket.id, {
    version: 1,
    body: 'پیش‌نمایش فایل چندصفحه‌ای',
  });
  const bytes = twoPagePdf(),
    upload = await createUpload(actor, {
      ticketId: ticket.id,
      messageId: message.id,
      filename: 'pages.pdf',
      mime: 'application/pdf',
      size: bytes.length,
    });
  expect(
    (
      await fetch(upload.url!, {
        method: 'PUT',
        headers: { 'content-type': 'application/pdf' },
        body: bytes,
      })
    ).ok,
  ).toBe(true);
  await completeUpload(actor, upload.id);
  const event = await db.outboxEvent.findFirstOrThrow({
    where: { type: 'SCAN_ATTACHMENT', payload: { path: ['attachmentId'], equals: upload.id } },
  });
  await processScan(event.id, event.payload);
  let downloads = 0;
  page.on('request', (request) => {
    if (request.url().includes(`/attachments/${upload.id}/access`)) downloads++;
  });
  await login(page, f.student.phoneNumber!, f.password);
  await page.goto(`/tickets/${ticket.id}`);
  await page.getByRole('button', { name: 'پیش‌نمایش pages.pdf', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'پیش‌نمایش فایل' });
  await expect(dialog.getByRole('button', { name: 'صفحه بعدی', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'صفحه بعدی', exact: true }).click();
  await expect(dialog.getByText('صفحه ۲ از ۲', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('status')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'صفحه قبلی', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveCount(0);
  expect(downloads).toBe(1);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await db.$disconnect();
});
