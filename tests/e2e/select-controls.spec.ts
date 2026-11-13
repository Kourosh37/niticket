import { test, expect } from '../helpers/e2e-test';
import { loadEnvFile } from 'node:process';

try {
  loadEnvFile('.env');
} catch {
  /* CI supplies the environment. */
}
const database = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!);
if (!process.env.TEST_DATABASE_URL) database.pathname = '/niticket_test';
if (!database.pathname.endsWith('_test')) throw new Error('Test database required');
process.env.DATABASE_URL = database.toString();

test('filters chats with an animated RTL selector, supports keyboard dismissal and clears the submitted unit', async ({
  page,
}) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const f = await fixtures();
  // Keep this fixture within the bounded public choices even in a reused test database.
  await db.department.updateMany({
    where: { id: { in: [f.department.id, f.destination.id] } },
    data: { displayOrder: -1000 },
  });
  await db.ticket.createMany({
    data: [f.department, f.destination].map((department) => ({
      creatorId: f.student.id,
      departmentId: department.id,
      subject: department.name,
    })),
  });
  expect(
    (
      await page.request.post('/api/auth/sign-in/phone-number', {
        headers: { origin: 'http://localhost:3001' },
        data: { phoneNumber: f.student.phoneNumber, password: f.password },
      })
    ).ok(),
  ).toBe(true);
  await page.goto('/?view=all');
  const select = page.locator('[role="combobox"][aria-label="واحد پاسخ‌گو"]');
  await expect(page.locator('.inbox-thread')).toHaveCount(2);
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await select.click();
    await expect(select).toHaveAttribute('aria-expanded', 'true');
    const menu = page.getByRole('listbox');
    await expect(menu).toBeVisible();
    await expect(select.locator('.select-chevron')).toHaveCSS(
      'transform',
      'matrix(-1, 0, 0, -1, 0, 0)',
    );
    const box = (await select.boundingBox())!,
      arrow = (await select.locator('.select-chevron').boundingBox())!;
    expect(arrow.x - box.x).toBeGreaterThanOrEqual(15);
    expect((await menu.boundingBox())!.width).toBeLessThanOrEqual(width - 24);
    expect(await menu.evaluate((node) => getComputedStyle(node).animationName)).toBe('select-open');
    await page.keyboard.press('Escape');
    await expect(select).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeHidden();
    await expect(select).toBeFocused();
  }
  await select.press('Enter');
  await page.getByRole('option', { name: f.department.name, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`departmentId=${f.department.id}`));
  await expect(page.locator('.inbox-thread')).toHaveCount(1);
  await expect(select).toContainText(f.department.name);
  await select.click();
  await expect(page.getByRole('option', { name: f.department.name, exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('option', { name: 'همه واحدها', exact: true }).click();
  await expect(page).toHaveURL('http://localhost:3001/?view=all');
  await expect(page.locator('.inbox-thread')).toHaveCount(2);
  // Live filters replace the current history entry. Use document navigation to exercise Back.
  await page.goto(`/?view=all&departmentId=${f.department.id}`);
  await page.goto('/?view=all');
  await page.goBack();
  await expect(select).toContainText(f.department.name);
  await expect(page.locator('.inbox-thread')).toHaveCount(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await select.click();
  expect(
    await page.getByRole('listbox').evaluate((node) => getComputedStyle(node).animationName),
  ).toBe('none');
  await page.screenshot({ path: '.local/ui-preview/select-unit-light.png' });
});

test('uses the same selector for submitted reports, saved-reply units and live message search', async ({
  page,
}) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const f = await fixtures();
  await db.departmentMembership.create({
    data: {
      departmentId: f.destination.id,
      userId: f.manager.id,
      role: 'MANAGER',
      assignedBy: f.admin.id,
    },
  });
  expect(
    (
      await page.request.post('/api/auth/sign-in/phone-number', {
        headers: { origin: 'http://localhost:3001' },
        data: { phoneNumber: f.manager.phoneNumber, password: f.password },
      })
    ).ok(),
  ).toBe(true);
  await page.goto('/reports');
  const reportUnit = page.getByRole('combobox', { name: 'واحد گزارش', exact: true });
  await reportUnit.click();
  await page.getByRole('option', { name: f.destination.name, exact: true }).click();
  await page.getByRole('button', { name: 'نمایش گزارش', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`departmentId=${f.destination.id}`));
  await expect(reportUnit).toContainText(f.destination.name);
  await page.goto('/saved-replies');
  const unit = page.getByRole('combobox', { name: 'واحد', exact: true });
  await unit.click();
  await page.getByRole('option', { name: f.destination.name, exact: true }).click();
  await expect(unit).toContainText(f.destination.name);
  await expect(page.locator('.saved-replies-page')).toBeVisible();
  await page.goto('/');
  await page.getByRole('button', { name: 'فیلترهای جستجو', exact: true }).click();
  await page.getByText('فیلترهای بیشتر', { exact: true }).click();
  const mode = page.getByRole('combobox', { name: 'روش جستجو', exact: true });
  await mode.press('Enter');
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('End');
  await expect(page.getByRole('option', { name: 'یکی از واژه‌ها', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(mode).toContainText('یکی از واژه‌ها');
  await page.getByRole('combobox', { name: 'نمایش پیام‌ها', exact: true }).click();
  await page.getByRole('option', { name: 'فقط خصوصی واحد', exact: true }).click();
  await expect(page).toHaveURL(/visibility=internal/);
});
