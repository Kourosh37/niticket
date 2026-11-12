import { test, expect } from '@playwright/test';
import { loadEnvFile } from 'node:process';

try {
  loadEnvFile('.env');
} catch {
  /* CI injects environment. */
}
const database = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!);
if (!process.env.TEST_DATABASE_URL) database.pathname = '/niticket_test';
if (!database.pathname.endsWith('_test')) throw new Error('Test database required');
process.env.DATABASE_URL = database.toString();

for (const role of ['student', 'manager'] as const) {
  test(`animates rounded ${role} inbox categories, preserves filters and supports history and reduced motion`, async ({
    page,
  }) => {
    const { fixtures } = await import('../helpers/fixtures');
    const { db } = await import('@niticket/database');
    const f = await fixtures();
    expect(
      (
        await page.request.post('/api/auth/sign-in/phone-number', {
          headers: { origin: 'http://localhost:3001' },
          data: { phoneNumber: f[role].phoneNumber, password: f.password },
        })
      ).ok(),
    ).toBe(true);
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
    await page.goto(`/?departmentId=${f.department.id}&view=all`);
    const nav = page.getByRole('navigation', { name: 'نمایش گفتگوها', exact: true });
    const indicator = nav.locator('.inbox-tabs-indicator');
    await expect(nav.getByRole('link', { name: 'همه گفتگوها', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      await indicator.evaluate((element) => parseFloat(getComputedStyle(element).borderRadius)),
    ).toBeGreaterThanOrEqual(12);
    await expect(indicator).not.toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await page.evaluate(() => {
      const state = { indicator: document.querySelector('.inbox-tabs-indicator'), transitions: 0 };
      Object.assign(window, { inboxMotion: state });
      state.indicator!.addEventListener('transitionrun', (event) => {
        if ((event as TransitionEvent).propertyName === 'transform') state.transitions++;
      });
    });
    const action = role === 'student' ? 'پاسخ‌های جدید' : 'پیام‌های جدید';
    await nav.getByRole('link', { name: action, exact: true }).click();
    await expect(nav.getByRole('link', { name: action, exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { inboxMotion: { transitions: number } }).inboxMotion.transitions,
        ),
      )
      .toBeGreaterThan(0);
    expect(
      await indicator.evaluate(
        (element) =>
          element ===
          (window as unknown as { inboxMotion: { indicator: Element } }).inboxMotion.indicator,
      ),
    ).toBe(true);
    expect(new URL(page.url()).searchParams.get('departmentId')).toBe(f.department.id);
    await nav.getByRole('link', { name: 'پاسخ داده‌شده', exact: true }).click();
    await expect(nav.getByRole('link', { name: 'پاسخ داده‌شده', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await page.goBack();
    await expect(nav.getByRole('link', { name: action, exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      // The system preference is applied by the document bootstrap; the inbox
      // itself does not mount the settings page's theme control subscription.
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        const active = nav.locator('[data-selected="true"]');
        await expect(active).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await expect
          .poll(async () => {
            const pill = (await indicator.boundingBox())!,
              link = (await active.boundingBox())!;
            return Math.abs(pill.x - link.x) + Math.abs(pill.width - link.width);
          })
          .toBeLessThan(2);
        expect(
          await nav
            .getByRole('link')
            .evaluateAll((links) =>
              links.every((link) => link.getBoundingClientRect().height >= 44),
            ),
        ).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        if (width === 390)
          await page.screenshot({
            path: `.local/ui-preview/inbox-tabs-${role}-${theme}.png`,
            animations: 'disabled',
          });
      }
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(indicator).toHaveCSS('transition-duration', '0s');
    const all = nav.getByRole('link', { name: 'همه گفتگوها', exact: true });
    await all.focus();
    await page.keyboard.press('Enter');
    await expect(all).toHaveAttribute('aria-current', 'page');
    await expect(nav).toHaveAttribute('aria-busy', 'false');
    await db.$disconnect();
  });
}
