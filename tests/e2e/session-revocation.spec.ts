import { test, expect } from '@playwright/test';
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
const origin = 'http://localhost:3001';

for (const role of ['student', 'manager', 'admin'] as const) {
  test(`${role} revokes a chosen device from an older valid login and can sign out the current device`, async ({
    browser,
  }) => {
    const { fixtures } = await import('../helpers/fixtures');
    const { db } = await import('@niticket/database');
    const f = await fixtures();
    const current = await browser.newContext(),
      target = await browser.newContext(),
      untouched = await browser.newContext(),
      privacy = await browser.newContext();
    try {
      for (const context of [current, target, untouched, privacy]) {
        expect(
          (
            await context.request.post('/api/auth/sign-in/phone-number', {
              headers: { origin },
              data: { phoneNumber: f[role].phoneNumber, password: f.password },
            })
          ).status(),
        ).toBe(200);
      }
      const currentId = (await (await current.request.get('/api/v1/users/me/sessions')).json()).data
        .current.id;
      const targetId = (await (await target.request.get('/api/v1/users/me/sessions')).json()).data
        .current.id;
      await db.session.update({
        where: { id: currentId },
        data: { createdAt: new Date(Date.now() - 86400000) },
      });
      const privacyId = (await (await privacy.request.get('/api/v1/users/me/sessions')).json()).data
        .current.id;
      // APIRequestContext sends no implicit Origin, unlike a normal browser fetch.
      const direct = await current.request.delete(`/api/v1/users/me/sessions/${privacyId}`, {
        headers: { 'sec-fetch-site': 'same-origin' },
      });
      expect(direct.status()).toBe(200);
      expect((await privacy.request.get('/api/v1/users/me')).status()).toBe(401);
      const page = await current.newPage();
      const targetPage = await target.newPage();
      await targetPage.clock.install();
      await targetPage.goto('/profile');
      await expect(targetPage.getByRole('region', { name: 'نشست‌های فعال' })).toBeVisible();
      // Reproduce a local browser/privacy layer omitting Origin on DELETE.
      await page.route('**/api/v1/users/me/sessions/*', async (route) => {
        if (route.request().method() !== 'DELETE') return route.continue();
        const headers = await route.request().allHeaders();
        delete headers.origin;
        headers['sec-fetch-site'] = 'same-origin';
        await route.continue({ headers });
      });
      page.on('dialog', (dialog) => dialog.accept());
      await page.goto('/profile');
      const section = page.getByRole('region', { name: 'نشست‌های فعال' });
      const card = section.locator(`[data-session-id="${targetId}"]`);
      await expect(card).toBeVisible();
      const removed = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/sessions/${targetId}`) &&
          response.request().method() === 'DELETE',
      );
      await card.getByRole('button', { name: 'خروج از دستگاه', exact: true }).click();
      expect((await removed).status()).toBe(200);
      await expect(card).toHaveCount(0);
      await expect(
        section.getByRole('group', { name: 'تأیید هویت برای ادامه عملیات' }),
      ).toHaveCount(0);
      expect((await target.request.get('/api/v1/users/me')).status()).toBe(401);
      await targetPage.bringToFront();
      await targetPage.clock.fastForward(31000);
      await expect(targetPage).toHaveURL(origin + '/login');
      expect((await current.request.get('/api/v1/users/me')).status()).toBe(200);
      expect((await untouched.request.get('/api/v1/users/me')).status()).toBe(200);
      await section
        .locator(`[data-session-id="${currentId}"]`)
        .getByRole('button', { name: 'خروج از این دستگاه', exact: true })
        .click();
      await expect(page).toHaveURL(origin + '/login');
      expect((await current.request.get('/api/v1/users/me')).status()).toBe(401);
      expect((await untouched.request.get('/api/v1/users/me')).status()).toBe(200);
    } finally {
      await current.close();
      await target.close();
      await untouched.close();
      await privacy.close();
      await db.$disconnect();
    }
  });
}
