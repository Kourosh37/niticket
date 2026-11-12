import { afterEach, expect, it, vi } from 'vitest';
import { clientCache } from '../../apps/web/src/lib/client-cache';
import { previewBytes } from '../../apps/web/src/lib/preview-bytes';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../apps/web/src/lib/utils', () => ({ request, checkSession: vi.fn() }));
afterEach(() => {
  clientCache.clear();
  request.mockReset();
  vi.unstubAllGlobals();
});
const url = '/api/v1/attachments/00000000-0000-4000-8000-000000000000/access';

it('reauthorizes every preview while sharing immutable bytes and returning transferable copies', async () => {
  clientCache.activate('first');
  request.mockResolvedValue({ version: '"v1"', size: 5 });
  const fetch = vi.fn(
    async () => new Response('hello', { headers: { 'content-type': 'text/plain' } }),
  );
  vi.stubGlobal('fetch', fetch);
  const first = await previewBytes(url, new AbortController().signal);
  structuredClone(first, { transfer: [first] });
  expect(first.byteLength).toBe(0);
  expect(new TextDecoder().decode(await previewBytes(url, new AbortController().signal))).toBe(
    'hello',
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledTimes(2);
});

it('never serves cached bytes after a denied metadata check or an account switch', async () => {
  clientCache.activate('first');
  request.mockResolvedValue({ version: '"v1"', size: 5 });
  const fetch = vi.fn(async () => new Response('hello'));
  vi.stubGlobal('fetch', fetch);
  await previewBytes(url, new AbortController().signal);
  request.mockRejectedValueOnce(new Error('Denied'));
  await expect(previewBytes(url, new AbortController().signal)).rejects.toThrow('Denied');
  expect(fetch).toHaveBeenCalledTimes(1);
  clientCache.activate('second');
  await previewBytes(url, new AbortController().signal);
  expect(fetch).toHaveBeenCalledTimes(2);
});
