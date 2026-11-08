'use client';

import { useMemo, useState, useSyncExternalStore, useEffect } from 'react';
import { Play, Pause, Volume2, X } from 'lucide-react';
import {
  getPlayback,
  getIdlePlayback,
  playbackFor,
  subscribePlayback,
  playAudio,
  pauseAudio,
  seekAudio,
  setAudioSpeed,
  stopAudio,
} from '@/lib/audio-playback';

export const audioTime = (seconds: number) => {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return `${Math.floor(safe / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(safe % 60)
    .toString()
    .padStart(2, '0')}`;
};

export function AudioPlayer({
  src,
  durationSeconds,
  waveform,
  label = 'پیام صوتی',
}: {
  src: string;
  durationSeconds?: number | null;
  waveform?: unknown;
  label?: string;
}) {
  const playback = useSyncExternalStore(subscribePlayback, () => playbackFor(src), getIdlePlayback);
  const [position, setPosition] = useState(0),
    [preferredSpeed, setSpeed] = useState(1);
  const selected = playback.src === src;
  const { playing, error } = playback;
  const speed = selected ? playback.speed : preferredSpeed;
  const time = selected ? playback.time : position;
  const duration = selected ? playback.duration || durationSeconds || 0 : durationSeconds || 0;
  useEffect(
    () => () => {
      if (src.startsWith('blob:')) stopAudio(src);
    },
    [src],
  );
  const bars = useMemo(
    () =>
      Array.isArray(waveform) && waveform.length
        ? waveform
            .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
            .slice(0, 100)
        : Array.from({ length: 64 }, () => 0),
    [waveform],
  );

  function seek(value: number) {
    setPosition(value);
    if (selected) seekAudio(value);
  }

  return (
    <div className="audio-player" aria-label={label}>
      <button
        className="audio-play"
        type="button"
        aria-label={playing ? `مکث ${label}` : `پخش ${label}`}
        onClick={() => {
          if (playing) pauseAudio();
          else void playAudio(src, label, duration, speed, time);
        }}
      >
        {playing ? <Pause size={20} /> : <Play size={20} />}
      </button>
      <div className="audio-main">
        <div className="audio-wave" aria-hidden="true">
          {bars.map((v, i) => (
            <span
              key={i}
              className={duration > 0 && i / bars.length <= time / duration ? 'played' : ''}
              style={{ height: `${4 + Math.max(0, Math.min(1, v)) * 27}px` }}
            />
          ))}
        </div>
        <input
          className="audio-seek"
          type="range"
          min={0}
          max={duration || 1}
          step={0.05}
          value={Math.min(time, duration || 1)}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label={`موقعیت پخش ${label}`}
          aria-valuetext={`${audioTime(time)} از ${audioTime(duration)}`}
          dir="ltr"
        />
        <div className="audio-caption">
          <span dir="ltr">
            {audioTime(time)} / {audioTime(duration)}
          </span>
          <button
            type="button"
            aria-label="تغییر سرعت پخش"
            onClick={() => {
              const value = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
              setSpeed(value);
              if (selected) setAudioSpeed(value);
            }}
          >
            <Volume2 size={11} />
            <bdi>{speed}×</bdi>
          </button>
        </div>
      </div>
      {error && (
        <small role="alert" className="audio-error">
          {error}
        </small>
      )}
    </div>
  );
}

// Outside the virtualized rows: playback survives scrolling, with controls always reachable.
export function ActiveAudio() {
  const playback = useSyncExternalStore(subscribePlayback, getPlayback, getIdlePlayback);
  if (!playback.src) return null;
  return (
    <div className="messenger-audio-bar" aria-label="پخش صوتی فعال">
      <button
        type="button"
        aria-label={playback.playing ? 'مکث پخش صوتی فعال' : 'ادامه پخش صوتی فعال'}
        onClick={() => {
          if (playback.playing) pauseAudio();
          else
            void playAudio(
              playback.src,
              playback.label,
              playback.duration,
              playback.speed,
              playback.time,
            );
        }}
      >
        {playback.playing ? <Pause size={17} /> : <Play size={17} />}
      </button>
      <span>{playback.label}</span>
      <bdi>
        {audioTime(playback.time)} / {audioTime(playback.duration)}
      </bdi>
      <button type="button" aria-label="بستن پخش صوتی" onClick={() => stopAudio()}>
        <X size={17} />
      </button>
    </div>
  );
}
