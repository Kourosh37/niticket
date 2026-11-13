import { test, expect, type Page } from '../helpers/e2e-test';
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
  const invalid = await page.evaluate(() => {
    const roles = [
      'background',
      'surface',
      'surface-alt',
      'surface-hover',
      'foreground',
      'muted',
      'primary',
      'primary-hover',
      'on-primary',
      'accent',
      'accent-foreground',
      'accent-strong',
      'border',
      'border-strong',
      'focus',
      'overlay',
      'bubble-own',
      'bubble-border',
      'danger',
      'danger-surface',
      'success',
      'success-surface',
      'warning',
      'warning-surface',
    ];
    const allowed = new Set<string>();
    const probe = document.createElement('span');
    document.body.append(probe);
    for (const role of roles) {
      probe.style.color = `var(--${role})`;
      allowed.add(getComputedStyle(probe).color);
    }
    probe.remove();
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
  });
  expect(invalid).toEqual([]);
}

async function login(page: Page, number: string, password: string) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'ورود با رمز', exact: true }).click();
  await page.getByLabel('شماره موبایل', { exact: true }).fill(number);
  await page.getByLabel('رمز عبور', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'ورود', exact: true }).click();
  await expect(page).toHaveURL('http://localhost:3001/');
  // URL replacement can precede the authenticated RSC render and its final refresh.
  await expect(page.locator('.easy-app, .app-frame')).toBeVisible();
}

