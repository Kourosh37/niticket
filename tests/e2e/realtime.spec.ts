import { test, expect, type Page } from '@playwright/test';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';

try {
  loadEnvFile('.env');
} catch {
  /* CI injects environment. */
}
const database = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!);
if (!process.env.TEST_DATABASE_URL) database.pathname = '/niticket_test';
if (!database.pathname.endsWith('_test')) throw new Error('Test database required');
process.env.DATABASE_URL = database.toString();
const origin = 'http://localhost:3001';

async function observe(page: Page) {
  await page.addInitScript(() => {
    const state = { opened: 0, ready: 0, changes: [] as string[] };
    Object.assign(window, { __sse: state });
    const Native = window.EventSource;
    window.EventSource = class extends Native {
      constructor(url: string | URL, options?: EventSourceInit) {
        super(url, options);
        state.opened++;
        this.addEventListener('ready', () => state.ready++);
        this.addEventListener('change', (event) =>
          state.changes.push((event as MessageEvent).data),
        );
      }
    };
  });
}

async function streamState(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { __sse: { opened: number; ready: number; changes: string[] } }).__sse,
  );
}

test('receives live replies without remounting or stopping an active voice recording', async ({
  browser,
}) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const { createTicket, addMessage } = await import('@niticket/core/application/tickets');
  const f = await fixtures();
  const ticket = await createTicket(
    await f.actor(f.student.id),
    { departmentId: f.department.id, subject: 'دریافت هنگام ضبط', body: 'پیام آغازین آزمون ضبط' },
    randomUUID(),
  );
  const context = await browser.newContext({ permissions: ['microphone'] });
  try {
    await context.request.post('/api/auth/sign-in/phone-number', {
      headers: { origin },
      data: { phoneNumber: f.student.phoneNumber, password: f.password },
    });
    const page = await context.newPage();
    await observe(page);
    await page.goto(`/tickets/${ticket.id}`);
    await page.bringToFront();
    await expect.poll(async () => (await streamState(page)).ready).toBe(1);
    await page.getByRole('button', { name: 'ضبط پیام صوتی', exact: true }).click();
    const stop = page.getByRole('button', { name: 'پایان ضبط', exact: true });
    await expect(stop).toBeVisible();
    const original = await stop.elementHandle();
    await addMessage(await f.actor(f.agent.id), ticket.id, {
      version: 1,
      body: 'پاسخ هنگام ضبط صدا',
    });
    await expect(page.getByText('پاسخ هنگام ضبط صدا', { exact: true })).toBeVisible({
      timeout: 4000,
    });
    expect(await original!.evaluate((element) => element.isConnected)).toBe(true);
    await expect(page.getByRole('button', { name: 'ارسال پیام', exact: true })).toBeDisabled();
    await expect(page.getByLabel('مدت ضبط')).not.toHaveText('۰۰:۰۰');
    await stop.click();
    await expect(page.getByLabel('پیش‌شنوی پیام صوتی', { exact: true })).toBeVisible();
  } finally {
    await context.close();
    await db.$disconnect();
  }
});

