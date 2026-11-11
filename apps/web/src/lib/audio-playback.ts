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
let playRequest = 0;
let pendingSeek: number | null = null;
const listeners = new Set<() => void>();

function publish(changes: Partial<Playback>) {
  state = { ...state, ...changes };
  listeners.forEach((listener) => listener());
}

function audio() {
  if (!element) {
    const player = new Audio();
    element = player;
    player.preload = 'none';

    function listen(event: string, handler: () => void) {
      player.addEventListener(event, () => {
        if (element === player) handler();
      });
    }

    listen('play', () => publish({ playing: true, error: '' }));
    listen('pause', () => publish({ playing: false }));
    listen('ended', () => publish({ playing: false, time: state.duration || player.currentTime }));
    listen('timeupdate', () => {
      if (pendingSeek === null) publish({ time: player.currentTime });
    });
    listen('loadedmetadata', () => {
      if (Number.isFinite(player.duration) && player.duration > 0)
        publish({ duration: player.duration });
      if (pendingSeek !== null) {
        player.currentTime = pendingSeek;
        pendingSeek = null;
      }
    });
    listen('error', () =>
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
  const request = ++playRequest;
  if (state.src !== src) {
    // A separate element per source isolates queued media events from previous voices.
    const previous = element;
    element = undefined;
    pendingSeek = null;
    previous?.pause();
    previous?.removeAttribute('src');
    previous?.load();
    publish({ src, label, time: startAt, duration, playing: false, error: '' });
    const player = audio();
    player.src = src;
    if (startAt > 0) pendingSeek = startAt;
  }
  const player = audio();
  if (player.error) {
    pendingSeek = state.time;
    player.load();
  }
  if (player.ended) {
    player.currentTime = 0;
    publish({ time: 0 });
  }
  player.playbackRate = speed;
  publish({ speed });
  try {
    await player.play();
  } catch (error) {
    if (element !== player || request !== playRequest) return;
    publish({
      error:
        error instanceof DOMException && error.name === 'AbortError'
          ? ''
          : 'پخش صدا انجام نشد. دوباره تلاش کنید.',
      playing: false,
    });
  }
}

export function pauseAudio() {
  playRequest++;
  element?.pause();
  publish({ playing: false });
}

export function seekAudio(time: number) {
  if (element) {
    const safe = Number.isFinite(time) ? Math.max(0, Math.min(time, state.duration || time)) : 0;
    if (element.readyState < 1) pendingSeek = safe;
    else element.currentTime = safe;
    publish({ time: safe });
  }
}

export function setAudioSpeed(speed: number) {
  if (element) element.playbackRate = speed;
  publish({ speed });
}

export function stopAudio(src?: string) {
  if (src && state.src !== src) return;
  playRequest++;
  const previous = element;
  element = undefined;
  pendingSeek = null;
  previous?.pause();
  previous?.removeAttribute('src');
  previous?.load();
  state = idlePlayback;
  listeners.forEach((listener) => listener());
}
