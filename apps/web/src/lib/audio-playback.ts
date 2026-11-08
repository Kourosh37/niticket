'use client';

type Playback = {
  src: string;
  label: string;
  playing: boolean;
  time: number;
  duration: number;
  speed: number;
  error: string;
};

export const idlePlayback: Playback = {
  src: '',
  label: '',
  playing: false,
  time: 0,
  duration: 0,
  speed: 1,
  error: '',
};

let state = idlePlayback;
let element: HTMLAudioElement | undefined;
const listeners = new Set<() => void>();

function publish(changes: Partial<Playback>) {
  state = { ...state, ...changes };
  listeners.forEach((listener) => listener());
}

function audio() {
  if (!element) {
    element = new Audio();
    element.preload = 'none';
    element.addEventListener('play', () => publish({ playing: true, error: '' }));
    element.addEventListener('pause', () => publish({ playing: false }));
    element.addEventListener('ended', () => publish({ playing: false }));
    element.addEventListener('timeupdate', () => publish({ time: element!.currentTime }));
    element.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(element!.duration)) publish({ duration: element!.duration });
    });
    element.addEventListener('error', () =>
      publish({ playing: false, error: 'دریافت صدا انجام نشد. دوباره تلاش کنید.' }),
    );
  }
  return element;
}

export const subscribePlayback = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getPlayback = () => state;

export const getIdlePlayback = () => idlePlayback;

export const playbackFor = (src: string) => (state.src === src ? state : idlePlayback);

export async function playAudio(
  src: string,
  label: string,
  duration: number,
  speed: number,
  startAt = 0,
) {
  const player = audio();
  if (state.src !== src) {
    player.pause();
    publish({ src, label, time: startAt, duration, playing: false, error: '' });
    player.src = src;
    player.currentTime = startAt;
  }
  player.playbackRate = speed;
  publish({ speed });
  try {
    await player.play();
  } catch {
    publish({ error: 'پخش صدا انجام نشد. دوباره تلاش کنید.', playing: false });
  }
}

export function pauseAudio() {
  element?.pause();
}

export function seekAudio(time: number) {
  if (element) {
    element.currentTime = time;
    publish({ time });
  }
}

export function setAudioSpeed(speed: number) {
  if (element) element.playbackRate = speed;
  publish({ speed });
}

export function stopAudio(src?: string) {
  if (src && state.src !== src) return;
  element?.pause();
  element?.removeAttribute('src');
  element?.load();
  state = idlePlayback;
  listeners.forEach((listener) => listener());
}
