import { test, expect } from '../helpers/e2e-test';
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

test('finds units outside the first page, clears an empty query and opens the chosen conversation without exposing hidden units', async ({
  page,
}) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const f = await fixtures();
  const prefix = randomUUID().slice(0, 8);
  const rows = Array.from({ length: 51 }, (_, index) => ({
    id: randomUUID(),
    slug: `search-${prefix}-${index}`,
    name: `واحد جستجو ${prefix} ${String(index).padStart(2, '0')}`,
    displayOrder: -100000 + index,
  }));
  await db.department.createMany({ data: rows });
  const target = rows[50];
  const hidden = await db.department.create({
    data: { name: `مخفی ${prefix}`, slug: `hidden-search-${prefix}`, visible: false },
  });
  expect(
    (
      await page.request.post('/api/auth/sign-in/phone-number', {
        headers: { origin: 'http://localhost:3001' },
        data: { phoneNumber: f.student.phoneNumber, password: f.password },
      })
    ).ok(),
  ).toBe(true);
  await page.goto('/tickets/new');
  const search = page.getByRole('searchbox', { name: 'جستجوی واحد', exact: true });
  await expect(search).toBeVisible();
  await expect(
    page.getByRole('button', { name: `انتخاب ${target.name}`, exact: true }),
  ).toHaveCount(0);
  await search.fill(hidden.name);
  await expect(page.getByText('واحدی با این نام پیدا نشد.')).toBeVisible();
  await page.getByRole('button', { name: 'پاک کردن جستجوی واحد' }).click();
  await expect(search).toHaveValue('');
  await expect(page.locator('.unit-choice')).toHaveCount(50);
  await search.fill(target.name);
  const choice = page.getByRole('button', { name: `انتخاب ${target.name}`, exact: true });
  await expect(choice).toBeEnabled();
  expect(await db.ticket.count({ where: { creatorId: f.student.id } })).toBe(0);
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(search).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await choice.click();
  await expect(page).toHaveURL(/\/tickets\/[a-f0-9-]+$/);
  expect(
    (await db.ticket.findFirstOrThrow({ where: { creatorId: f.student.id } })).departmentId,
  ).toBe(target.id);
  await db.department.deleteMany({
    where: { id: { in: [...rows.slice(0, 50).map((row) => row.id), hidden.id] } },
  });
});