test('streams public messages and receipts, keeps drafts, excludes private events and reuses the connection across navigation', async ({
  browser,
}) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const { createTicket, addMessage } = await import('@niticket/core/application/tickets');
  const { markMessagesSeen } = await import('@niticket/core/application/message-receipts');
  const f = await fixtures(),
    student = await f.actor(f.student.id),
    staff = await f.actor(f.agent.id);
  const ticket = await createTicket(
    student,
    { departmentId: f.department.id, subject: 'گفتگوی بلادرنگ', body: 'شروع گفتگو' },
    randomUUID(),
  );
  const context = await browser.newContext();
  try {
    expect(
      (
        await context.request.post('/api/auth/sign-in/phone-number', {
          headers: { origin },
          data: { phoneNumber: f.student.phoneNumber, password: f.password },
        })
      ).ok(),
    ).toBe(true);
    const page = await context.newPage();
    await observe(page);
    await page.goto(`/tickets/${ticket.id}`);
    await page.bringToFront();
    await expect.poll(async () => (await streamState(page)).ready).toBe(1);
    const input = page.getByLabel('پاسخ شما', { exact: true });
    await input.fill('پیش‌نویس حفظ شود');
    // After the initial ready resync, live mode must not use the old five-second poll.
    let syncs = 0;
    page.on('request', (request) => {
      if (request.url().includes(`/tickets/${ticket.id}/sync`)) syncs++;
    });
    await page.waitForTimeout(1000);
    const baseline = syncs;
    await page.waitForTimeout(5500);
    expect(syncs).toBeLessThanOrEqual(baseline + 1);
    const beforePrivate = (await streamState(page)).changes.length;
    await addMessage(staff, ticket.id, {
      version: 1,
      body: 'اطلاعات محرمانه داخلی',
      visibility: 'INTERNAL',
    });
    await page.waitForTimeout(350);
    expect((await streamState(page)).changes.length).toBe(beforePrivate);
    const publicReply = await addMessage(staff, ticket.id, { version: 2, body: 'پاسخ فوری مسئول' });
    await expect(page.getByText('پاسخ فوری مسئول', { exact: true })).toBeVisible({ timeout: 4000 });
    await expect(input).toHaveValue('پیش‌نویس حفظ شود');
    await expect(page.getByText('اطلاعات محرمانه داخلی', { exact: true })).toHaveCount(0);
    expect((await streamState(page)).changes.join('')).not.toContain('پاسخ فوری مسئول');
    await input.click();
    await expect
      .poll(
        async () =>
          !!(await db.message.findUniqueOrThrow({ where: { id: publicReply.id } })).readAt,
      )
      .toBe(true);
    const own = await db.message.findFirstOrThrow({
      where: { ticketId: ticket.id, senderId: student.id },
    });
    await markMessagesSeen(staff, ticket.id, { messageIds: [own.id] });
    await expect(page.locator(`[data-message-id="${own.id}"] [aria-label="دیده شد"]`)).toHaveCount(
      1,
    );
    await page
      .getByRole('link', { name: /گفتگوها/ })
      .first()
      .click();
    await expect(page).toHaveURL(origin + '/');
    expect((await streamState(page)).opened).toBe(1);
  } finally {
    await context.close();
    await db.$disconnect();
  }
});

test('recovers changes missed while offline and falls back to HTTP when streaming is unavailable', async ({
  browser,
}) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const { createTicket, addMessage } = await import('@niticket/core/application/tickets');
  const f = await fixtures(),
    student = await f.actor(f.student.id),
    staff = await f.actor(f.agent.id);
  const ticket = await createTicket(
    student,
    { departmentId: f.department.id, subject: 'بازیابی ارتباط', body: 'شروع گفتگوی آزمون' },
    randomUUID(),
  );
  const context = await browser.newContext();
  try {
    await context.request.post('/api/auth/sign-in/phone-number', {
      headers: { origin },
      data: { phoneNumber: f.student.phoneNumber, password: f.password },
    });
    const page = await context.newPage();
    await observe(page);
    await page.goto(`/tickets/${ticket.id}`);
    await expect.poll(async () => (await streamState(page)).ready).toBe(1);
    await context.setOffline(true);
    await addMessage(staff, ticket.id, { version: 1, body: 'پاسخ هنگام قطع اتصال' });
    await context.setOffline(false);
    await expect.poll(async () => (await streamState(page)).ready).toBeGreaterThanOrEqual(2);
    await expect(page.getByText('پاسخ هنگام قطع اتصال', { exact: true })).toBeVisible();
    await context.route('**/api/v1/events', (route) => route.abort());
    await page.reload();
    await addMessage(staff, ticket.id, { version: 2, body: 'پاسخ از مسیر بازیابی HTTP' });
    await expect(page.getByText('پاسخ از مسیر بازیابی HTTP', { exact: true })).toBeVisible({
      timeout: 12000,
    });
  } finally {
    await context.close();
    await db.$disconnect();
  }
});

test('redirects a revoked open stream without waiting for the session polling interval', async ({
  browser,
}) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const f = await fixtures();
  const first = await browser.newContext(),
    target = await browser.newContext();
  try {
    for (const context of [first, target])
      await context.request.post('/api/auth/sign-in/phone-number', {
        headers: { origin },
        data: { phoneNumber: f.student.phoneNumber, password: f.password },
      });
    const id = (await (await target.request.get('/api/v1/users/me/sessions')).json()).data.current
      .id;
    const page = await target.newPage();
    await observe(page);
    await page.goto('/');
    await expect.poll(async () => (await streamState(page)).ready).toBe(1);
    expect(
      (await first.request.delete(`/api/v1/users/me/sessions/${id}`, { headers: { origin } })).ok(),
    ).toBe(true);
    await expect(page).toHaveURL(origin + '/login', { timeout: 4000 });
    expect((await first.request.get('/api/v1/users/me')).ok()).toBe(true);
  } finally {
    await first.close();
    await target.close();
    await db.$disconnect();
  }
});

