import { test, expect, type Page } from '@playwright/test';
import { loadEnvFile } from 'node:process';
import { randomBytes, randomUUID, randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';

try {
  loadEnvFile('.env');
} catch {
  /* CI injects environment. */
}
const url = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!);
if (!process.env.TEST_DATABASE_URL) url.pathname = '/niticket_test';
process.env.DATABASE_URL = url.toString();
const origin = 'http://localhost:3001';

async function login(page: Page, identifier: string, password: string) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'ورود با رمز', exact: true }).click();
  await page.getByLabel('شماره موبایل', { exact: true }).fill(identifier);
  await page.getByLabel('رمز عبور', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'ورود', exact: true }).click();
  await expect(page).toHaveURL(origin + '/');
}

test('expired student and administrator sessions redirect while the page is idle', async ({
  browser,
}) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const f = await fixtures();
  for (const user of [f.student, f.admin]) {
    const context = await browser.newContext(),
      page = await context.newPage();
    await page.clock.install();
    const checked = page.waitForResponse(
      (r) => r.url().endsWith('/api/auth/get-session') && r.status() === 200,
    );
    await login(page, user.phoneNumber!, f.password);
    await checked;
    await db.session.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await page.clock.fastForward(31000);
    await expect(page).toHaveURL(origin + '/login');
    await expect(page.getByLabel('رمز عبور فعلی برای تأیید')).toHaveCount(0);
    await context.close();
  }
  await db.$disconnect();
});

