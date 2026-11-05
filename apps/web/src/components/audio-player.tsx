'use client';

import { useRef, useState } from 'react';
import { Play, Pause, Volume2 } from 'lucide-react';

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
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false),
    [time, setTime] = useState(0),
    [duration, setDuration] = useState(durationSeconds ?? 0),
    [error, setError] = useState(''),
    [speed, setSpeed] = useState(1);
  const bars =
    Array.isArray(waveform) && waveform.length
      ? waveform
          .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
          .slice(0, 100)
      : Array.from({ length: 64 }, () => 0);

  function seek(value: number) {
    if (ref.current) {
      ref.current.currentTime = value;
      setTime(value);
    }
  }

  return (
    <div className="audio-player" aria-label={label}>
      <audio
        ref={ref}
        src={src}
        preload="metadata"
        onLoadedMetadata={() => {
          const d = ref.current?.duration;
          if (d && Number.isFinite(d)) setDuration(d);
        }}
        onTimeUpdate={() => setTime(ref.current?.currentTime ?? 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setError('دریافت صدا انجام نشد. دوباره تلاش کنید.')}
      />
      <button
        className="audio-play"
        type="button"
        aria-label={playing ? `مکث ${label}` : `پخش ${label}`}
        onClick={async () => {
          setError('');
          try {
            if (playing) ref.current?.pause();
            else await ref.current?.play();
          } catch {
            setError('پخش صدا انجام نشد. دوباره تلاش کنید.');
          }
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
              if (ref.current) ref.current.playbackRate = value;
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
