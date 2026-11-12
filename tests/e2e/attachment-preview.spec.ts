import { test, expect, type Page } from '@playwright/test';
import { loadEnvFile } from 'node:process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import sharp from 'sharp';

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

let account: { phone: string; password: string; ticketId: string; pdfId: string };
test.use({ deviceScaleFactor: 2 });

test.beforeAll(async () => {
  test.setTimeout(120000);
  mkdirSync('.local/ui-preview', { recursive: true });
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const { openConversation, addMessage } = await import('@niticket/core/application/tickets');
  const { createUpload, completeUpload } = await import('@niticket/core/application/attachments');
  const { processScan } = await import('@niticket/core/application/jobs');
  const f = await fixtures(),
    actor = await f.actor(f.student.id);
  const ticket = await openConversation(actor, { departmentId: f.department.id });
  const message = await addMessage(actor, ticket.id, {
    version: 1,
    body: 'فایل‌های آزمایشی پیش‌نمایش',
  });
  const word = unzipSync(new Uint8Array(readFileSync('tests/fixtures/document.docx')));
  word['word/document.xml'] = strToU8(
    strFromU8(word['word/document.xml']).replace(
      '<w:p><w:r><w:t>NITicket Word preview</w:t></w:r></w:p>',
      Array.from(
        { length: 150 },
        (_, i) => `<w:p><w:r><w:t>سطر ${i + 1} از سند بلند فارسی</w:t></w:r></w:p>`,
      ).join(''),
    ),
  );
  const sheet = unzipSync(new Uint8Array(readFileSync('tests/fixtures/sheet.xlsx')));
  sheet['xl/worksheets/sheet1.xml'] = strToU8(
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${Array.from({ length: 300 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>Row ${i + 1}</t></is></c></row>`).join('')}</sheetData></worksheet>`,
  );
  const files = [
    ['persian.pdf', 'application/pdf', readFileSync('tests/fixtures/persian.pdf')],
    [
      'long.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      zipSync(word),
    ],
    [
      'long.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      zipSync(sheet),
    ],
    [
      'tall.png',
      'image/png',
      await sharp({ create: { width: 320, height: 2400, channels: 3, background: '#315c70' } })
        .png()
        .toBuffer(),
    ],
  ] as const;
  let pdfId = '';
  for (const [filename, mime, bytes] of files) {
    const upload = await createUpload(actor, {
      ticketId: ticket.id,
      messageId: message.id,
      filename,
      mime,
      size: bytes.length,
    });
    expect(
      (
        await fetch(upload.url!, {
          method: 'PUT',
          headers: { 'content-type': mime },
          body: Buffer.from(bytes),
        })
      ).ok,
    ).toBe(true);
    await completeUpload(actor, upload.id);
    const event = await db.outboxEvent.findFirstOrThrow({
      where: { type: 'SCAN_ATTACHMENT', payload: { path: ['attachmentId'], equals: upload.id } },
    });
    await processScan(event.id, event.payload);
    expect((await db.attachment.findUniqueOrThrow({ where: { id: upload.id } })).scanStatus).toBe(
      'CLEAN',
    );
    if (filename === 'persian.pdf') pdfId = upload.id;
  }
  account = { phone: f.student.phoneNumber!, password: f.password, ticketId: ticket.id, pdfId };
});

test.afterAll(async () => {
  const { db } = await import('@niticket/database');
  await db.$disconnect();
});

async function openChat(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'ورود با رمز', exact: true }).click();
  await page.getByLabel('شماره موبایل', { exact: true }).fill(account.phone);
  await page.getByLabel('رمز عبور', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'ورود', exact: true }).click();
  await expect(page).toHaveURL(origin + '/');
  await page.goto(`/tickets/${account.ticketId}`);
}

