import { expect, test, type Page, type Locator } from '@playwright/test';
import { fixtures } from '../helpers/fixtures';
import { db } from '@niticket/database';
import { createSavedReply } from '@niticket/core/application/saved-replies';

const origin = 'http://localhost:3001';

async function hydrate(page: Page, path: string, controls: Locator[]) {
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  await page.route('**/_next/static/**/*.js', async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await page.goto(path, { waitUntil: 'commit' });
    for (const control of controls) await expect(control).toBeDisabled();
    release();
    for (const control of controls) await expect(control).toBeEnabled();
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
}

test('retains the first input and edit action when application JavaScript loads slowly', async ({
  browser,
}) => {
  const f = await fixtures();
  const ticket = await db.ticket.create({
    data: { creatorId: f.student.id, departmentId: f.department.id, subject: 'Hydration' },
  });
  const reply = await createSavedReply(await f.actor(f.agent.id), {
    departmentId: f.department.id,
    clientId: crypto.randomUUID(),
    title: 'Hydration reply',
    body: 'Initial body',
  });
  const student = await browser.newContext(),
    officer = await browser.newContext();
  try {
    for (const [context, user] of [
      [student, f.student],
      [officer, f.agent],
    ] as const)
      expect(
        (
          await context.request.post('/api/auth/sign-in/phone-number', {
            headers: { origin },
            data: { phoneNumber: user.phoneNumber, password: f.password },
          })
        ).ok(),
      ).toBe(true);
    const page = await student.newPage();
    const search = page.getByRole('searchbox', { name: 'جستجوی واحد', exact: true });
    await hydrate(page, '/tickets/new', [search]);
    await search.fill(f.department.name);
    await expect(
      page.getByRole('button', { name: `انتخاب ${f.department.name}`, exact: true }),
    ).toBeVisible();
    const draft = page.getByLabel('پاسخ شما', { exact: true });
    await hydrate(page, `/tickets/${ticket.id}`, [draft]);
    await draft.fill('First input survives');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            Object.keys(sessionStorage).filter((key) => key.startsWith('niticket:draft:')).length,
        ),
      )
      .toBe(1);
    await page.reload();
    await expect(draft).toHaveValue('First input survives');
    const editor = await officer.newPage();
    const edit = editor.getByRole('button', { name: `ویرایش ${reply.title}`, exact: true });
    await hydrate(editor, '/saved-replies', [edit]);
    await edit.click();
    await expect(editor.getByLabel('متن پیام آماده', { exact: true })).toHaveValue(reply.body);
  } finally {
    await student.close();
    await officer.close();
    await db.$disconnect();
  }
});