async function lightLayers(page: Page, layers: [string, string][]) {
  const colors = await page.evaluate(
    (roles) => {
      const probe = document.createElement('span');
      document.body.append(probe);
      const resolved: Record<string, string> = {};
      for (const role of roles) {
        probe.style.color = `var(--${role})`;
        resolved[role] = getComputedStyle(probe).color;
      }
      probe.remove();
      return resolved;
    },
    layers.map(([, role]) => role),
  );
  for (const [selector, role] of layers)
    await expect(page.locator(selector).first()).toHaveCSS('background-color', colors[role]);
  expect(colors.surface).not.toBe(colors.background);
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

test('uses semantic palettes across requester, officer, admin, chat and modal screens', async ({
  page,
  browserName,
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
  let replacingDocument = false;
  const navigate = async (path: string) => {
    replacingDocument = true;
    try {
      await page.goto(path);
    } finally {
      replacingDocument = false;
    }
  };
  page.on('pageerror', (error) => {
    // https://github.com/microsoft/playwright/issues/43120
    // WebKit reports native cancellations during document replacement as page errors.
    // Restrict the exception to native diagnostic names, this origin, and an active navigation.
    if (
      browserName === 'webkit' &&
      replacingDocument &&
      ['Fetch API cannot load http', 'EventSource cannot load http'].includes(error.name) &&
      /^\/{1,2}localhost:3001\/.* due to access control checks\.$/.test(error.message)
    )
      return;
    errors.push(error.message);
  });
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
  await lightLayers(page, [
    ['body', 'background'],
    ['.inbox-panel', 'surface'],
    ['.inbox-tabs', 'surface-alt'],
  ]);
  await page.screenshot({ path: '.local/ui-preview/theme-inbox-light.png' });
  await page.getByRole('link', { name: 'تنظیمات', exact: true }).click();
  await page.getByRole('switch', { name: 'حالت تاریک' }).click();
  await palette(page, true);
  await navigate('/');
  await page.screenshot({ path: '.local/ui-preview/theme-inbox-dark.png' });
  await navigate(`/tickets/${ticket.id}`);
  await expect(page.locator('.messenger-bubble')).toHaveCount(2);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('switch', { name: 'حالت تاریک' })).toHaveCount(0);
    if (width < 768) {
      await page.getByRole('button', { name: 'گزینه‌های گفتگو', exact: true }).click();
      await expect(
        page
          .getByRole('dialog', { name: 'گزینه‌های گفتگو', exact: true })
          .getByRole('link', { name: 'تنظیمات', exact: true }),
      ).toBeInViewport();
      await page.keyboard.press('Escape');
    } else await expect(page.getByRole('link', { name: 'تنظیمات', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await palette(page, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText('بررسی پالت گفتگو', { exact: true })).toBeInViewport();
  await expect(page.getByText('پاسخ واحد برای بررسی پالت', { exact: true })).toBeInViewport();
  await expect(page.locator('[data-testid="virtuoso-item-list"]')).toHaveCSS(
    'visibility',
    'visible',
  );
  await expect(page.getByText('بررسی پالت گفتگو', { exact: true })).toBeVisible();
  await page.screenshot({ path: '.local/ui-preview/theme-chat-dark.png' });
  await page.getByRole('button', { name: 'گزینه‌های گفتگو', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'گزینه‌های گفتگو', exact: true })
    .getByRole('button', { name: 'اطلاعات گفتگو', exact: true })
    .click();
  const info = page.getByRole('dialog', { name: 'اطلاعات گفتگو', exact: true });
  await expect(info).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'گزینه‌های گفتگو', exact: true })).toHaveCount(0);
  // The outgoing sheet is aria-hidden before its exit animation releases the keyboard layer.
  await expect(page.locator('.modal-content[data-state="closed"]')).toHaveCount(0);
  await palette(page, true);
  await page.keyboard.press('Escape');
  await expect(info).toHaveCount(0);
  await page.getByRole('button', { name: 'گزینه‌های گفتگو', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'گزینه‌های گفتگو', exact: true })
    .getByRole('link', { name: 'تنظیمات', exact: true })
    .click();
  await page.getByRole('switch', { name: 'حالت تاریک' }).click();
  await navigate(`/tickets/${ticket.id}`);
  await palette(page, false);
  await expect(page.locator('[data-testid="virtuoso-item-list"]')).toHaveCSS(
    'visibility',
    'visible',
  );
  await expect(page.getByText('بررسی پالت گفتگو', { exact: true })).toBeVisible();
  await expect(page.getByText('بررسی پالت گفتگو', { exact: true })).toBeInViewport();
  await expect(page.getByText('پاسخ واحد برای بررسی پالت', { exact: true })).toBeInViewport();
  await lightLayers(page, [
    ['.messenger-chat', 'background'],
    ['.messenger-bubble:not(.bubble-own)', 'surface'],
    ['.messenger-bubble.bubble-own', 'bubble-own'],
    ['.messenger-input-row textarea', 'background'],
  ]);
  await page.screenshot({ path: '.local/ui-preview/theme-chat-light.png' });
  await page.keyboard.press('Control+f');
  await page.getByRole('searchbox').fill('پالت');
  await expect(page.locator('[data-search-result]')).toHaveCount(2);
  await palette(page, false);
  await page.getByRole('button', { name: 'گزینه‌های گفتگو', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'گزینه‌های گفتگو', exact: true })
    .getByRole('link', { name: 'تنظیمات', exact: true })
    .click();
  await page.getByRole('switch', { name: 'حالت تاریک' }).click();
  await palette(page, true);
  await navigate('/profile');
  await expect(page).toHaveURL('http://localhost:3001/settings');
  await expect(page.getByRole('heading', { name: 'تنظیمات', exact: true })).toBeVisible();
  await palette(page, true);
  // Close the authenticated shell before switching accounts through the test
  // API; its live session guard otherwise correctly races the next navigation.
  await navigate('/login');
  await page.request.post('/api/auth/sign-out', {
    headers: { origin: 'http://localhost:3001' },
    data: {},
  });
  await login(page, f.agent.phoneNumber!, f.password);
  await palette(page, true);
  await navigate('/login');
  await page.request.post('/api/auth/sign-out', {
    headers: { origin: 'http://localhost:3001' },
    data: {},
  });
  await login(page, f.admin.phoneNumber!, f.password);
  await palette(page, true);
  for (const path of ['/admin/users', '/admin/departments']) {
    await navigate(path);
    await palette(page, true);
    await page.getByRole('switch', { name: 'حالت تاریک' }).click();
    await palette(page, false);
    if (path === '/admin/departments') {
      await expect(page.locator('.admin-card').first()).toBeVisible();
      await page.screenshot({ path: '.local/ui-preview/theme-admin-light.png' });
    }
    await page.getByRole('switch', { name: 'حالت تاریک' }).click();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: '.local/ui-preview/theme-admin-dark.png' });
  expect(errors).toEqual([]);
});
