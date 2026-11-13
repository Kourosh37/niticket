'use client';

import { useMemo, useState, useSyncExternalStore, useEffect, type CSSProperties } from 'react';
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
  const bars = useMemo(() => {
    const values = Array.isArray(waveform)
      ? waveform
          .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
          .slice(0, 100)
      : [];
    return values.length ? values : Array.from({ length: 64 }, () => 0);
  }, [waveform]);
  const progress = duration > 0 ? Math.max(0, Math.min(1, time / duration)) : 0;

  function seek(value: number) {
    if (selected) seekAudio(value);
    else setPosition(value);
  }

  return (
    <div className="audio-player" aria-label={label}>
      <button
        className="audio-play"
        type="button"
        aria-label={playing ? `مکث ${label}` : `پخش ${label}`}
        onClick={() => {
          if (playing) pauseAudio();
          else {
            setPosition(0); // Consume a pre-play seek without retaining stale progress after completion.
            void playAudio(src, label, duration, speed, time);
          }
        }}
      >
        {playing ? <Pause size={20} /> : <Play size={20} />}
      </button>
      <div className="audio-main">
        <div className="audio-wave" aria-hidden="true" dir="ltr">
          {bars.map((v, i) => {
            const fill = Math.max(0, Math.min(1, progress * bars.length - i));
            return (
              <span
                key={i}
                className={fill > 0 ? 'played' : ''}
                style={
                  {
                    height: `${4 + Math.max(0, Math.min(1, v)) * 27}px`,
                    '--wave-fill': `${fill * 100}%`,
                  } as CSSProperties
                }
              />
            );
          })}
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
