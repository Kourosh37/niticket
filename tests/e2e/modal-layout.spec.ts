import { test, expect, type Locator } from '@playwright/test';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import { goToModalStep } from '../helpers/modal-steps';

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
const viewports = [
  { width: 320, height: 568 },
  { width: 390, height: 430 },
  { width: 844, height: 390 },
  { width: 1440, height: 900 },
];

async function fits(dialog: Locator) {
  await expect(dialog).toBeVisible();
  await expect
    .poll(() =>
      dialog.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const body = node.querySelector<HTMLElement>('.modal-body')!;
        const fields = node.querySelector<HTMLElement>('.modal-form-fields');
        const controls = Array.from(
          node.querySelectorAll<HTMLElement>(
            'button, input:not([type="hidden"]):not([type="file"]), textarea',
          ),
        ).filter((control) => control.getClientRects().length > 0);
        return {
          surfaceFits:
            box.left >= -1 &&
            box.right <= innerWidth + 1 &&
            box.top >= -1 &&
            box.bottom <= innerHeight + 1,
          outerScroll: node.scrollHeight > node.clientHeight + 1,
          bodyScroll: body.scrollHeight > body.clientHeight + 1,
          fieldsScroll: fields ? fields.scrollHeight > fields.clientHeight + 1 : false,
          scrollbar: getComputedStyle(body).scrollbarWidth,
          clippedControls: controls
            .filter((control) => {
              const bounds = control.getBoundingClientRect();
              return (
                bounds.left < box.left - 1 ||
                bounds.right > box.right + 1 ||
                bounds.top < box.top - 1 ||
                bounds.bottom > box.bottom + 1
              );
            })
            .map((control) => control.getAttribute('aria-label') ?? control.textContent),
        };
      }),
    )
    .toEqual({
      surfaceFits: true,
      outerScroll: false,
      bodyScroll: false,
      fieldsScroll: false,
      scrollbar: 'none',
      clippedControls: [],
    });
}

test('keeps administration forms fully visible and preserves values across sections at mobile, keyboard and landscape sizes', async ({
  page,
}) => {
  test.setTimeout(120000);
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
  await page.getByRole('button', { name: 'واحد جدید', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'ایجاد واحد و حساب مسئول', exact: true });
  await create.getByLabel('نام واحد', { exact: true }).fill('نامی که در تغییر بخش حفظ می‌شود');
  await create.getByRole('button', { name: 'مرحله بعد', exact: true }).click();
  await create.getByLabel('نام و نام خانوادگی مسئول', { exact: true }).fill('مسئول نمونه');
  await create.getByLabel('شماره موبایل مسئول', { exact: true }).fill('09121234567');
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const section of ['واحد', 'مسئول', 'تصویر']) {
      await goToModalStep(create, section);
      await fits(create);
      if (viewport.width === 390 && section === 'واحد')
        await page.screenshot({
          path: '.local/ui-preview/unit-create-390.png',
          animations: 'disabled',
        });
      await expect(
        create.getByRole('button', {
          name: section === 'تصویر' ? 'ایجاد واحد و مسئول' : 'مرحله بعد',
          exact: true,
        }),
      ).toBeInViewport({ ratio: 1 });
    }
  }
  await goToModalStep(create, 'مسئول');
  await create.getByLabel('نام و نام خانوادگی مسئول', { exact: true }).fill('');
  await create.getByRole('button', { name: 'مرحله بعد', exact: true }).click();
  await expect(create.getByRole('tab', { name: 'مسئول', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(create.getByLabel('نام و نام خانوادگی مسئول')).toBeFocused();
  await create.getByRole('tab', { name: 'واحد', exact: true }).click();
  await expect(create.getByLabel('نام واحد', { exact: true })).toHaveValue(
    'نامی که در تغییر بخش حفظ می‌شود',
  );
  await create.getByRole('button', { name: 'بستن', exact: true }).click();
  await page.getByRole('button', { name: `ویرایش ${f.department.name}`, exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'ویرایش واحد', exact: true });
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const section of ['اطلاعات', 'دسترسی']) {
      await goToModalStep(edit, section);
      await fits(edit);
    }
  }
  await edit.getByRole('button', { name: 'بستن', exact: true }).click();
  await page.getByRole('button', { name: 'ویرایش مسئول', exact: true }).first().click();
  const person = page.getByRole('dialog', { name: 'ویرایش حساب مسئول واحد', exact: true });
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const section of ['اطلاعات حساب', 'تصویر پروفایل']) {
      await goToModalStep(person, section);
      await fits(person);
    }
  }
  await person.getByRole('button', { name: 'بستن', exact: true }).click();
  await page.goto(`/admin/users?q=${f.student.studentNumber}`);
  await page.getByRole('button', { name: 'ویرایش اطلاعات', exact: true }).first().click();
  const user = page.getByRole('dialog', { name: 'ویرایش اطلاعات کاربر', exact: true });
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await fits(user);
  }
  await db.$disconnect();
});