test('scrolls through Persian PDF pages with embedded fonts, sharp canvases and responsive sizing', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (/Failed to load font|violates.*font-src|Cannot load.*font/i.test(message.text()))
      errors.push(message.text());
  });
  let downloads = 0;
  page.on('request', (request) => {
    if (request.url().includes(`/attachments/${account.pdfId}/access`)) downloads++;
  });
  await openChat(page);
  await page.getByRole('button', { name: 'پیش‌نمایش persian.pdf', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'پیش‌نمایش فایل', exact: true });
  const reader = dialog.getByRole('region', { name: 'صفحات فایل پی‌دی‌اف', exact: true });
  const canvas = dialog.locator('.page[data-page-number="1"] canvas').first();
  await expect(dialog.getByRole('status')).toHaveCount(0);
  await expect(canvas).toBeVisible();
  // These are the two embedded Arabic/Latin fonts, not the application's UI fonts.
  expect(
    await page.evaluate(
      () =>
        [...document.fonts].filter((font) => /^g_d/.test(font.family) && font.status === 'loaded')
          .length,
    ),
  ).toBeGreaterThanOrEqual(2);
  const raster = await canvas.evaluate((element: HTMLCanvasElement) => ({
    pixels: element.width,
    width: element.getBoundingClientRect().width,
  }));
  expect(raster.pixels / raster.width).toBeGreaterThan(1.9);
  await expect(reader).toHaveCSS('scrollbar-width', 'none');
  expect(await reader.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
    true,
  );
  const rendered = await canvas.evaluate((element: HTMLCanvasElement) =>
    element.toDataURL('image/png'),
  );
  writeFileSync(
    '.local/ui-preview/persian-pdf-canvas.png',
    Buffer.from(rendered.split(',')[1], 'base64'),
  );
  await reader.hover();
  await page.mouse.wheel(0, 1600);
  await expect(dialog.getByText('صفحه ۲ از ۲', { exact: true })).toBeVisible();
  await expect(dialog.locator('.page[data-page-number="2"] canvas').first()).toBeVisible();
  expect(downloads).toBe(1);
  await dialog.getByRole('button', { name: 'صفحه قبلی', exact: true }).click();
  await expect(dialog.getByText('صفحه ۱ از ۲', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 600 });
  await expect
    .poll(() =>
      dialog
        .locator('.page[data-page-number="1"]')
        .evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBeLessThan(350);
  await expect(dialog.getByRole('button', { name: 'بستن', exact: true })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: /دریافت /, exact: false })).toBeInViewport();
  await page.screenshot({
    path: '.local/ui-preview/persian-pdf-mobile.png',
    animations: 'disabled',
  });
  await dialog.getByRole('button', { name: 'بزرگ‌نمایی', exact: true }).click();
  await expect
    .poll(() => reader.evaluate((element) => element.scrollWidth > element.clientWidth))
    .toBe(true);
  await dialog.getByRole('button', { name: 'اندازه عرض صفحه', exact: true }).click();
  await expect
    .poll(() => reader.evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBeLessThan(3);
  await dialog.getByRole('button', { name: 'بستن', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => [...document.fonts].filter((font) => /^g_d/.test(font.family)).length),
    )
    .toBe(0);
  await page.getByRole('button', { name: 'پیش‌نمایش persian.pdf', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveCount(0);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  expect(downloads).toBe(2);
  expect(errors).toEqual([]);
});

test('allows embedded Persian fonts through the CSS font-loading fallback under production CSP', async ({
  page,
}) => {
  await openChat(page);
  // Exercise PDF.js's supported @font-face path, used without the Font Loading API.
  await page.evaluate(() => {
    Object.defineProperty(document, 'fonts', { value: undefined, configurable: true });
    Object.assign(window, { blockedFonts: [] });
    document.addEventListener('securitypolicyviolation', (event) => {
      if (event.effectiveDirective === 'font-src')
        (window as unknown as { blockedFonts: string[] }).blockedFonts.push(event.blockedURI);
    });
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (/Failed to load font|violates.*font-src/.test(message.text())) errors.push(message.text());
  });
  await page.getByRole('button', { name: 'پیش‌نمایش persian.pdf', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'پیش‌نمایش فایل', exact: true });
  await expect(dialog.getByRole('status')).toHaveCount(0);
  await expect(dialog.locator('canvas').first()).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { blockedFonts: string[] }).blockedFonts),
  ).toEqual([]);
  expect(errors).toEqual([]);
});

test('scrolls long Word, spreadsheet and image content inside the modal without moving its controls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 560 });
  await openChat(page);
  for (const filename of ['long.docx', 'long.xlsx', 'tall.png']) {
    await page
      .getByRole('button', { name: `پیش‌نمایش ${filename}`, exact: true })
      .first()
      .click();
    const dialog = page.getByRole('dialog', { name: 'پیش‌نمایش فایل', exact: true });
    await expect(dialog.getByRole('status')).toHaveCount(0);
    const reader = dialog.getByRole('region');
    if (filename.endsWith('.png'))
      await expect(dialog.locator('img')).toHaveJSProperty('complete', true);
    expect(await reader.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
      true,
    );
    await expect(reader).toHaveCSS('scrollbar-width', 'none');
    const controls = dialog.getByRole('button', { name: 'بستن', exact: true });
    const before = await controls.boundingBox();
    await reader.focus();
    await page.keyboard.press('Control+End');
    await expect.poll(() => reader.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(controls).toBeInViewport();
    expect(await controls.boundingBox()).toEqual(before);
    await expect(dialog.getByRole('button', { name: /دریافت /, exact: false })).toBeInViewport();
    if (filename.endsWith('.xlsx'))
      await expect(dialog.getByText('Row 300', { exact: true })).toBeInViewport();
    if (filename.endsWith('.docx'))
      await expect(dialog.getByText(/سطر 150 از سند بلند فارسی/)).toBeInViewport();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await controls.click();
  }
});

test('recovers from a failed PDF request and safely cancels a preview closed while loading', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openChat(page);
  const access = `**/attachments/${account.pdfId}/access`;
  await page.route(access, (route) => route.fulfill({ status: 403, body: 'Forbidden' }), {
    times: 1,
  });
  const preview = page.getByRole('button', { name: 'پیش‌نمایش persian.pdf', exact: true });
  await preview.click();
  const dialog = page.getByRole('dialog', { name: 'پیش‌نمایش فایل', exact: true });
  await expect(dialog.getByRole('alert')).toContainText('اجازه');
  await dialog.getByRole('button', { name: 'تلاش دوباره', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveCount(0);
  await expect(dialog.locator('canvas').first()).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'بستن', exact: true }).click();
  let release: (() => void) | undefined;
  await page.route(
    access,
    async (route) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.abort();
    },
    { times: 1 },
  );
  await preview.click();
  await expect(dialog.getByRole('status')).toBeVisible();
  await expect.poll(() => !!release).toBe(true);
  await dialog.getByRole('button', { name: 'بستن', exact: true }).click();
  release!();
  await preview.click();
  await expect(dialog.getByRole('status')).toHaveCount(0);
  await expect(dialog.locator('canvas').first()).toBeVisible();
  expect(errors).toEqual([]);
});
