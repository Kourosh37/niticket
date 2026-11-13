import { test, expect } from '../helpers/e2e-test';
import { fixtures } from '../helpers/fixtures';
import { db } from '@niticket/database';

test('retains the first keystrokes after returning to a wizard step even when animation frames are delayed', async ({
  page,
}) => {
  const f = await fixtures();
  expect(
    (
      await page.request.post('/api/auth/sign-in/phone-number', {
        headers: { origin: 'http://localhost:3001' },
        data: { phoneNumber: f.agent.phoneNumber, password: f.password },
      })
    ).ok(),
  ).toBe(true);
  await page.goto('/saved-replies');
  await page.getByRole('button', { name: 'پیام جدید', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'پیام آماده جدید', exact: true });
  const title = 'Focus-safe prepared reply';
  const body = 'اولین متن پس از بازگشت به مرحله قبل';
  await dialog.getByLabel('عنوان پیام آماده', { exact: true }).fill(title);
  await dialog.getByRole('button', { name: 'مرحله بعد', exact: true }).click();
  await dialog.getByRole('button', { name: 'مرحله بعد', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: 'ذخیره پیام آماده', exact: true }),
  ).toBeDisabled();

  // Reproduce a busy browser between step navigation and the reader's first
  // keystrokes. A queued step-focus callback must never override a newer focus.
  await page.evaluate(() => {
    const request = window.requestAnimationFrame;
    const cancel = window.cancelAnimationFrame;
    const frames = new Map<number, FrameRequestCallback>();
    let id = 0;
    window.requestAnimationFrame = (callback) => {
      frames.set(--id, callback);
      return id;
    };
    window.cancelAnimationFrame = (key) => {
      if (key < 0) frames.delete(key);
      else cancel.call(window, key);
    };
    Object.assign(window, {
      releaseWizardFrames() {
        window.requestAnimationFrame = request;
        window.cancelAnimationFrame = cancel;
        for (const callback of frames.values()) callback(performance.now());
        frames.clear();
      },
    });
  });
  await dialog.getByRole('tab', { name: 'متن پیام', exact: true }).click();
  const input = dialog.getByLabel('متن پیام آماده', { exact: true });
  await input.focus();
  await page.evaluate(() =>
    (window as unknown as { releaseWizardFrames: () => void }).releaseWizardFrames(),
  );
  await expect(input).toBeFocused();
  await page.keyboard.insertText(body);
  await expect(input).toHaveValue(body);
  await dialog.getByRole('tab', { name: 'پیام صوتی', exact: true }).click();
  const save = dialog.getByRole('button', { name: 'ذخیره پیام آماده', exact: true });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(dialog).toBeHidden();
  expect(
    await db.savedReply.findFirstOrThrow({
      where: { departmentId: f.department.id, title },
      select: { body: true },
    }),
  ).toEqual({ body });
});
