import { afterEach, expect, it, vi } from 'vitest';
import { MAX_PREVIEW_BYTES, previewBytes } from '../../apps/web/src/lib/preview-bytes';

afterEach(() => vi.unstubAllGlobals());

it('reads all streamed bytes without truncating a chunk boundary and releases the reader', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.enqueue(new Uint8Array([3, 4, 5]));
      controller.close();
    },
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream)));
  const signal = new AbortController().signal;
  expect(new Uint8Array(await previewBytes('/file', signal))).toEqual(
    new Uint8Array([1, 2, 3, 4, 5]),
  );
  expect(fetch).toHaveBeenCalledWith('/file', { signal });
  expect(stream.locked).toBe(false);
});

it('rejects oversized declared bodies before reading and cancels the response', async () => {
  const cancel = vi.fn();
  const stream = new ReadableStream({ cancel });
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(stream, { headers: { 'content-length': String(MAX_PREVIEW_BYTES + 1) } }),
      ),
  );
  await expect(previewBytes('/file', new AbortController().signal)).rejects.toThrow('بزرگ');
  expect(cancel).toHaveBeenCalledOnce();
});

it('enforces the actual byte limit when content-length is absent or dishonest', async () => {
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_PREVIEW_BYTES + 1));
    },
    cancel,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(stream, { headers: { 'content-length': '1' } })),
  );
  await expect(previewBytes('/file', new AbortController().signal)).rejects.toThrow('بزرگ');
  expect(cancel).toHaveBeenCalledOnce();
  expect(stream.locked).toBe(false);
});

it('propagates interrupted reads without returning a truncated document or retaining the reader', async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.error(new DOMException('Cancelled', 'AbortError'));
    },
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream)));
  await expect(previewBytes('/file', new AbortController().signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(stream.locked).toBe(false);
});

it('does not parse an error response as document bytes', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Forbidden', { status: 403 })));
  await expect(previewBytes('/file', new AbortController().signal)).rejects.toThrow('اجازه');
});
