import { test, expect, type Page } from '@playwright/test';
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

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  const clipped = await page.locator('#main-content').evaluate((main) => {
    return [...main.querySelectorAll<HTMLElement>('button, a[href], input, textarea')]
      .filter(
        (node) => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden',
      )
      .filter((node) => {
        let parent = node.parentElement;
        while (parent && main.contains(parent)) {
          const overflow = getComputedStyle(parent).overflowX;
          if (['auto', 'scroll'].includes(overflow) && parent.scrollWidth > parent.clientWidth + 1)
            return false;
          parent = parent.parentElement;
        }
        const box = node.getBoundingClientRect();
        return box.width > 1 && (box.left < -1 || box.right > innerWidth + 1);
      })
      .map((node) => node.getAttribute('aria-label') || node.textContent || node.tagName);
  });
  expect(clipped, `Controls outside the viewport at ${page.url()}`).toEqual([]);
}

test('keeps chat controls, action sheets and the composer inside mobile and keyboard viewports', async ({
  page,
}) => {
  test.setTimeout(90000);
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const f = await fixtures();
  await db.notification.create({
    data: { userId: f.manager.id, eventId: randomUUID(), title: 'اعلان تازه در منوی گفتگو' },
  });
  const ticket = await db.ticket.create({
    data: {
      creatorId: f.student.id,
      departmentId: f.department.id,
      subject: 'چت واکنش‌گرا',
      messages: {
        create: { senderId: f.student.id, body: 'فضای کافی برای مطالعه و نوشتن پیام در موبایل' },
      },
    },
  });
  expect(
    (
      await page.request.post('/api/auth/sign-in/phone-number', {
        headers: { origin },
        data: { phoneNumber: f.manager.phoneNumber, password: f.password },
      })
    ).ok(),
  ).toBe(true);
  await page.goto(`/tickets/${ticket.id}`);
  await expect(
    page.getByText('فضای کافی برای مطالعه و نوشتن پیام در موبایل', { exact: true }),
  ).toBeVisible();
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [844, 390],
    [768, 1024],
    [1440, 900],
  ]) {
    await page.setViewportSize({ width, height });
    const header = page.locator('.messenger-header');
    await expect(header).toBeInViewport();
    await expect(page.getByLabel('پاسخ شما', { exact: true })).toBeInViewport({ ratio: 1 });
    const boxes = await header.locator('button:visible, a:visible').evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return { left: box.left, right: box.right, width: box.width };
      }),
    );
    for (const box of boxes) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(width);
      expect(box.width).toBeGreaterThanOrEqual(40);
    }
    const dock = page.locator('.navigation-chat');
    if (width <= 767 || height <= 500) await expect(dock).toBeHidden();
    else await expect(dock).toBeInViewport();
    const viewport = await page.locator('.messenger-message-area').boundingBox();
    expect(viewport!.height).toBeGreaterThan(height * 0.45);
    await fits(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const menuButton = page.getByRole('button', { name: 'گزینه‌های گفتگو', exact: true });
  await menuButton.click();
  const menu = page.getByRole('dialog', { name: 'گزینه‌های گفتگو', exact: true });
  await expect(menu).toBeVisible();
  await expect(menu.locator('.dock-unread-count')).toHaveText('۱');
  await expect
    .poll(async () => {
      const box = (await menu.boundingBox())!;
      return box.y + box.height;
    })
    .toBeLessThanOrEqual(845);
  await page.screenshot({ path: '.local/ui-preview/mobile-chat-actions-390.png' });
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(menuButton).toBeFocused();
  await menuButton.click();
  await menu.getByRole('button', { name: 'اطلاعات گفتگو', exact: true }).click();
  const info = page.getByRole('dialog', { name: 'اطلاعات گفتگو', exact: true });
  await expect(info).toBeVisible();
  await info.getByRole('button', { name: 'بستن', exact: true }).click();
  await expect(menuButton).toBeFocused();
  await menuButton.click();
  await menu.getByRole('button', { name: 'جستجو در این گفتگو', exact: true }).click();
  await expect(page.getByRole('region', { name: 'جستجو در این گفتگو', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'بستن جستجو', exact: true }).click();
  const reply = page.getByLabel('پاسخ شما', { exact: true });
  await reply.fill('پیش‌نویس با کیبورد باز');
  await page.setViewportSize({ width: 390, height: 430 });
  await expect(page.locator('html')).toHaveAttribute('data-keyboard-open', 'true');
  await expect(reply).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: 'ارسال پیام', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await menuButton.click();
  await expect(menu).toBeInViewport({ ratio: 1 });
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-overlay')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('html')).not.toHaveAttribute('data-keyboard-open', 'true');
  await expect(reply).toHaveValue('پیش‌نویس با کیبورد باز');
  await expect(
    page.getByText('فضای کافی برای مطالعه و نوشتن پیام در موبایل', { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: '.local/ui-preview/mobile-chat-responsive-390.png' });
  await db.$disconnect();
});

for (const role of ['student', 'manager', 'admin'] as const) {
  test(`keeps ${role} pages readable at mobile, tablet and desktop widths`, async ({ page }) => {
    test.setTimeout(180000);
    const { fixtures } = await import('../helpers/fixtures');
    const { db } = await import('@niticket/database');
    const f = await fixtures();
    await db.department.update({
      where: { id: f.department.id },
      data: {
        name: 'واحد آموزش و پیگیری درخواست‌های دانشجویی با عنوان طولانی',
        displayOrder: -1000,
      },
    });
    await db.ticket.create({
      data: {
        creatorId: f.student.id,
        departmentId: f.department.id,
        subject: 'عنوان طولانی گفتگو برای بررسی نمایش محتوا در صفحه‌های باریک و کوچک',
      },
    });
    expect(
      (
        await page.request.post('/api/auth/sign-in/phone-number', {
          headers: { origin },
          data: { phoneNumber: f[role].phoneNumber, password: f.password },
        })
      ).ok(),
    ).toBe(true);
    const routes =
      role === 'admin'
        ? [
            '/',
            '/admin/users',
            '/admin/departments',
            '/admin/settings',
            '/admin/audit',
            '/reports',
            '/profile',
          ]
        : role === 'manager'
          ? ['/', '/saved-replies', '/reports', '/settings', '/notifications', '/search', '/help']
          : ['/', '/tickets/new', '/settings', '/notifications', '/search', '/help'];
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of routes) {
        await page.goto(route);
        await expect(page.locator('#main-content')).toBeVisible();
        await expect(page.locator('#main-content .skeleton')).toHaveCount(0);
        await expect(page.locator('#main-content h1').first()).toBeAttached();
        await fits(page);
        if (width === 320 && route === '/settings')
          await page.screenshot({
            path: `.local/ui-preview/responsive-${role}-settings-320.png`,
            fullPage: true,
          });
        if (width === 320 && route === '/reports')
          await page.screenshot({
            path: `.local/ui-preview/responsive-${role}-reports-320.png`,
            fullPage: true,
          });
      }
    }
    if (role === 'admin') {
      await page.setViewportSize({ width: 390, height: 844 });
      const button = page.getByRole('button', { name: 'باز کردن منو', exact: true });
      await button.click();
      const drawer = page.getByRole('dialog', { name: 'منوی مدیریت', exact: true });
      await expect(drawer).toBeInViewport({ ratio: 1 });
      await drawer.getByRole('link', { name: 'مدیریت کاربران', exact: true }).focus();
      await page.screenshot({ path: '.local/ui-preview/mobile-admin-drawer-390.png' });
      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
      await expect(button).toBeFocused();
      await button.click();
      await drawer.getByRole('link', { name: 'مدیریت کاربران', exact: true }).click();
      await expect(page).toHaveURL(origin + '/admin/users');
      await expect(drawer).toBeHidden();
      await page.getByRole('button', { name: 'باز کردن منو', exact: true }).click();
      await drawer.getByRole('button', { name: new RegExp(f.admin.name) }).click();
      await expect(page).toHaveURL(origin + '/profile');
      await expect(drawer).toBeHidden();
      await page.getByRole('button', { name: 'باز کردن منو', exact: true }).click();
      await page.goBack();
      await expect(page).toHaveURL(origin + '/admin/users');
      await expect(drawer).toBeHidden();
      await page.goForward();
      await expect(page).toHaveURL(origin + '/profile');
      await expect(drawer).toBeHidden();
      await page.setViewportSize({ width: 844, height: 390 });
      await page.getByRole('button', { name: 'باز کردن منو', exact: true }).click();
      await expect(drawer).toBeInViewport({ ratio: 1 });
      await drawer.evaluate((node) => {
        node.scrollTop = node.scrollHeight;
      });
      await expect(drawer.getByRole('button', { name: 'بستن', exact: true })).toBeInViewport({
        ratio: 1,
      });
      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
    }
    await db.$disconnect();
  });
}

test('keeps sign-in, registration and password recovery usable on small screens', async ({
  page,
}) => {
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    for (const route of ['/login', '/register', '/forgot-password']) {
      await page.goto(route);
      await expect(page.locator('.auth-form')).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      const clipped = await page
        .locator('.auth-form input:visible, .auth-form button:visible')
        .evaluateAll((nodes) =>
          nodes.some((node) => {
            const box = node.getBoundingClientRect();
            return box.left < -1 || box.right > innerWidth + 1;
          }),
        );
      expect(clipped).toBe(false);
    }
  }
});
