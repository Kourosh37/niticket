import { test, expect, type Page } from '@playwright/test';
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

async function palette(page: Page, dark: boolean) {
  await expect(page.locator('html')).toHaveAttribute('data-theme', dark ? 'dark' : 'light');
  const invalid = await page.evaluate((dark) => {
    const allowed = new Set(
      dark
        ? ['rgb(9, 35, 40)', 'rgb(18, 84, 79)', 'rgb(42, 131, 95)', 'rgb(139, 187, 146)']
        : ['rgb(244, 190, 56)', 'rgb(237, 218, 94)', 'rgb(113, 149, 30)', 'rgb(88, 117, 41)'],
    );
    const errors: string[] = [];
    for (const node of document.querySelectorAll<HTMLElement>('body *')) {
      if (!node.getClientRects().length) continue;
      const style = getComputedStyle(node);
      if (style.visibility === 'hidden' || style.opacity === '0') continue;
      for (const property of ['color', 'background-color', 'fill', 'stroke']) {
        const value = style.getPropertyValue(property);
        if (!value || ['none', 'transparent', 'rgba(0, 0, 0, 0)'].includes(value)) continue;
        if (property === 'fill' && !node.closest('svg')) continue;
        if (property === 'stroke' && !node.closest('svg')) continue;
        if (!allowed.has(value))
          errors.push(`${node.tagName}.${node.getAttribute('class') ?? ''} ${property}: ${value}`);
      }
      for (const side of ['top', 'right', 'bottom', 'left']) {
        if (
          parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0 &&
          style.getPropertyValue(`border-${side}-style`) !== 'none'
        ) {
          const value = style.getPropertyValue(`border-${side}-color`);
          if (!allowed.has(value) && value !== 'rgba(0, 0, 0, 0)')
            errors.push(`${node.tagName} border-${side}: ${value}`);
        }
      }
    }
    return [...new Set(errors)].slice(0, 20);
  }, dark);
  expect(invalid).toEqual([]);
}

async function login(page: Page, number: string, password: string) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'ورود با رمز', exact: true }).click();
  await page.getByLabel('شماره موبایل', { exact: true }).fill(number);
  await page.getByLabel('رمز عبور', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'ورود', exact: true }).click();
  await expect(page).toHaveURL('http://localhost:3001/');
}

test('applies the system theme before paint, persists choices with CSP and synchronizes tabs', async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    new PerformanceObserver((list) => {
      if (list.getEntries().some((entry) => entry.name === 'first-contentful-paint'))
        document.documentElement.dataset.firstPaintTheme = document.documentElement.dataset.theme;
    }).observe({ type: 'paint', buffered: true });
  });
  await page.goto('/login');
  await palette(page, true);
  await expect(page.locator('html')).toHaveAttribute('data-first-paint-theme', 'dark');
  const toggle = page.getByRole('switch', { name: 'حالت تاریک', exact: true });
  await expect(toggle).toBeChecked();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  const response = await page.request.get('/login');
  expect(await response.text()).toContain('data-theme="dark"');
  expect(response.headers()['content-security-policy']).toContain("'nonce-");
  await page.reload();
  await palette(page, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.local/ui-preview/theme-login-dark.png' });
  const other = await context.newPage();
  await other.goto('/login');
  await palette(other, true);
  await toggle.click();
  await palette(page, false);
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({ path: '.local/ui-preview/theme-login-light.png' });
  await other.close();
  expect(errors).toEqual([]);
});

test('uses only the requested palettes across requester, officer, admin, chat and modal screens', async ({
  page,
}) => {
  test.setTimeout(90000);
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const f = await fixtures();
  const ticket = await db.ticket.create({
    data: {
      creatorId: f.student.id,
      departmentId: f.department.id,
      subject: 'پالت رابط',
      messages: {
        create: [
          { senderId: f.student.id, body: 'بررسی پالت گفتگو' },
          { senderId: f.agent.id, body: 'پاسخ واحد برای بررسی پالت' },
        ],
      },
    },
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ colorScheme: 'light' });
  await login(page, f.student.phoneNumber!, f.password);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('link', { name: 'تنظیمات', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await palette(page, false);
  await page.getByRole('link', { name: 'تنظیمات', exact: true }).click();
  await page.getByRole('switch', { name: 'حالت تاریک' }).click();
  await palette(page, true);
  await page.goto('/');
  await page.screenshot({ path: '.local/ui-preview/theme-inbox-dark.png' });
  await page.goto(`/tickets/${ticket.id}`);
  await expect(page.locator('.messenger-bubble')).toHaveCount(2);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('switch', { name: 'حالت تاریک' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'تنظیمات', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await palette(page, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.local/ui-preview/theme-chat-dark.png' });
  await page.getByRole('button', { name: 'اطلاعات گفتگو', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await palette(page, true);
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'تنظیمات', exact: true }).click();
  await page.getByRole('switch', { name: 'حالت تاریک' }).click();
  await page.goto(`/tickets/${ticket.id}`);
  await palette(page, false);
  await page.screenshot({ path: '.local/ui-preview/theme-chat-light.png' });
  await page.keyboard.press('Control+f');
  await page.getByRole('searchbox').fill('پالت');
  await expect(page.locator('[data-search-result]')).toHaveCount(2);
  await palette(page, false);
  await page.getByRole('link', { name: 'تنظیمات', exact: true }).click();
  await page.getByRole('switch', { name: 'حالت تاریک' }).click();
  await palette(page, true);
  await page.goto('/profile');
  await expect(page).toHaveURL('http://localhost:3001/settings');
  await expect(page.getByRole('heading', { name: 'تنظیمات', exact: true })).toBeVisible();
  await palette(page, true);
  await page.request.post('/api/auth/sign-out', {
    headers: { origin: 'http://localhost:3001' },
    data: {},
  });
  await login(page, f.agent.phoneNumber!, f.password);
  await palette(page, true);
  await page.request.post('/api/auth/sign-out', {
    headers: { origin: 'http://localhost:3001' },
    data: {},
  });
  await login(page, f.admin.phoneNumber!, f.password);
  await palette(page, true);
  for (const path of ['/admin/users', '/admin/departments']) {
    await page.goto(path);
    await palette(page, true);
    await page.getByRole('switch', { name: 'حالت تاریک' }).click();
    await palette(page, false);
    await page.getByRole('switch', { name: 'حالت تاریک' }).click();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: '.local/ui-preview/theme-admin-dark.png' });
  expect(errors).toEqual([]);
  await db.$disconnect();
});
