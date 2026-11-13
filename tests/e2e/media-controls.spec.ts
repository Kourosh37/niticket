import { test, expect, type Locator } from '../helpers/e2e-test';
import { randomUUID } from 'node:crypto';
import { fixtures } from '../helpers/fixtures';
import { db } from '@niticket/database';
import { putObject } from '@niticket/core/infrastructure/storage';
import { pcmWaveform } from '@niticket/core/infrastructure/audio';

async function disabledControl(control: Locator) {
  await expect(control).toBeDisabled();
  await control.hover();
  await expect(control).toHaveCSS('cursor', 'not-allowed');
  expect(await control.evaluate((node) => Number(getComputedStyle(node).opacity))).toBeLessThan(
    0.7,
  );
}

test('dims unavailable wizard actions and uses a forbidden cursor without advancing or submitting', async ({
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
  const future = dialog.getByRole('tab', { name: 'پیام صوتی', exact: true });
  await disabledControl(future);
  await future.click({ force: true });
  await expect(dialog.getByRole('tab', { name: 'متن پیام', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await dialog.getByLabel('عنوان پیام آماده', { exact: true }).fill('Unavailable actions');
  await dialog.getByRole('button', { name: 'مرحله بعد', exact: true }).click();
  await dialog.getByRole('button', { name: 'مرحله بعد', exact: true }).click();
  const save = dialog.getByRole('button', { name: 'ذخیره پیام آماده', exact: true });
  await disabledControl(save);
  await save.click({ force: true });
  await expect(dialog).toBeVisible();
  expect(await db.savedReply.count({ where: { departmentId: f.department.id } })).toBe(0);
  await dialog.getByRole('tab', { name: 'متن پیام', exact: true }).click();
  await dialog.getByLabel('متن پیام آماده', { exact: true }).fill('Valid content');
  await dialog.getByRole('tab', { name: 'پیام صوتی', exact: true }).click();
  await expect(save).toBeEnabled();
  await expect(save).toHaveCSS('cursor', 'pointer');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`shows an unloaded waveform and synchronizes fractional playback, pause, seek and completion in ${scheme} mode`, async ({
    page,
    browserName,
  }) => {
    test.skip(
      process.platform === 'win32' && browserName === 'webkit',
      'Windows Playwright WebKit lacks a working native WAV playback backend; Linux WebKit covers real playback in CI.',
    );
    await page.emulateMedia({ colorScheme: scheme });
    await page.addInitScript(() => {
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        return play.call(this).catch((error: unknown) => {
          Object.assign(window, {
            mediaPlaybackFailure:
              error instanceof Error ? { name: error.name, message: error.message } : String(error),
          });
          throw error;
        });
      };
    });
    const f = await fixtures();
    const ticket = await db.ticket.create({
      data: { creatorId: f.student.id, departmentId: f.department.id, subject: 'Waveform' },
    });
    const message = await db.message.create({
      data: { ticketId: ticket.id, senderId: f.agent.id, body: 'Voice waveform' },
    });
    const rate = 8000,
      seconds = 4;
    const pcm = Buffer.alloc(rate * seconds * 2);
    for (let i = 0; i < rate * seconds; i++) {
      const envelope = 0.15 + 0.65 * Math.abs(Math.sin((i / rate) * 5));
      pcm.writeInt16LE(
        Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * envelope * 32767),
        i * 2,
      );
    }
    const header = Buffer.alloc(44);
    header.write('RIFF');
    header.writeUInt32LE(pcm.length + 36, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(rate, 24);
    header.writeUInt32LE(rate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    const bytes = Buffer.concat([header, pcm]),
      key = `clean/${randomUUID()}`;
    await putObject(key, bytes, 'audio/wav');
    const file = await db.attachment.create({
      data: {
        ticketId: ticket.id,
        messageId: message.id,
        uploaderId: f.agent.id,
        objectKey: key,
        filename: 'wave.wav',
        declaredMime: 'audio/wav',
        detectedMime: 'audio/wav',
        expectedSize: bytes.length,
        size: bytes.length,
        durationSeconds: seconds,
        waveform: pcmWaveform(pcm),
        scanStatus: 'CLEAN',
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    expect(
      (
        await page.request.post('/api/auth/sign-in/phone-number', {
          headers: { origin: 'http://localhost:3001' },
          data: { phoneNumber: f.student.phoneNumber, password: f.password },
        })
      ).ok(),
    ).toBe(true);
    let downloads = 0;
    page.on('request', (request) => {
      if (request.url().endsWith(`/attachments/${file.id}/access`)) downloads++;
    });
    await page.goto(`/tickets/${ticket.id}`);
    const player = page.locator('.audio-player'),
      bars = player.locator('.audio-wave > span'),
      seek = player.getByRole('slider');
    await expect(bars).toHaveCount(80);
    expect(
      new Set(
        await bars.evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).style.height)),
      ).size,
    ).toBeGreaterThan(10);
    await expect(player.locator('.played')).toHaveCount(0);
    expect(downloads).toBe(0);
    const colors = await bars.first().evaluate((node) => ({
      muted: getComputedStyle(node).backgroundColor,
      played: getComputedStyle(node, '::after').backgroundColor,
    }));
    expect(colors.muted).not.toBe(colors.played);
    await player.getByRole('button', { name: 'پخش پیام صوتی', exact: true }).click();
    try {
      await expect.poll(async () => Number(await seek.inputValue())).toBeGreaterThan(0.3);
    } catch (error) {
      const failure = await page.evaluate(
        () => (window as unknown as { mediaPlaybackFailure?: unknown }).mediaPlaybackFailure,
      );
      throw new Error(`Media playback failed: ${JSON.stringify(failure)}`, { cause: error });
    }
    await player.getByRole('button', { name: 'مکث پیام صوتی', exact: true }).click();
    const position = Number(await seek.inputValue());
    const fraction = () =>
      bars.evaluateAll(
        (nodes) =>
          nodes.reduce(
            (total, node) =>
              total + parseFloat((node as HTMLElement).style.getPropertyValue('--wave-fill')) / 100,
            0,
          ) / nodes.length,
      );
    expect(Math.abs((await fraction()) - position / seconds)).toBeLessThan(0.01);
    await page.waitForTimeout(120);
    expect(Number(await seek.inputValue())).toBe(position);
    const bounds = (await seek.boundingBox())!;
    await seek.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
    await expect.poll(async () => Number(await seek.inputValue())).toBeGreaterThan(1.5);
    expect(Number(await seek.inputValue())).toBeLessThan(2.5);
    expect(Math.abs((await fraction()) - Number(await seek.inputValue()) / seconds)).toBeLessThan(
      0.01,
    );
    await player.screenshot({ path: `.local/ui-preview/audio-wave-${scheme}.png` });
    await player.getByRole('button', { name: 'پخش پیام صوتی', exact: true }).click();
    await expect(seek).toHaveValue('0', { timeout: 10000 });
    await expect(player.locator('.played')).toHaveCount(0);
    await expect(player.getByRole('button', { name: 'پخش پیام صوتی', exact: true })).toBeVisible();
  });
}
