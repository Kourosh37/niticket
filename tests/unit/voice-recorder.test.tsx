// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { VoiceRecorder } from '../../apps/web/src/components/voice-recorder';

class Recorder {
  static instances: Recorder[] = [];
  static deferStart = false;
  static isTypeSupported = () => true;
  state = 'inactive';
  mimeType = 'audio/webm;codecs=opus';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onstart: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    Recorder.instances.push(this);
  }
  start() {
    this.state = 'recording';
    if (!Recorder.deferStart) this.onstart?.();
  }
  pause() {
    this.state = 'paused';
  }
  resume() {
    this.state = 'recording';
  }
  stop = vi.fn(() => {
    this.state = 'inactive';
  });
  data(value: string) {
    this.ondataavailable?.({ data: new Blob([value]) });
  }
  finish() {
    this.onstop?.();
  }
}

let clock = 0;
const track = {
  stop: vi.fn(),
  getSettings: () => ({ sampleRate: 48000 }),
  onended: null as (() => void) | null,
};
const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
const getUserMedia = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  Recorder.instances = [];
  Recorder.deferStart = false;
  track.stop.mockClear();
  track.onended = null;
  getUserMedia.mockReset().mockResolvedValue(stream);
  vi.stubGlobal('MediaRecorder', Recorder);
  vi.stubGlobal('AudioContext', undefined);
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:voice');
      static revokeObjectURL = vi.fn();
    },
  );
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function begin(maxSeconds = 60, maxBytes = 1024) {
  const onFile = vi.fn(),
    onRecordingChange = vi.fn();
  const view = render(
    <VoiceRecorder
      compact
      onFile={onFile}
      onRecordingChange={onRecordingChange}
      maxSeconds={maxSeconds}
      maxBytes={maxBytes}
    />,
  );
  const button = screen.getByRole('button', { name: 'ضبط پیام صوتی' });
  await act(async () => fireEvent.click(button));
  return { ...view, onFile, onRecordingChange, button, media: Recorder.instances[0] };
}

it('keeps the same stop button, measures actual elapsed time and waits for the final chunk before releasing tracks', async () => {
  const { button, media, onFile, onRecordingChange } = await begin();
  expect(screen.getByRole('button', { name: 'پایان ضبط' })).toBe(button);
  clock = 12750;
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(screen.getByLabelText('مدت ضبط').textContent).toBe('۰۰:۱۲');
  act(() => media.data('beginning-middle'));
  fireEvent.click(button);
  expect(media.stop).toHaveBeenCalledTimes(1);
  expect(track.stop).not.toHaveBeenCalled();
  expect(onRecordingChange.mock.lastCall).toEqual([true]);
  expect(onFile.mock.calls.every(([file]) => file === null)).toBe(true);
  act(() => {
    media.data('-ending');
    media.finish();
  });
  const file = onFile.mock.lastCall![0] as File;
  expect(file.size).toBe(new Blob(['beginning-middle-ending']).size);
  expect(file.type).toBe('audio/webm');
  expect(track.stop).toHaveBeenCalledTimes(1);
  expect(onRecordingChange.mock.lastCall).toEqual([false]);
  expect(screen.getByLabelText('پیش‌شنوی پیام صوتی')).toBeTruthy();
});

it('excludes paused time and automatically finalizes once at the duration limit', async () => {
  const { media } = await begin(5);
  clock = 2000;
  fireEvent.click(screen.getByRole('button', { name: 'مکث ضبط' }));
  clock = 20000;
  await act(() => vi.advanceTimersByTimeAsync(20000));
  expect(media.stop).not.toHaveBeenCalled();
  expect(screen.getByLabelText('مدت ضبط').textContent).toBe('۰۰:۰۲');
  fireEvent.click(screen.getByRole('button', { name: 'ادامه ضبط' }));
  clock = 23000;
  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(media.stop).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('مدت ضبط').textContent).toBe('۰۰:۰۵');
});

it.each(['empty', 'oversized', 'interrupted', 'error'])(
  'does not offer a %s recording for sending and allows a clean retry',
  async (failure) => {
    const { media, onFile, button } = await begin(60, 12);
    act(() => {
      if (failure === 'oversized') media.data('too many recorded bytes');
      if (failure === 'interrupted') {
        media.data('partial');
        track.onended?.();
      }
      if (failure === 'error') {
        media.data('partial');
        media.onerror?.();
      }
    });
    if (failure === 'empty') fireEvent.click(button);
    act(() => media.finish());
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByLabelText('پیش‌شنوی پیام صوتی')).toBeNull();
    expect(onFile.mock.calls.every(([file]) => file === null)).toBe(true);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'ضبط پیام صوتی' })));
    expect(Recorder.instances).toHaveLength(2);
    act(() => Recorder.instances[1].data('retry'));
    fireEvent.click(screen.getByRole('button', { name: 'پایان ضبط' }));
    act(() => Recorder.instances[1].finish());
    expect(onFile.mock.lastCall![0]).toBeInstanceOf(File);
  },
);

