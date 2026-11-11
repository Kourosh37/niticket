// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  getPlayback,
  pauseAudio,
  playAudio,
  seekAudio,
  stopAudio,
} from '../../apps/web/src/lib/audio-playback';

class AudioStub extends EventTarget {
  static instances: AudioStub[] = [];
  preload = '';
  src = '';
  currentTime = 0;
  duration = Infinity;
  readyState = 0;
  playbackRate = 1;
  ended = false;
  error: object | null = null;
  reject?: (error: Error) => void;
  constructor() {
    super();
    AudioStub.instances.push(this);
  }
  play() {
    this.dispatchEvent(new Event('play'));
    return new Promise<void>((_resolve, reject) => {
      this.reject = reject;
    });
  }
  pause() {
    this.dispatchEvent(new Event('pause'));
  }
  load = vi.fn();
  removeAttribute() {
    this.src = '';
  }
}

beforeEach(() => {
  AudioStub.instances = [];
  vi.stubGlobal('Audio', AudioStub);
});
afterEach(() => {
  stopAudio();
  vi.unstubAllGlobals();
});

it('ignores queued events and rejected play promises belonging to the previous voice', async () => {
  const old = playAudio('/old', 'old', 20, 1);
  const first = AudioStub.instances[0];
  void playAudio('/new', 'new', 12, 1.5);
  const second = AudioStub.instances[1];
  first.currentTime = 18;
  for (const event of ['pause', 'ended', 'error', 'timeupdate'])
    first.dispatchEvent(new Event(event));
  first.reject!(new DOMException('interrupted', 'AbortError'));
  await old;
  expect(getPlayback()).toMatchObject({
    src: '/new',
    playing: true,
    time: 0,
    duration: 12,
    speed: 1.5,
    error: '',
  });
  expect(first.load).toHaveBeenCalledOnce();
  expect(second.preload).toBe('none');
});

it('defers seeking until metadata exists and preserves a known duration for streaming WebM', () => {
  void playAudio('/voice', 'voice', 16, 1, 5);
  const player = AudioStub.instances[0];
  expect(player.currentTime).toBe(0);
  seekAudio(8);
  player.dispatchEvent(new Event('timeupdate'));
  expect(getPlayback().time).toBe(8);
  player.readyState = 1;
  player.dispatchEvent(new Event('loadedmetadata'));
  expect(player.currentTime).toBe(8);
  expect(getPlayback().duration).toBe(16);
  seekAudio(100);
  expect(player.currentTime).toBe(16);
  seekAudio(NaN);
  expect(player.currentTime).toBe(0);
});

it('does not turn an intentional pause into a playback error when a pending play rejects', async () => {
  const playing = playAudio('/voice', 'voice', 10, 1);
  pauseAudio();
  AudioStub.instances[0].reject!(new DOMException('paused', 'AbortError'));
  await playing;
  expect(getPlayback()).toMatchObject({ playing: false, error: '' });
});

it('replays an ended recording from zero and retries a failed download at its previous position', () => {
  void playAudio('/voice', 'voice', 10, 1);
  const player = AudioStub.instances[0];
  player.readyState = 1;
  player.currentTime = 10;
  player.ended = true;
  player.dispatchEvent(new Event('ended'));
  void playAudio('/voice', 'voice', 10, 1, 10);
  expect(player.currentTime).toBe(0);
  expect(getPlayback().time).toBe(0);
  player.ended = false;
  player.currentTime = 4;
  player.dispatchEvent(new Event('timeupdate'));
  player.error = {};
  player.dispatchEvent(new Event('error'));
  void playAudio('/voice', 'voice', 10, 1, 4);
  expect(player.load).toHaveBeenCalledOnce();
  player.dispatchEvent(new Event('loadedmetadata'));
  expect(player.currentTime).toBe(4);
});

it('ignores stale cleanup and late events after stopping the selected voice', async () => {
  const playing = playAudio('/voice', 'voice', 10, 1);
  const player = AudioStub.instances[0];
  stopAudio('/other');
  expect(getPlayback().src).toBe('/voice');
  stopAudio('/voice');
  player.dispatchEvent(new Event('error'));
  player.reject!(new Error('late failure'));
  await playing;
  expect(getPlayback()).toMatchObject({ src: '', playing: false, error: '' });
});
