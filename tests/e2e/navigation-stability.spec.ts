import { test, expect } from '../helpers/e2e-test';
import { fixtures } from '../helpers/fixtures';
import { db } from '@niticket/database';

// Chromium otherwise hides the desktop scrollbar in headless mode, concealing
// layout shifts caused by a dropdown's body scroll lock.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

for (const role of ['student', 'agent'] as const) {
  test(`keeps the ${role} navigation fixed while opening and closing unit dropdowns`, async ({
    page,
  }) => {
    const f = await fixtures();
    await db.departmentMembership.create({
      data: {
        userId: f.agent.id,
        departmentId: f.destination.id,
        role: 'AGENT',
        assignedBy: f.admin.id,
      },
    });
    await db.ticket.createMany({
      data: Array.from({ length: 25 }, (_, index) => ({
        creatorId: f.student.id,
        departmentId: f.department.id,
        subject: `Navigation stability ${index}`,
      })),
    });
    const tickets = await db.ticket.findMany({
      where: { creatorId: f.student.id },
      select: { id: true },
    });
    await db.message.createMany({
      data: tickets.map(({ id }) => ({
        ticketId: id,
        senderId: f.student.id,
        body: 'A conversation visible to its officer',
      })),
    });
    expect(
      (
        await page.request.post('/api/auth/sign-in/phone-number', {
          headers: { origin: 'http://localhost:3001' },
          data: { phoneNumber: f[role].phoneNumber, password: f.password },
        })
      ).ok(),
    ).toBe(true);
    await page.goto('/?view=all');
    // Radix hides the background from assistive technology while its menu is open.
    const dock = page.locator('.easy-navigation');
    const select = page.getByRole('combobox', { name: 'واحد پاسخ‌گو', exact: true });
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(select).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight)).toBe(
        true,
      );
      const before = (await dock.boundingBox())!;
      const assertPosition = async () => {
        const current = (await dock.boundingBox())!;
        for (const dimension of ['x', 'y', 'width', 'height'] as const)
          expect(Math.abs(current[dimension] - before[dimension]), dimension).toBeLessThan(1);
      };
      for (let attempt = 0; attempt < 2; attempt++) {
        await select.click();
        await expect(page.getByRole('listbox')).toBeVisible();
        await expect(page.locator('body')).toHaveAttribute('data-scroll-locked', '1');
        await assertPosition();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('listbox')).toBeHidden();
        await expect(page.locator('body')).not.toHaveAttribute('data-scroll-locked');
        await assertPosition();
      }
    }
  });
}