it('records even when waveform initialization fails', async () => {
  vi.stubGlobal(
    'AudioContext',
    class {
      constructor() {
        throw new Error('unavailable');
      }
    },
  );
  const { media, button, onFile } = await begin();
  act(() => media.data('complete'));
  fireEvent.click(button);
  act(() => media.finish());
  expect(onFile.mock.lastCall![0].size).toBe(8);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('settles the matching-rate audio graph before creating a recorder and does not gate speech with call processing', async () => {
  let resume!: () => void;
  let running = false;
  const constructor = vi.fn();
  const close = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal(
    'AudioContext',
    class {
      state = 'suspended';
      constructor(options: AudioContextOptions) {
        constructor(options);
      }
      createAnalyser() {
        return { fftSize: 0 };
      }
      createMediaStreamSource() {
        return { connect: vi.fn() };
      }
      resume() {
        return new Promise<void>((resolve) => {
          resume = () => {
            this.state = 'running';
            running = true;
            resolve();
          };
        });
      }
      close = close;
    },
  );
  const { unmount } = await begin();
  expect(Recorder.instances).toHaveLength(0);
  expect(screen.getByRole('button', { name: 'اتصال به میکروفون' }).hasAttribute('disabled')).toBe(
    true,
  );
  expect(constructor).toHaveBeenCalledWith({ sampleRate: 48000, latencyHint: 'interactive' });
  expect(getUserMedia).toHaveBeenCalledWith({
    audio: {
      channelCount: { ideal: 1 },
      echoCancellation: { ideal: false },
      noiseSuppression: { ideal: false },
      autoGainControl: { ideal: false },
    },
  });
  await act(async () => resume());
  expect(running).toBe(true);
  expect(Recorder.instances).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'پایان ضبط' })).toBeTruthy();
  unmount();
  expect(close).toHaveBeenCalledOnce();
});

it('closes a suspended meter before starting capture and ignores a late resume', async () => {
  let resume!: () => void;
  const context = {
    state: 'suspended',
    createAnalyser: () => ({ fftSize: 0 }),
    createMediaStreamSource: () => ({ connect: vi.fn() }),
    resume: () =>
      new Promise<void>((resolve) => {
        resume = resolve;
      }),
    close: vi.fn(async () => {
      context.state = 'closed';
    }),
  };
  vi.stubGlobal(
    'AudioContext',
    class {
      constructor() {
        return context;
      }
    },
  );
  await begin();
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(context.close).toHaveBeenCalledOnce();
  expect(Recorder.instances).toHaveLength(1);
  expect(context.state).toBe('closed');
  await act(async () => resume());
  expect(Recorder.instances).toHaveLength(1);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('does not start recording when unmounted during audio graph initialization', async () => {
  let resume!: () => void;
  const context = {
    state: 'suspended',
    createAnalyser: () => ({ fftSize: 0 }),
    createMediaStreamSource: () => ({ connect: vi.fn() }),
    resume: () =>
      new Promise<void>((resolve) => {
        resume = resolve;
      }),
    close: vi.fn(async () => {
      context.state = 'closed';
    }),
  };
  vi.stubGlobal(
    'AudioContext',
    class {
      constructor() {
        return context;
      }
    },
  );
  const { unmount, onFile } = await begin();
  unmount();
  await act(async () => resume());
  expect(Recorder.instances).toHaveLength(0);
  expect(context.close).toHaveBeenCalledOnce();
  expect(track.stop).toHaveBeenCalledOnce();
  expect(onFile.mock.calls.every(([file]) => file === null)).toBe(true);
});

it('waits for the real recorder start event before showing a recording timer', async () => {
  Recorder.deferStart = true;
  const { media } = await begin();
  expect(screen.getByRole('button', { name: 'اتصال به میکروفون' }).hasAttribute('disabled')).toBe(
    true,
  );
  clock = 3000;
  act(() => media.onstart?.());
  clock = 4100;
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(screen.getByLabelText('مدت ضبط').textContent).toBe('۰۰:۰۱');
});

it('uses the actual negotiated recording format for the file extension and upload MIME', async () => {
  const { media, button, onFile } = await begin();
  media.mimeType = 'audio/mp4';
  act(() => media.data('mp4-audio'));
  fireEvent.click(button);
  act(() => media.finish());
  const file = onFile.mock.lastCall![0] as File;
  expect(file.name).toMatch(/\.m4a$/);
  expect(file.type).toBe('audio/mp4');
});

it('releases a late microphone permission result after unmount without creating a recorder', async () => {
  let resolve!: (value: typeof stream) => void;
  getUserMedia.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { unmount, onFile } = await begin();
  unmount();
  await act(async () => resolve(stream));
  expect(track.stop).toHaveBeenCalledTimes(1);
  expect(Recorder.instances).toHaveLength(0);
  expect(onFile.mock.calls.every(([file]) => file === null)).toBe(true);
});

it('detaches recorder events and stops tracks on unmount', async () => {
  const { unmount, media, onFile } = await begin();
  unmount();
  act(() => {
    media.data('late');
    media.finish();
    media.onerror?.();
  });
  expect(track.stop).toHaveBeenCalledTimes(1);
  expect(onFile.mock.calls.every(([file]) => file === null)).toBe(true);
});

it('handles denied microphone permission and can retry', async () => {
  getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
  await begin();
  expect(screen.getByRole('alert').textContent).toContain('دسترسی به میکروفون');
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'ضبط پیام صوتی' })));
  expect(screen.getByRole('button', { name: 'پایان ضبط' })).toBeTruthy();
});