test('fits all saved-reply sections, paginates the library and supports nested history notes without scrolling the modal', async ({
  page,
}) => {
  test.setTimeout(120000);
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const { createTicket } = await import('@niticket/core/application/tickets');
  const f = await fixtures();
  const ticket = await createTicket(
    await f.actor(f.student.id),
    { departmentId: f.department.id, subject: 'بررسی پنجره‌ها', body: 'درخواست تست پنجره' },
    randomUUID(),
  );
  await db.savedReply.createMany({
    data: Array.from({ length: 12 }, (_, index) => ({
      departmentId: f.department.id,
      creatorId: f.agent.id,
      title: `پیام آزمایشی ${index}`,
      body: `متن پاسخ شماره ${index}`,
    })),
  });
  expect(
    (
      await page.request.post('/api/auth/sign-in/phone-number', {
        headers: { origin },
        data: { phoneNumber: f.agent.phoneNumber, password: f.password },
      })
    ).ok(),
  ).toBe(true);
  await page.goto('/saved-replies');
  await page.getByRole('button', { name: 'پیام جدید', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'پیام آماده جدید', exact: true });
  await editor.getByLabel('عنوان پیام آماده', { exact: true }).fill('پیش‌نویس محفوظ');
  await editor.getByLabel('متن پیام آماده', { exact: true }).fill('متن محفوظ پس از تغییر بخش');
  await goToModalStep(editor, 'فایل‌ها');
  await editor.getByLabel('پیوست پیام آماده', { exact: true }).setInputFiles(
    Array.from({ length: 5 }, (_, index) => ({
      name: index === 0 ? `${'long-filename-'.repeat(15)}.txt` : `attachment-${index}.txt`,
      mimeType: 'text/plain',
      buffer: Buffer.from('draft'),
    })),
  );
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const section of ['متن پیام', 'فایل‌ها', 'پیام صوتی']) {
      await goToModalStep(editor, section);
      await fits(editor);
      if (viewport.width === 390 && section === 'متن پیام')
        await page.screenshot({
          path: '.local/ui-preview/saved-editor-390.png',
          animations: 'disabled',
        });
    }
  }
  await editor.getByRole('tab', { name: 'متن پیام', exact: true }).click();
  await expect(editor.getByLabel('متن پیام آماده', { exact: true })).toHaveValue(
    'متن محفوظ پس از تغییر بخش',
  );
  await editor.getByRole('button', { name: 'انصراف', exact: true }).click();
  await page.goto(`/tickets/${ticket.id}`);
  await page.getByRole('button', { name: 'پیام‌های آماده', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'پیام‌های آماده', exact: true });
  await expect(picker.locator('.saved-reply-summary')).toHaveCount(3);
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await fits(picker);
    if (viewport.width === 320)
      await page.screenshot({
        path: '.local/ui-preview/saved-picker-320.png',
        animations: 'disabled',
      });
  }
  const pages = picker.getByRole('navigation', { name: 'صفحه‌بندی پیام‌های آماده', exact: true });
  await pages.getByRole('button', { name: 'آخرین صفحه', exact: true }).click();
  await picker
    .getByRole('button', { name: /^انتخاب / })
    .first()
    .click();
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await fits(picker);
    await expect(
      picker.getByRole('button', { name: 'ارسال پیام آماده', exact: true }),
    ).toBeInViewport({ ratio: 1 });
  }
  await picker.getByRole('button', { name: 'بستن', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'اطلاعات گفتگو', exact: true }).click();
  const info = page.getByRole('dialog', { name: 'اطلاعات گفتگو', exact: true });
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await fits(info);
  }
  await info.getByText('تاریخچه و یادداشت‌های واحد', { exact: true }).click();
  await info.getByRole('button', { name: 'یادداشت یا وویس', exact: true }).click();
  const note = page.getByRole('dialog', { name: 'یادداشت برای این رویداد', exact: true });
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const section of ['یادداشت', 'پیام صوتی']) {
      await goToModalStep(note, section);
      await fits(note);
    }
  }
  await note.getByRole('button', { name: 'بستن', exact: true }).click();
  await expect(info).toBeVisible();
  await expect(info.getByRole('button', { name: 'یادداشت یا وویس', exact: true })).toBeFocused();
  await db.$disconnect();
});
