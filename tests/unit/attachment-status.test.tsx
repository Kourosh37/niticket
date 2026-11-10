// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useAttachmentStatus } from '../../apps/web/src/lib/attachment-status';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../apps/web/src/lib/utils', () => ({ request }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  request.mockReset();
});

function Preview({ id }: { id: string }) {
  const file = useAttachmentStatus({
    id,
    filename: id,
    scanStatus: 'QUARANTINED',
    detectedMime: null,
  });
  return (
    <output>
      {file.id}:{file.scanStatus}:{file.detectedMime}
    </output>
  );
}

it('batches mounted pending previews and promotes old files without a conversation refresh', async () => {
  vi.useFakeTimers();
  request.mockImplementation(async (url: string) =>
    new URL(url, 'http://localhost').searchParams
      .get('ids')!
      .split(',')
      .map((id) => ({
        id,
        filename: id,
        scanStatus: 'CLEAN',
        detectedMime: 'text/plain',
      })),
  );
  render(
    <>
      {Array.from({ length: 51 }, (_, i) => (
        <Preview key={i} id={String(i)} />
      ))}
    </>,
  );
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(request).toHaveBeenCalledTimes(1);
  expect(screen.getByText('0:CLEAN:text/plain')).toBeTruthy();
  await act(() => vi.advanceTimersByTimeAsync(5000));
  expect(request).toHaveBeenCalledTimes(2);
  expect(screen.getByText('50:CLEAN:text/plain')).toBeTruthy();
  await act(() => vi.advanceTimersByTimeAsync(10000));
  expect(request).toHaveBeenCalledTimes(2);
});

it('cancels pending work when previews unmount', async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  request.mockImplementation((_url: string, options: { signal: AbortSignal }) => {
    signal = options.signal;
    return new Promise(() => {});
  });
  const view = render(<Preview id="old-message-file" />);
  await act(() => vi.advanceTimersByTimeAsync(100));
  view.unmount();
  expect(signal?.aborted).toBe(true);
});