test('updates saved replies, inbox entries and unread counts through their scoped streams', async ({
  browser,
}) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const { createTicket, addMessage } = await import('@niticket/core/application/tickets');
  const { processNotification } = await import('@niticket/core/application/jobs');
  const { createSavedReply, updateSavedReply, deleteSavedReply } =
    await import('@niticket/core/application/saved-replies');
  const f = await fixtures(),
    staff = await f.actor(f.agent.id),
    student = await f.actor(f.student.id);
  const officer = await browser.newContext(),
    requester = await browser.newContext();
  try {
    for (const [context, user] of [
      [officer, f.agent],
      [requester, f.student],
    ] as const)
      expect(
        (
          await context.request.post('/api/auth/sign-in/phone-number', {
            headers: { origin },
            data: { phoneNumber: user.phoneNumber, password: f.password },
          })
        ).ok(),
      ).toBe(true);
    const o = await officer.newPage(),
      s = await requester.newPage();
    await observe(o);
    await observe(s);
    await o.goto('/saved-replies');
    await s.goto('/');
    await expect.poll(async () => (await streamState(o)).ready).toBe(1);
    await expect.poll(async () => (await streamState(s)).ready).toBe(1);
    const reply = await createSavedReply(staff, {
      departmentId: f.department.id,
      clientId: randomUUID(),
      title: 'پاسخ آماده بلادرنگ',
      body: 'متن نمونه پاسخ',
    });
    await expect(o.getByText('پاسخ آماده بلادرنگ', { exact: true })).toBeVisible({ timeout: 4000 });
    await updateSavedReply(staff, reply.id, {
      version: 1,
      title: 'پاسخ آماده ویرایش شده',
      body: 'متن نمونه پاسخ',
    });
    await expect(o.getByText('پاسخ آماده ویرایش شده', { exact: true })).toBeVisible({
      timeout: 4000,
    });
    await deleteSavedReply(staff, reply.id, { version: 2 });
    await expect(o.getByText('پاسخ آماده ویرایش شده', { exact: true })).toHaveCount(0, {
      timeout: 4000,
    });
    const ticket = await createTicket(
      student,
      { departmentId: f.department.id, subject: 'صندوق بلادرنگ', body: 'پیام آغازین برای واحد' },
      randomUUID(),
    );
    await expect(s.locator(`a[href="/tickets/${ticket.id}"]`).first()).toBeVisible({
      timeout: 4000,
    });
    const message = await addMessage(staff, ticket.id, {
      version: 1,
      body: 'پاسخ جدید برای اعلان زنده',
    });
    const event = await db.outboxEvent.findFirstOrThrow({
      where: { type: 'TICKET_NOTIFICATION', payload: { path: ['messageId'], equals: message.id } },
    });
    await processNotification(event.id, event.payload);
    await expect(s.locator('.dock-unread-count')).toHaveText('۱', { timeout: 4000 });
    expect((await db.message.findUniqueOrThrow({ where: { id: message.id } })).readAt).toBeNull();
  } finally {
    await officer.close();
    await requester.close();
    await db.$disconnect();
  }
});

test('removes an open conversation immediately when its unit is transferred away', async ({
  browser,
}) => {
  const { fixtures } = await import('../helpers/fixtures');
  const { db } = await import('@niticket/database');
  const { createTicket, transferTicket } = await import('@niticket/core/application/tickets');
  const f = await fixtures();
  const ticket = await createTicket(
    await f.actor(f.student.id),
    {
      departmentId: f.department.id,
      subject: 'تغییر دسترسی زنده',
      body: 'درخواست انتقال برای بررسی',
    },
    randomUUID(),
  );
  const context = await browser.newContext();
  try {
    await context.request.post('/api/auth/sign-in/phone-number', {
      headers: { origin },
      data: { phoneNumber: f.agent.phoneNumber, password: f.password },
    });
    const page = await context.newPage();
    await observe(page);
    await page.goto(`/tickets/${ticket.id}`);
    await expect.poll(async () => (await streamState(page)).ready).toBe(1);
    await transferTicket(await f.actor(f.manager.id), ticket.id, {
      version: 1,
      departmentId: f.destination.id,
      reason: 'انتقال به واحد دیگر',
    });
    await expect(page).toHaveURL(origin + '/', { timeout: 5000 });
    expect((await context.request.get(`/api/v1/tickets/${ticket.id}`)).status()).toBe(404);
    expect((await streamState(page)).changes.join('')).not.toContain(f.destination.id);
  } finally {
    await context.close();
    await db.$disconnect();
  }
});
