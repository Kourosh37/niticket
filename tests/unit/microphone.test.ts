import { afterEach, expect, it, vi } from 'vitest';
import { waitForMicrophone } from '../../apps/web/src/lib/microphone';

class Track extends EventTarget {
  enabled = true;
  muted = true;
  readyState = 'live';
}

afterEach(() => vi.useRealTimers());

it('waits for the device to deliver input before allowing recording and removes initialization listeners', async () => {
  const track = new Track();
  const remove = vi.spyOn(track, 'removeEventListener');
  let ready = false;
  const waiting = waitForMicrophone(
    track as unknown as MediaStreamTrack,
    new AbortController().signal,
  ).then(() => {
    ready = true;
  });
  await Promise.resolve();
  expect(ready).toBe(false);
  track.muted = false;
  track.dispatchEvent(new Event('unmute'));
  await waiting;
  expect(remove).toHaveBeenCalledTimes(2);
});

it('does not initialize an ended or disabled input', async () => {
  const track = new Track();
  track.readyState = 'ended';
  await expect(
    waitForMicrophone(track as unknown as MediaStreamTrack, new AbortController().signal),
  ).rejects.toThrow('disconnected');
  track.readyState = 'live';
  track.enabled = false;
  await expect(
    waitForMicrophone(track as unknown as MediaStreamTrack, new AbortController().signal),
  ).rejects.toThrow('disconnected');
});

it('cancels an unavailable input on unmount instead of starting an invisible recording', async () => {
  const abort = new AbortController(),
    track = new Track();
  const rejected = expect(
    waitForMicrophone(track as unknown as MediaStreamTrack, abort.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
  abort.abort();
  await rejected;
});

it('bounds a device that remains muted without offering a silent recording', async () => {
  vi.useFakeTimers();
  const rejected = expect(
    waitForMicrophone(new Track() as unknown as MediaStreamTrack, new AbortController().signal),
  ).rejects.toThrow('unavailable');
  await vi.advanceTimersByTimeAsync(5000);
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
});
