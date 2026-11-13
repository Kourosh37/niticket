// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AudioPlayer } from '../../apps/web/src/components/audio-player';
import { stopAudio } from '../../apps/web/src/lib/audio-playback';

class AudioStub extends EventTarget {
  static instances: AudioStub[] = [];
  preload = '';
  src = '';
  currentTime = 0;
  duration = 4;
  readyState = 1;
  playbackRate = 1;
  paused = true;
  ended = false;
  error = null;
  constructor() {
    super();
    AudioStub.instances.push(this);
  }
  async play() {
    this.paused = false;
    this.ended = false;
    this.dispatchEvent(new Event('play'));
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  }
  load() {}
  removeAttribute() {
    this.src = '';
  }
}

beforeEach(() => {
  AudioStub.instances = [];
  vi.stubGlobal('Audio', AudioStub);
});
afterEach(() => {
  cleanup();
  stopAudio();
  vi.unstubAllGlobals();
});

it('renders the stored waveform before playback without creating an audio element or highlighting the first bar', () => {
  const view = render(<AudioPlayer src="/voice" durationSeconds={4} waveform={[-1, 0.5, 2]} />);
  const bars = [...view.container.querySelectorAll<HTMLElement>('.audio-wave > span')];
  expect(bars.map((bar) => bar.style.height)).toEqual(['4px', '17.5px', '31px']);
  expect(bars.every((bar) => bar.style.getPropertyValue('--wave-fill') === '0%')).toBe(true);
  expect(view.container.querySelectorAll('.played')).toHaveLength(0);
  expect(AudioStub.instances).toHaveLength(0);
  view.rerender(<AudioPlayer src="/voice" waveform={[null, NaN, Infinity, 'invalid']} />);
  expect(view.container.querySelectorAll('.audio-wave > span')).toHaveLength(64);
});

it('fills bars fractionally from the media time, preserves pause and seek positions, and clears the full wave on completion', async () => {
  const view = render(
    <AudioPlayer src="/voice" durationSeconds={4} waveform={[0.2, 0.8, 0.4, 1]} />,
  );
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'پخش پیام صوتی' })));
  const player = AudioStub.instances[0];
  act(() => {
    player.currentTime = 1.5;
    player.dispatchEvent(new Event('timeupdate'));
  });
  const fills = () =>
    [...view.container.querySelectorAll<HTMLElement>('.audio-wave > span')].map((bar) =>
      bar.style.getPropertyValue('--wave-fill'),
    );
  expect(fills()).toEqual(['100%', '50%', '0%', '0%']);
  fireEvent.click(screen.getByRole('button', { name: 'مکث پیام صوتی' }));
  expect(fills()).toEqual(['100%', '50%', '0%', '0%']);
  fireEvent.change(screen.getByRole('slider'), { target: { value: '2.75' } });
  expect(player.currentTime).toBe(2.75);
  expect(fills()).toEqual(['100%', '100%', '75%', '0%']);
  act(() => {
    player.currentTime = 4;
    player.ended = true;
    player.dispatchEvent(new Event('ended'));
  });
  expect(fills()).toEqual(['0%', '0%', '0%', '0%']);
  expect(player.currentTime).toBe(0);
  expect(screen.getByRole('button', { name: 'پخش پیام صوتی' })).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'پخش پیام صوتی' })));
  expect(player.currentTime).toBe(0);
  expect(fills()).toEqual(['0%', '0%', '0%', '0%']);
  expect(screen.getByRole('button', { name: 'مکث پیام صوتی' })).toBeTruthy();
});

it('freezes the waveform at the actual pause position even when the native pause event is deferred', async () => {
  const view = render(<AudioPlayer src="/voice" durationSeconds={4} waveform={[1, 1, 1, 1]} />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'پخش پیام صوتی' })));
  const player = AudioStub.instances[0];
  player.pause = () => {
    player.paused = true;
  };
  player.currentTime = 1.5;
  fireEvent.click(screen.getByRole('button', { name: 'مکث پیام صوتی' }));
  const fills = () =>
    [...view.container.querySelectorAll<HTMLElement>('.audio-wave > span')].map((bar) =>
      bar.style.getPropertyValue('--wave-fill'),
    );
  expect(fills()).toEqual(['100%', '50%', '0%', '0%']);
  act(() => {
    player.dispatchEvent(new Event('pause'));
    player.dispatchEvent(new Event('timeupdate'));
  });
  expect(fills()).toEqual(['100%', '50%', '0%', '0%']);
});