test('an expired session redirects immediately when a protected form is submitted', async ({
  page,
}) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const f = await fixtures();
  await login(page, f.student.phoneNumber!, f.password);
  const checked = page.waitForResponse(
    (r) => r.url().endsWith('/api/auth/get-session') && r.status() === 200,
  );
  await page.goto('/profile');
  await checked;
  await expect(
    page.getByRole('region', { name: 'نشست‌های فعال' }).getByText('این دستگاه', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('نام و نام خانوادگی', { exact: true }).fill('دانشجوی نشست منقضی');
  await db.session.updateMany({
    where: { userId: f.student.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await page.getByRole('button', { name: 'ذخیره اطلاعات', exact: true }).click();
  await expect(page).toHaveURL(origin + '/login');
  expect((await db.user.findUniqueOrThrow({ where: { id: f.student.id } })).name).toBe(
    f.student.name,
  );
  await db.$disconnect();
});

test('sensitive operations confirm the password in the same form, keep mistakes local and resume once', async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const f = await fixtures();
  await login(page, f.admin.phoneNumber!, f.password);
  await db.session.updateMany({
    where: { userId: f.admin.id },
    data: { createdAt: new Date(Date.now() - 600000) },
  });
  await page.goto(`/admin/departments?q=${encodeURIComponent(f.department.name)}`);
  await page.getByRole('button', { name: `ویرایش ${f.department.name}`, exact: true }).click();
  const updatedName = `واحد تأیید رمز ${randomUUID().slice(0, 8)}`;
  await page.getByLabel('نام واحد', { exact: true }).fill(updatedName);
  await page.getByRole('button', { name: 'ذخیره واحد', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const confirmation = dialog.getByRole('group', { name: 'تأیید هویت برای ادامه عملیات' });
  await expect(confirmation).toBeVisible();
  await expect(dialog.getByLabel('نام واحد', { exact: true })).toBeDisabled();
  await confirmation.getByRole('button', { name: 'تأیید با رمز', exact: true }).click();
  await confirmation.getByLabel('رمز عبور فعلی برای تأیید').fill('incorrect-password');
  await confirmation.getByRole('button', { name: 'تأیید و ادامه عملیات', exact: true }).click();
  await expect(confirmation.getByRole('alert')).toHaveText('رمز عبور معتبر نیست.');
  expect((await context.request.get('/api/v1/users/me')).status()).toBe(200);
  expect((await db.department.findUniqueOrThrow({ where: { id: f.department.id } })).name).toBe(
    f.department.name,
  );
  if (await confirmation.getByRole('button', { name: 'تأیید با رمز', exact: true }).count())
    await confirmation.getByRole('button', { name: 'تأیید با رمز', exact: true }).click();
  await confirmation.getByLabel('رمز عبور فعلی برای تأیید').fill(f.password);
  await confirmation.getByRole('button', { name: 'تأیید و ادامه عملیات', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((await db.department.findUniqueOrThrow({ where: { id: f.department.id } })).name).toBe(
    updatedName,
  );
  expect(
    await db.auditLog.count({
      where: { actorId: f.admin.id, resourceId: f.department.id, action: 'DEPARTMENT_UPDATED' },
    }),
  ).toBe(1);
  const sessions = await db.session.findMany({
    where: { userId: f.admin.id },
    select: { id: true },
  });

  async function stale() {
    await db.reauthentication.deleteMany({
      where: { sessionId: { in: sessions.map((s) => s.id) } },
    });
  }

  await stale();
  await page.goto(`/admin/users?q=${f.student.studentNumber}`);
  await page.getByRole('button', { name: 'ویرایش اطلاعات', exact: true }).click();
  await page.getByLabel('نام و نام خانوادگی', { exact: true }).fill('دانشجوی تأیید رمز');
  await page.getByRole('button', { name: 'ذخیره اطلاعات کاربر', exact: true }).click();
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'انصراف', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.getByLabel('نام و نام خانوادگی', { exact: true })).toHaveValue(
    'دانشجوی تأیید رمز',
  );
  expect((await db.user.findUniqueOrThrow({ where: { id: f.student.id } })).name).toBe(
    f.student.name,
  );
  await page.getByRole('button', { name: 'ذخیره اطلاعات کاربر', exact: true }).click();
  await expect(confirmation).toBeVisible();
  if (await confirmation.getByRole('button', { name: 'تأیید با رمز', exact: true }).count())
    await confirmation.getByRole('button', { name: 'تأیید با رمز', exact: true }).click();
  await confirmation.getByLabel('رمز عبور فعلی برای تأیید').fill(f.password);
  await confirmation.getByRole('button', { name: 'تأیید و ادامه عملیات', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'دانشجوی تأیید رمز', exact: true })).toBeVisible();
  await stale();
  await page.goto('/admin/settings');
  await page.getByRole('button', { name: 'ذخیره اطلاعات سامانه', exact: true }).click();
  const settingsConfirmation = page
    .locator('form')
    .getByRole('group', { name: 'تأیید هویت برای ادامه عملیات' });
  await expect(settingsConfirmation).toBeVisible();
  await settingsConfirmation.getByRole('button', { name: 'دریافت کد تأیید', exact: true }).click();
  await settingsConfirmation
    .getByLabel('کد ۶ رقمی تأیید', { exact: true })
    .fill(await readOtp(f.admin.phoneNumber!));
  await settingsConfirmation
    .getByRole('button', { name: 'تأیید و ادامه عملیات', exact: true })
    .click();
  await expect(page.getByText('اطلاعات سامانه ذخیره شد.', { exact: true })).toBeVisible();
  await expect(settingsConfirmation).toHaveCount(0);
  await db.$disconnect();
});

test('password changes revoke other sessions even when the client requests otherwise', async ({
  browser,
}) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const f = await fixtures();
  const a = await browser.newContext(),
    b = await browser.newContext();
  for (const c of [a, b])
    expect(
      (
        await c.request.post('/api/auth/sign-in/phone-number', {
          headers: { origin },
          data: { phoneNumber: f.student.phoneNumber, password: f.password, rememberMe: false },
        })
      ).status(),
    ).toBe(200);
  const response = await a.request.post('/api/v1/users/me/password', {
    headers: { origin },
    data: {
      newPassword: randomBytes(24).toString('base64url'),
    },
  });
  expect(response.status()).toBe(200);
  expect((await b.request.get('/api/v1/users/me')).status()).toBe(401);
  expect((await a.request.get('/api/v1/users/me')).status()).toBe(200);
  expect(
    await db.auditLog.count({ where: { actorId: f.student.id, action: 'PASSWORD_SET' } }),
  ).toBe(1);
  await a.close();
  await b.close();
  await db.$disconnect();
});

async function readOtp(phoneNumber: string) {
  let code = '';
  await expect
    .poll(async () => {
      const log = await readFile('.local/e2e-auth.log', 'utf8');
      for (const line of log.split('\n').reverse()) {
        try {
          const row = JSON.parse(line);
          if (row.event === 'sms.otp' && row.phoneNumber === phoneNumber) {
            code = row.otpCode;
            break;
          }
        } catch {
          /* Other server output. */
        }
      }
      return !!code;
    })
    .toBe(true);
  return code;
}

test('a phone-only signup sets a password in the profile and returns through either login method', async ({
  page,
  context,
}) => {
  const phoneNumber = `+989${randomInt(100000000, 999999999)}`,
    password = randomBytes(20).toString('base64url');
  await page.goto('/register');
  await expect(page).toHaveURL(origin + '/login');
  await expect(page.locator('input')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.local/ui-preview/mobile-login-390.png', fullPage: true });
  await page.getByLabel('شماره موبایل', { exact: true }).fill(phoneNumber.replace('+98', '0'));
  await page.getByRole('button', { name: 'دریافت کد ورود', exact: true }).click();
  const code = await readOtp(phoneNumber);
  await page.screenshot({ path: '.local/ui-preview/mobile-otp-390.png', fullPage: true });
  await page.getByLabel('کد ۶ رقمی', { exact: true }).fill(code);
  await page.getByRole('button', { name: 'ورود', exact: true }).click();
  await expect(page).toHaveURL(origin + '/');
  const profile = await context.request.get('/api/v1/users/me');
  expect((await profile.json()).data).toMatchObject({ phoneNumber, hasPassword: false });
  expect(
    (
      await context.request.post('/api/auth/phone-number/verify', {
        headers: { origin },
        data: { phoneNumber, code },
      })
    ).ok(),
  ).toBe(false);
  await page.goto('/profile');
  await page.getByLabel('رمز عبور جدید', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'ذخیره رمز عبور', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'رمز عبور تغییر کرد' })).toBeVisible();
  await context.request.post('/api/auth/sign-out', { headers: { origin }, data: {} });
  await login(page, phoneNumber, password);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/profile');
  await page.screenshot({ path: '.local/ui-preview/mobile-profile-390.png', fullPage: true });
});

test('three roles complete a ticket with private history notes, file previews and real microphone voice', async ({
  browser,
}) => {
  test.setTimeout(180000);
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const { processScan, processNotification } = await import('@niticket/core/application/jobs');
  const { scanInContainer } = await import('../helpers/scan-in-container');
  const f = await fixtures();
  const admin = await browser.newContext(),
    student = await browser.newContext(),
    staff = await browser.newContext();
  await student.grantPermissions(['microphone']);
  await staff.grantPermissions(['microphone']);
  const a = await admin.newPage(),
    s = await student.newPage(),
    u = await staff.newPage();
  const errors: string[] = [];
  for (const p of [a, s, u]) p.on('pageerror', (e) => errors.push(e.message));
  await login(a, f.admin.phoneNumber!, f.password);
  await expect(a.getByRole('heading', { name: 'نمای کلی سامانه' })).toBeVisible();
  await expect(a.getByRole('link', { name: 'درخواست جدید', exact: true })).toHaveCount(0);
  await expect(a.getByRole('link', { name: 'درخواست‌های من', exact: true })).toHaveCount(0);
  await a.goto('/admin/departments');
  await a.getByRole('button', { name: 'واحد جدید', exact: true }).click();
  const name = `واحد مرورگر ${Date.now()}`,
    officerPhone = `+989${randomInt(100000000, 999999999)}`;
  await a.getByLabel('نام واحد', { exact: true }).fill(name);
  await a.getByLabel('نام و نام خانوادگی مسئول', { exact: true }).fill('مسئول آزمون مرورگر');
  await a.getByLabel('شماره موبایل مسئول', { exact: true }).fill(officerPhone);
  await expect(a.getByRole('textbox', { name: /شناسه|آیدی|ایدی/ })).toHaveCount(0);
  await a.getByLabel('تصویر پروفایل مسئول (اختیاری)').setInputFiles('tests/fixtures/photo.png');
  await a.getByRole('button', { name: 'ایجاد واحد و مسئول', exact: true }).click();
  await expect(a.getByRole('dialog', { name: 'ایجاد واحد و حساب مسئول' })).toHaveCount(0, {
    timeout: 30000,
  });
  await expect(a.getByRole('heading', { name, exact: true })).toBeVisible();
  const department = await db.department.findFirstOrThrow({ where: { name } }),
    officer = await db.user.findUniqueOrThrow({ where: { phoneNumber: officerPhone } });
  const avatar = await db.attachment.findFirstOrThrow({ where: { avatarOwnerId: officer.id } });
  const avatarEvent = await db.outboxEvent.findFirstOrThrow({
    where: { type: 'SCAN_ATTACHMENT', payload: { path: ['attachmentId'], equals: avatar.id } },
  });
  await processScan(avatarEvent.id, avatarEvent.payload);
  await a.reload();
  await expect(
    a
      .locator('article')
      .filter({ has: a.getByRole('heading', { name, exact: true }) })
      .getByAltText('تصویر مسئول آزمون مرورگر'),
  ).toBeVisible();
  await login(s, f.student.phoneNumber!, f.password);
  await expect(s.locator('html')).toHaveAttribute('dir', 'rtl');
  await s.getByRole('link', { name: 'پیام جدید', exact: true }).click();
  await expect(s.getByRole('heading', { name: 'به کدام واحد پیام می‌دهید؟' })).toBeVisible();
  if (await s.getByLabel('جستجوی واحد', { exact: true }).count())
    await s.getByLabel('جستجوی واحد', { exact: true }).fill(name);
  await s.getByRole('button', { name: `انتخاب ${name}`, exact: true }).click();
  await expect(s).toHaveURL(/\/tickets\/[a-f0-9-]+/);
  await s
    .getByLabel('پاسخ شما', { exact: true })
    .fill('لطفاً این گفتگو را برای بررسی مسیر کامل رسیدگی بررسی کنید.');
  await s.getByRole('button', { name: 'ارسال پیام', exact: true }).click();
  await expect(s.locator('.message-body')).toContainText('لطفاً این گفتگو');
  const ticketUrl = s.url(),
    id = ticketUrl.split('/').pop()!;
  const creation = await db.outboxEvent.findFirstOrThrow({
    where: { type: 'TICKET_NOTIFICATION', payload: { path: ['ticketId'], equals: id } },
  });
  await processNotification(creation.id, creation.payload);
  await u.goto('/login');
  await u.getByLabel('شماره موبایل', { exact: true }).fill(officerPhone);
  await u.getByRole('button', { name: 'دریافت کد ورود', exact: true }).click();
  await u.getByLabel('کد ۶ رقمی', { exact: true }).fill(await readOtp(officerPhone));
  await u.getByRole('button', { name: 'ورود', exact: true }).click();
  await expect(u).toHaveURL(origin + '/');
  await expect(u.getByRole('link', { name: 'درخواست جدید', exact: true })).toHaveCount(0);
  await u.goto('/notifications');
  await expect(u.getByText('درخواست جدید ثبت شد', { exact: true })).toBeVisible();
  await u.goto(ticketUrl);
  await expect(u.locator('.messenger-contact h1')).toHaveText(f.student.name);
  await u.getByLabel('پاسخ شما', { exact: true }).fill('پاسخ مسئول واحد به دانشجو');
  await u.locator('#attachment').setInputFiles({
    name: 'officer.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('پیوست پاسخ مسئول واحد'),
  });
  await u.getByRole('button', { name: 'ارسال پیام', exact: true }).click();
  await expect(
    u.locator('.message-body').filter({ hasText: 'پاسخ مسئول واحد به دانشجو' }),
  ).toBeVisible();
  await expect(u.locator('.notification-count')).toHaveCount(0);
  expect(
    (
      await db.notification.findUniqueOrThrow({
        where: { eventId_userId: { eventId: creation.id, userId: officer.id } },
      })
    ).readAt,
  ).not.toBeNull();
  await expect
    .poll(() => db.attachment.count({ where: { ticketId: id, filename: 'officer.txt' } }))
    .toBe(1);
  const replyEvent = await db.outboxEvent.findFirstOrThrow({
    where: {
      type: 'TICKET_NOTIFICATION',
      AND: [
        { payload: { path: ['ticketId'], equals: id } },
        { payload: { path: ['type'], equals: 'PUBLIC_REPLY' } },
      ],
    },
  });
  await processNotification(replyEvent.id, replyEvent.payload);
  await s.goto('/notifications');
  await expect(s.getByText('پاسخ جدیدی برای درخواست ثبت شد', { exact: true })).toBeVisible();
  await s.goto(ticketUrl);
  // All common document types are processed locally after authorized download.
  await s.getByLabel('پاسخ شما', { exact: true }).fill('مدارک دانشجو برای بررسی');
  await s
    .locator('#attachment')
    .setInputFiles([
      'tests/fixtures/document.pdf',
      'tests/fixtures/document.docx',
      'tests/fixtures/sheet.xlsx',
      'tests/fixtures/photo.png',
    ]);
  await expect(s.locator('.selected-files > span')).toHaveCount(4);
  await s.getByRole('button', { name: 'ارسال پیام', exact: true }).click();
  await expect.poll(() => db.attachment.count({ where: { ticketId: id } })).toBe(5);
  for (const attachment of await db.attachment.findMany({ where: { ticketId: id } })) {
    const event = await db.outboxEvent.findFirstOrThrow({
      where: {
        type: 'SCAN_ATTACHMENT',
        payload: { path: ['attachmentId'], equals: attachment.id },
      },
    });
    await processScan(event.id, event.payload);
    expect(
      (await db.attachment.findUniqueOrThrow({ where: { id: attachment.id } })).scanStatus,
    ).toBe('CLEAN');
  }
  await s.reload();
  for (const [filename, content] of [
    ['document.docx', 'NITicket Word preview'],
    ['sheet.xlsx', 'NITicket spreadsheet'],
    ['document.pdf', ''],
    ['photo.png', ''],
  ]) {
    await s
      .getByRole('button', { name: `پیش‌نمایش ${filename}`, exact: true })
      .first()
      .click();
    const dialog = s.getByRole('dialog');
    await expect(dialog.getByRole('status')).toHaveCount(0);
    if (content) await expect(dialog.getByText(content, { exact: false })).toBeVisible();
    else if (filename.endsWith('.pdf'))
      await expect
        .poll(() => dialog.locator('canvas').evaluate((c) => (c as HTMLCanvasElement).width))
        .toBeGreaterThan(0);
    else await expect(dialog.locator('img')).toBeVisible();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'بستن', exact: true }).click();
  }
  // Record and actually send browser-generated WebM, whose duration is often absent.
  for (const p of [s, u]) {
    await p.reload();
    await p.getByRole('button', { name: 'ضبط پیام صوتی', exact: true }).click();
    await expect(p.getByRole('status').filter({ hasText: 'در حال ضبط' })).toBeVisible();
    await p.waitForTimeout(1250);
    await p.getByRole('button', { name: 'مکث ضبط', exact: true }).click();
    await p.getByRole('button', { name: 'ادامه ضبط', exact: true }).click();
    await p.getByRole('button', { name: 'پایان ضبط', exact: true }).click();
    await expect(p.getByLabel('پیش‌شنوی پیام صوتی', { exact: true })).toBeVisible();
    await p.getByRole('button', { name: 'ارسال پیام', exact: true }).click();
    await expect(p.getByLabel('پیش‌شنوی پیام صوتی', { exact: true })).toHaveCount(0);
  }
  await expect
    .poll(() => db.attachment.count({ where: { ticketId: id, declaredMime: 'audio/webm' } }))
    .toBe(2);
  for (const voice of await db.attachment.findMany({
    where: { ticketId: id, declaredMime: 'audio/webm' },
  })) {
    const event = await db.outboxEvent.findFirstOrThrow({
      where: { type: 'SCAN_ATTACHMENT', payload: { path: ['attachmentId'], equals: voice.id } },
    });
    await scanInContainer(event.id);
    const result = await db.attachment.findUniqueOrThrow({ where: { id: voice.id } });
    expect(result.scanStatus).toBe('CLEAN');
    expect(result.durationSeconds).toBeGreaterThan(1);
    expect(result.waveform).toHaveLength(80);
  }
  await u.reload();
  await expect(u.getByLabel('پیام صوتی', { exact: true })).toHaveCount(2);
  await expect(u.getByRole('button', { name: 'پایان رسیدگی', exact: true })).toHaveCount(0);
  await u.getByRole('button', { name: 'اطلاعات گفتگو', exact: true }).click();
  await u.getByText('تاریخچه و یادداشت‌های واحد', { exact: true }).click();
  await u.getByRole('button', { name: 'یادداشت یا وویس', exact: true }).first().click();
  await u.getByLabel('یادداشت متنی (اختیاری)').fill('PRIVATE_HISTORY_BROWSER');
  await expect(u.getByLabel('یادداشت متنی (اختیاری)')).toHaveValue('PRIVATE_HISTORY_BROWSER');
  const noteDialog = u.getByRole('dialog', { name: 'یادداشت برای این رویداد', exact: true });
  await noteDialog.getByRole('button', { name: 'ضبط پیام صوتی', exact: true }).click();
  await u.waitForTimeout(1100);
  await noteDialog.getByRole('button', { name: 'پایان ضبط', exact: true }).click();
  await expect(noteDialog.getByLabel('پیش‌شنوی پیام صوتی', { exact: true })).toBeVisible();
  await expect(noteDialog.getByLabel('یادداشت متنی (اختیاری)')).toHaveValue(
    'PRIVATE_HISTORY_BROWSER',
  );
  await noteDialog.getByRole('button', { name: 'ثبت یادداشت', exact: true }).click();
  await expect(noteDialog).toHaveCount(0);
  await expect(u.getByText('PRIVATE_HISTORY_BROWSER', { exact: true })).toBeVisible();
  const noteVoice = await db.attachment.findFirstOrThrow({
    where: { ticketId: id, noteId: { not: null } },
  });
  const noteEvent = await db.outboxEvent.findFirstOrThrow({
    where: { type: 'SCAN_ATTACHMENT', payload: { path: ['attachmentId'], equals: noteVoice.id } },
  });
  await scanInContainer(noteEvent.id);
  await s.reload();
  await expect(s.getByText('PRIVATE_HISTORY_BROWSER', { exact: true })).toHaveCount(0);
  expect((await student.request.get(`/api/v1/attachments/${noteVoice.id}/access`)).status()).toBe(
    404,
  );
  await a.goto(`/admin/departments/${department.id}/history`);
  await a.locator('.ticket-row').filter({ hasText: name }).click();
  await expect(a.getByLabel('پاسخ شما', { exact: true })).toHaveCount(0);
  await expect(a.getByLabel('تغییر وضعیت', { exact: true })).toHaveCount(0);
  await a.getByRole('button', { name: 'اطلاعات گفتگو', exact: true }).click();
  await a.getByText('تاریخچه و یادداشت‌های واحد', { exact: true }).click();
  await expect(a.getByText('PRIVATE_HISTORY_BROWSER', { exact: true })).toBeVisible();
  expect(
    (
      await admin.request.post('/api/v1/tickets', {
        headers: { origin, 'idempotency-key': randomUUID() },
        data: { departmentId: department.id, subject: 'غیرمجاز', body: 'درخواست مدیر باید رد شود' },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await student.request.post(`/api/v1/tickets/${id}/messages`, {
        data: { version: 1, body: 'CSRF', visibility: 'PUBLIC' },
      })
    ).status(),
  ).toBe(403);
  const outsider = await browser.newContext();
  expect(
    (
      await outsider.request.post('/api/auth/sign-in/phone-number', {
        headers: { origin },
        data: { phoneNumber: f.outsider.phoneNumber, password: f.password },
      })
    ).status(),
  ).toBe(200);
  expect((await outsider.request.get(`/api/v1/tickets/${id}`)).status()).toBe(404);
  await outsider.close();
  await u.goto('/profile');
  await u
    .getByLabel('انتخاب تصویر پروفایل', { exact: true })
    .setInputFiles('tests/fixtures/photo.png');
  await expect.poll(() => db.attachment.count({ where: { avatarOwnerId: officer.id } })).toBe(2);
  const replacement = await db.attachment.findFirstOrThrow({
    where: { avatarOwnerId: officer.id, id: { not: avatar.id } },
  });
  await expect
    .poll(
      async () =>
        (await db.attachment.findUniqueOrThrow({ where: { id: replacement.id } })).scanStatus,
    )
    .toBe('QUARANTINED');
  const photoEvent = await db.outboxEvent.findFirstOrThrow({
    where: { type: 'SCAN_ATTACHMENT', payload: { path: ['attachmentId'], equals: replacement.id } },
  });
  await processScan(photoEvent.id, photoEvent.payload);
  await expect(u.getByText('تصویر پروفایل به‌روزرسانی شد.', { exact: true })).toBeVisible();
  await expect(u.getByLabel('شماره موبایل', { exact: true })).toHaveAttribute('readonly', '');
  await u.getByLabel('نام و نام خانوادگی', { exact: true }).fill('مسئول آزمون مرورگر ویرایش‌شده');
  await u.getByRole('button', { name: 'ذخیره اطلاعات', exact: true }).click();
  await expect(u.getByText('اطلاعات حساب شما ذخیره شد.', { exact: true })).toBeVisible();
  expect((await db.user.findUniqueOrThrow({ where: { id: officer.id } })).phoneNumber).toBe(
    officerPhone,
  );
  const policy = (await (await admin.request.get('/api/v1/admin/settings')).json()).data;
  await a.goto('/admin/settings');
  await a
    .getByLabel('توضیح کوتاه سامانه', { exact: true })
    .fill('پشتیبانی دانشگاه - آزمون تنظیمات');
  await a.getByRole('button', { name: 'ذخیره اطلاعات سامانه', exact: true }).click();
  await expect(a.getByText('اطلاعات سامانه ذخیره شد.', { exact: true })).toBeVisible();
  await expect(a.locator('.topbar-title')).toContainText('پشتیبانی دانشگاه - آزمون تنظیمات');
  expect(
    (
      await admin.request.patch('/api/v1/admin/settings', { headers: { origin }, data: policy })
    ).status(),
  ).toBe(200);
  for (const [p, path] of [
    [a, '/admin/departments'],
    [s, ticketUrl],
    [u, '/'],
  ] as const) {
    for (const width of [320, 390, 768, 1440]) {
      await p.setViewportSize({ width, height: 900 });
      await p.goto(path);
      await expect(p.locator('main h1')).toBeVisible();
      expect(
        await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `${p === a ? 'admin' : p === s ? 'student' : 'staff'} at ${width}px: ${await p.evaluate(
          () =>
            Array.from(document.querySelectorAll('main *'))
              .filter((el) => {
                const r = el.getBoundingClientRect();
                return r.left < -1 || r.right > innerWidth + 1;
              })
              .slice(0, 10)
              .map((el) => ({
                tag: el.tagName,
                class: el.className,
                width: el.getBoundingClientRect().width,
              })),
        )}`,
      ).toBe(true);
      if (width === 390 || width === 1440)
        await p.screenshot({
          path: `test-results/${p === a ? 'admin' : p === s ? 'student' : 'staff'}-${width}.png`,
          fullPage: true,
        });
    }
  }
  await a.goto(`/admin/users?q=${f.student.studentNumber}`);
  await a.getByRole('button', { name: 'ویرایش اطلاعات', exact: true }).click();
  await a.getByLabel('نام و نام خانوادگی', { exact: true }).fill('دانشجوی ویرایش‌شده در آزمون');
  await a.getByRole('button', { name: 'ذخیره اطلاعات کاربر', exact: true }).click();
  await expect(a.getByRole('dialog')).toHaveCount(0);
  await expect(
    a.getByRole('heading', { name: 'دانشجوی ویرایش‌شده در آزمون', exact: true }),
  ).toBeVisible();
  expect((await student.request.get('/api/v1/users/me')).status()).toBe(401);
  expect(errors).toEqual([]);
  await admin.close();
  await student.close();
  await staff.close();
  await db.$disconnect();
});
