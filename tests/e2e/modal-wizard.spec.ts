import { test, expect } from '@playwright/test';
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

for (const kind of ['text', 'file', 'voice'] as const) {
  test(`saves a ${kind}-only prepared reply only after the last step and preserves its draft while going back`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    const { fixtures } = await import('../helpers/fixtures');
    const { db } = await import('@niticket/database');
    const f = await fixtures();
    expect(
      (
        await page.request.post('/api/auth/sign-in/phone-number', {
          headers: { origin },
          data: { phoneNumber: f.agent.phoneNumber, password: f.password },
        })
      ).ok(),
    ).toBe(true);
    await page.context().grantPermissions(['microphone']);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/saved-replies');
    let mutations = 0;
    page.on('request', (request) => {
      if (
        request.url().startsWith(origin + '/api/') &&
        ['POST', 'PATCH', 'DELETE'].includes(request.method())
      )
        mutations++;
    });
    await page.getByRole('button', { name: 'پیام جدید', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'پیام آماده جدید', exact: true });
    const title = `پیام ${kind} ${randomUUID().slice(0, 8)}`;
    await editor.getByLabel('عنوان پیام آماده', { exact: true }).fill(title);
    await expect(editor.getByRole('button', { name: 'ذخیره پیام آماده', exact: true })).toHaveCount(
      0,
    );
    await expect(editor.getByRole('tab', { name: 'فایل‌ها', exact: true })).toBeDisabled();
    await expect(editor.getByRole('tab', { name: 'پیام صوتی', exact: true })).toBeDisabled();
    await expect(editor.locator('.modal-step-arrow')).toHaveCount(2);
    if (kind === 'text')
      await editor
        .getByLabel('متن پیام آماده', { exact: true })
        .fill('متن اختیاری که پس از بازگشت حفظ می‌شود');
    await editor.getByRole('button', { name: 'مرحله بعد', exact: true }).click();
    await expect(editor.getByRole('tab', { name: 'فایل‌ها', exact: true })).toHaveAttribute(
      'aria-current',
      'step',
    );
    if (kind === 'file')
      await editor
        .getByLabel('پیوست پیام آماده', { exact: true })
        .setInputFiles('tests/fixtures/document.pdf');
    await editor.getByRole('button', { name: 'مرحله قبل', exact: true }).click();
    await expect(editor.getByLabel('عنوان پیام آماده', { exact: true })).toHaveValue(title);
    await expect(editor.getByLabel('متن پیام آماده', { exact: true })).toHaveValue(
      kind === 'text' ? 'متن اختیاری که پس از بازگشت حفظ می‌شود' : '',
    );
    await editor.getByRole('button', { name: 'مرحله بعد', exact: true }).click();
    if (kind === 'file')
      await expect(editor.getByText('document.pdf', { exact: true })).toBeVisible();
    await editor.getByRole('button', { name: 'مرحله بعد', exact: true }).click();
    await expect(editor.getByRole('button', { name: 'مرحله بعد', exact: true })).toHaveCount(0);
    const confirm = editor.getByRole('button', { name: 'ذخیره پیام آماده', exact: true });
    if (kind === 'voice') {
      await editor.getByRole('button', { name: 'ضبط پیام صوتی', exact: true }).click();
      await expect(confirm).toBeDisabled();
      await expect(editor.getByRole('button', { name: 'مرحله قبل', exact: true })).toBeDisabled();
      await page.waitForTimeout(1100);
      await editor.getByRole('button', { name: 'پایان ضبط', exact: true }).click();
      await expect(editor.getByLabel('پیش‌شنوی پیام صوتی', { exact: true })).toBeVisible();
      await editor.getByRole('button', { name: 'مرحله قبل', exact: true }).click();
      await editor.getByRole('button', { name: 'مرحله بعد', exact: true }).click();
      await expect(editor.getByLabel('پیش‌شنوی پیام صوتی', { exact: true })).toBeVisible();
    }
    expect(mutations).toBe(0);
    expect(await db.savedReply.count({ where: { title } })).toBe(0);
    await page.screenshot({
      path: `.local/ui-preview/wizard-${kind}-confirm.png`,
      animations: 'disabled',
    });
    await confirm.click();
    await expect(editor).toHaveCount(0, { timeout: 30000 });
    const saved = await db.savedReply.findFirstOrThrow({
      where: { title },
      include: { attachments: true },
    });
    expect(saved.body).toBe(kind === 'text' ? 'متن اختیاری که پس از بازگشت حفظ می‌شود' : '');
    expect(saved.attachments.length).toBe(kind === 'text' ? 0 : 1);
    if (kind === 'voice') expect(saved.attachments[0].declaredMime).toMatch(/^audio\//);
    await db.$disconnect();
  });
}

test('defers a responsible contact photo until final confirmation and cancels without changing the account', async ({
  page,
}) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const f = await fixtures();
  expect(
    (
      await page.request.post('/api/auth/sign-in/phone-number', {
        headers: { origin },
        data: { phoneNumber: f.admin.phoneNumber, password: f.password },
      })
    ).ok(),
  ).toBe(true);
  await page.goto(`/admin/departments?q=${encodeURIComponent(f.department.name)}`);
  const personRow = page.locator('.unit-person-row').filter({ hasText: f.manager.name });
  await personRow.getByRole('button', { name: 'ویرایش مسئول', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'ویرایش حساب مسئول واحد', exact: true });
  let mutations = 0;
  page.on('request', (request) => {
    if (request.url().startsWith(origin + '/api/') && ['POST', 'PATCH'].includes(request.method()))
      mutations++;
  });
  await editor.getByRole('button', { name: 'مرحله بعد', exact: true }).click();
  await editor
    .getByLabel('انتخاب تصویر پروفایل', { exact: true })
    .setInputFiles('tests/fixtures/photo.png');
  await expect(editor.getByText('تصویر انتخاب شد؛ پس از تأیید نهایی ذخیره می‌شود.')).toBeVisible();
  expect(mutations).toBe(0);
  await editor.getByRole('button', { name: 'بستن', exact: true }).click();
  expect(await db.attachment.count({ where: { avatarOwnerId: f.manager.id } })).toBe(0);
  await personRow.getByRole('button', { name: 'ویرایش مسئول', exact: true }).click();
  await editor.getByRole('button', { name: 'مرحله بعد', exact: true }).click();
  await editor
    .getByLabel('انتخاب تصویر پروفایل', { exact: true })
    .setInputFiles('tests/fixtures/photo.png');
  await editor.getByRole('button', { name: 'ذخیره حساب مسئول', exact: true }).click();
  await expect(editor).toHaveCount(0, { timeout: 30000 });
  expect(await db.attachment.count({ where: { avatarOwnerId: f.manager.id } })).toBe(1);
  await db.$disconnect();
});
