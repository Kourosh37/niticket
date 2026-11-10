// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { uploadFile } from '../../apps/web/src/lib/upload';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../apps/web/src/lib/utils', async (original) => ({
  ...(await original<typeof import('../../apps/web/src/lib/utils')>()),
  request,
}));
afterEach(() => {
  vi.unstubAllGlobals();
  request.mockReset();
});

it('keeps the same upload key after a lost completion response and skips a second PUT', async () => {
  const send = vi.fn();
  vi.stubGlobal(
    'XMLHttpRequest',
    class {
      status = 200;
      upload = {};
      open = vi.fn();
      setRequestHeader = vi.fn();
      onload?: () => void;
      send() {
        send();
        this.onload?.();
      }
    },
  );
  let complete = false;
  request.mockImplementation(async (url: string) => {
    if (url.endsWith('/complete')) {
      complete = true;
      throw new Error('Lost response');
    }
    return {
      id: 'same-upload',
      url: complete ? null : 'http://storage/upload',
      scanStatus: complete ? 'QUARANTINED' : 'PENDING',
    };
  });
  const file = new File(['safe'], 'test.txt', { type: 'text/plain' });
  await expect(uploadFile(file, 'ticket', 'message', vi.fn())).rejects.toThrow('Lost response');
  expect(await uploadFile(file, 'ticket', 'message', vi.fn())).toBe('same-upload');
  const intents = request.mock.calls.filter(([url]) => url.endsWith('/intents'));
  expect(JSON.parse(intents[0][1].body).clientId).toBe(JSON.parse(intents[1][1].body).clientId);
  expect(send).toHaveBeenCalledTimes(1);
});
