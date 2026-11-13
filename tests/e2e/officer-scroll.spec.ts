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

for (const width of [390, 1440]) {
  test(`an officer can leave the chat bottom with small scrolls and keep reading through composer resizing at ${width}px`, async ({
    page,
  }) => {
    const { fixtures } = await import('../helpers/fixtures');
    const { db } = await import('@niticket/database');
    const { addMessage } = await import('@niticket/core/application/tickets');
    const f = await fixtures();
    const student = await f.actor(f.student.id);
    const ticket = await db.ticket.create({
      data: {
        creatorId: f.student.id,
        departmentId: f.department.id,
        subject: 'پیمایش مسئول واحد',
      },
    });
    const start = Date.now() - 300000;
    await db.message.createMany({
      data: Array.from({ length: 160 }, (_, index) => ({
        ticketId: ticket.id,
        senderId: index % 2 ? f.manager.id : f.student.id,
        body: `پیمایش مسئول ${index}\n${'متن پیام با ارتفاع متغیر\n'.repeat(index % 5)}`,
        visibility: index % 7 === 0 ? ('INTERNAL' as const) : ('PUBLIC' as const),
        createdAt: new Date(start + index * 1000),
      })),
    });
    expect(
      (
        await page.request.post('/api/auth/sign-in/phone-number', {
          headers: { origin },
          data: { phoneNumber: f.manager.phoneNumber, password: f.password },
        })
      ).ok(),
    ).toBe(true);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/tickets/${ticket.id}`);
    const area = page.getByLabel('پیام‌های گفتگو', { exact: true });
    const gap = () =>
      area.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop);
    await expect(page.getByText('پیمایش مسئول 159', { exact: false })).toBeInViewport({ ratio: 1 });
    await expect(page.locator('[data-testid="virtuoso-item-list"]')).toHaveCSS(
      'visibility',
      'visible',
    );
    await addMessage(student, ticket.id, {
      version: 1,
      body: 'اولین پیام بعد از باز کردن چت',
    });
    await expect(page.getByText('اولین پیام بعد از باز کردن چت', { exact: true })).toBeInViewport({
      ratio: 1,
      timeout: 15000,
    });
    await expect.poll(gap).toBeLessThan(100);
    const initialGap = await gap();
    await area.hover();
    await page.mouse.wheel(0, -40);
    await expect.poll(gap).toBeGreaterThan(initialGap + 25);
    await page
      .getByLabel('پاسخ شما', { exact: true })
      .fill('خط اول پیش‌نویس\nخط دوم\nخط سوم\nخط چهارم');
    await expect.poll(gap).toBeGreaterThan(25);
    // Let row/composer ResizeObservers settle: an upward gesture must stay detached.
    await page.waitForTimeout(350);
    expect(await gap()).toBeGreaterThan(25);
    const reply = page.getByLabel('پاسخ شما', { exact: true });
    await reply.fill('');
    await expect.poll(gap).toBeGreaterThan(25);
    await expect.poll(gap).toBeLessThan(100);
    const readingTop = await area.evaluate((node) => node.scrollTop);
    await addMessage(student, ticket.id, {
      version: 2,
      body: 'پاسخ تازه هنگام خواندن پیام‌های قبلی',
    });
    await expect(page.getByRole('button', { name: 'پیام جدید', exact: true })).toBeVisible({
      timeout: 15000,
    });
    expect(Math.abs((await area.evaluate((node) => node.scrollTop)) - readingTop)).toBeLessThan(3);
    await page.getByRole('button', { name: 'پیام جدید', exact: true }).click();
    await expect(
      page.getByText('پاسخ تازه هنگام خواندن پیام‌های قبلی', { exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect.poll(gap).toBeLessThan(2);
    // A gesture can end at the clamped bottom without a final native scroll event.
    await area.dispatchEvent('touchmove');
    await area.dispatchEvent('touchend');
    await area.dispatchEvent('pointerdown');
    await area.dispatchEvent('pointerup');
    await addMessage(student, ticket.id, {
      version: 3,
      body: 'پاسخ بعد از بازگشت به انتها',
    });
    await expect(page.getByText('پاسخ بعد از بازگشت به انتها', { exact: true })).toBeInViewport({
      ratio: 1,
      timeout: 15000,
    });
    await area.hover();
    for (let tick = 0; tick < 8; tick++) {
      await page.mouse.wheel(0, -40);
      await page.waitForTimeout(60);
    }
    await expect.poll(gap).toBeGreaterThan(200);
    const beforeDown = await area.evaluate((node) => node.scrollTop);
    await page.mouse.wheel(0, 40);
    await expect
      .poll(() => area.evaluate((node) => node.scrollTop))
      .toBeGreaterThan(beforeDown + 25);
    await page.mouse.wheel(0, -100000);
    const older = page.getByRole('button', { name: 'پیام‌های قبلی', exact: true });
    await expect(older).toBeInViewport();
    const response = page.waitForResponse(
      (result) =>
        result.url().includes(`/tickets/${ticket.id}/messages?cursor=`) && result.status() === 200,
    );
    await older.click();
    expect((await (await response).json()).data.items).toHaveLength(50);
    await expect(page.getByText('پیمایش مسئول 110', { exact: false })).toBeInViewport();
    await area.hover();
    const afterPaging = await area.evaluate((node) => node.scrollTop);
    await page.mouse.wheel(0, 40);
    await expect
      .poll(() => area.evaluate((node) => node.scrollTop))
      .toBeGreaterThan(afterPaging + 25);
    expect(await page.locator('[data-message-id]').count()).toBeLessThan(40);
    await page.mouse.wheel(0, 100000);
    await expect.poll(gap).toBeLessThan(2);
    await addMessage(student, ticket.id, {
      version: 4,
      body: 'Following resumes after a deliberate wheel return',
    });
    await expect(
      page.getByText('Following resumes after a deliberate wheel return', { exact: true }),
    ).toBeInViewport();
    await db.$disconnect();
  });
}
