'use client';

import { useState, useRef, useEffect } from 'react';
import { LoaderCircle, Mic, Pause, Play, Square, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { digits } from '@/lib/utils';
import { AudioPlayer, audioTime } from './audio-player';
import { stopAudio } from '@/lib/audio-playback';
import { waitForMicrophone } from '@/lib/microphone';

type Session = {
  abort: AbortController;
  media?: MediaRecorder;
  stream?: MediaStream;
  context?: AudioContext;
  analyser?: AnalyserNode;
  chunks: Blob[];
  levels: number[];
  bytes: number;
  elapsed: number;
  startedAt: number | null;
  stopping: boolean;
  failure: string;
};

function elapsedSeconds(session: Session) {
  return (
    (session.elapsed + (session.startedAt === null ? 0 : performance.now() - session.startedAt)) /
    1000
  );
}

function release(session: Session) {
  session.abort.abort();
  const stream = session.stream;
  session.stream = undefined;
  stream?.getTracks().forEach((track) => {
    track.onended = null;
    track.onmute = null;
    track.stop();
  });
  const context = session.context;
  session.context = undefined;
  if (context && context.state !== 'closed') void context.close().catch(() => {});
}

async function prepareMeter(session: Session, stream: MediaStream) {
  // A normal AudioContext opens the default speaker even if nothing connects to
  // its destination. That can switch a headset/device route and mute its input.
  // Never open a physical playback device just to draw a waveform.
  if (typeof AudioContext === 'undefined' || !('sinkId' in AudioContext.prototype)) return;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const rate = stream.getAudioTracks()[0]?.getSettings?.().sampleRate;
    const options: AudioContextOptions & { sinkId: { type: 'none' } } = {
      ...(rate ? { sampleRate: rate } : {}),
      latencyHint: 'interactive',
      sinkId: { type: 'none' },
    };
    const context = new AudioContext(options);
    session.context = context;
    const sink = (context as AudioContext & { sinkId?: string | { type: string } }).sinkId;
    if (!sink || typeof sink === 'string' || sink.type !== 'none')
      throw new Error('Silent audio analysis unavailable');
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    context.createMediaStreamSource(stream).connect(analyser);
    await Promise.race([
      context.resume(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Audio meter unavailable')), 1000);
      }),
    ]);
    if (context.state !== 'running') throw new Error('Audio meter unavailable');
    session.analyser = analyser;
  } catch {
    // The optional meter must settle or close before recording starts: opening or
    // resuming an audio device during capture can interrupt its first seconds.
    session.analyser = undefined;
    if (session.context && session.context.state !== 'closed')
      await session.context.close().catch(() => {});
    session.context = undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export function VoiceRecorder({
  onFile,
  maxSeconds,
  maxBytes,
  onRecordingChange,
  compact = false,
}: {
  onFile: (file: File | null) => void;
  maxSeconds: number;
  maxBytes: number;
  onRecordingChange?: (recording: boolean) => void;
  compact?: boolean;
}) {
  const [state, setState] = useState<
    'idle' | 'starting' | 'recording' | 'paused' | 'stopping' | 'ready'
  >('idle');
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [preview, setPreview] = useState('');
  const [wave, setWave] = useState<number[]>([]);
  const session = useRef<Session | null>(null);
  const callback = useRef(onFile);
  const recordingCallback = useRef(onRecordingChange);
  useEffect(() => {
    callback.current = onFile;
    recordingCallback.current = onRecordingChange;
  }, [onFile, onRecordingChange]);
  useEffect(
    () => () => {
      const current = session.current;
      session.current = null;
      if (current) {
        if (current.media) {
          current.media.onstart = null;
          current.media.ondataavailable = null;
          current.media.onstop = null;
          current.media.onerror = null;
          if (current.media.state !== 'inactive') current.media.stop();
        }
        release(current);
      }
      recordingCallback.current?.(false);
    },
    [],
  );
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);
  useEffect(() => {
    const current = session.current;
    if (state !== 'recording' || !current || current.stopping) return;
    const timer = setInterval(() => {
      if (session.current !== current) return;
      setSeconds(elapsedSeconds(current));
      if (current.analyser) {
        const data = new Uint8Array(current.analyser.fftSize);
        current.analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const value of data) sum += ((value - 128) / 128) ** 2;
        current.levels.push(Math.sqrt(sum / data.length));
        setWave(current.levels.slice(-40).map((value) => Math.min(1, value * 6)));
      }
    }, 100);
    // A deadline separate from the display timer avoids interval drift.
    const deadline = setTimeout(
      () => {
        if (session.current === current) stop();
      },
      Math.max(0, maxSeconds - elapsedSeconds(current)) * 1000,
    );
    return () => {
      clearInterval(timer);
      clearTimeout(deadline);
    };
  }, [state, maxSeconds]);

  function stop() {
    const current = session.current;
    if (!current?.media || current.stopping) return;
    current.elapsed = elapsedSeconds(current) * 1000;
    current.startedAt = null;
    current.stopping = true;
    setSeconds(current.elapsed / 1000);
    setState('stopping');
    // Keep the tracks alive until the final dataavailable and stop events.
    if (current.media.state !== 'inactive') current.media.stop();
  }

  async function start() {
    if (session.current) return;
    setError('');
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('ضبط صدا در این مرورگر پشتیبانی نمی‌شود. می‌توانید یک فایل صوتی پیوست کنید.');
      return;
    }
    const current: Session = {
      abort: new AbortController(),
      chunks: [],
      levels: [],
      bytes: 0,
      elapsed: 0,
      startedAt: null,
      stopping: false,
      failure: '',
    };
    session.current = current;
    setState('starting');
    recordingCallback.current?.(true);
    callback.current(null);
    stopAudio();
    try {
      const format = [
        'audio/webm;codecs=opus',
        'audio/mp4',
        'audio/ogg;codecs=opus',
        'audio/webm',
      ].find((type) => MediaRecorder.isTypeSupported(type));
      if (!format) throw new Error('unsupported');
      // Voice messages are recordings, not calls: adaptive call processing can
      // gate quiet speech while its echo canceller and gain control settle.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: { ideal: 1 },
          echoCancellation: { ideal: false },
          noiseSuppression: { ideal: false },
          autoGainControl: { ideal: false },
        },
      });
      current.stream = stream;
      if (session.current !== current) {
        release(current);
        return;
      }
      await prepareMeter(current, stream);
      if (session.current !== current) {
        release(current);
        return;
      }
      const tracks = stream.getAudioTracks();
      if (!tracks.length) throw new Error('Microphone disconnected');
      await Promise.all(tracks.map((track) => waitForMicrophone(track, current.abort.signal)));
      if (session.current !== current) return;
      const media = new MediaRecorder(stream, { mimeType: format });
      current.media = media;
      media.onstart = () => {
        if (session.current !== current || current.stopping) return;
        current.startedAt = performance.now();
        setState('recording');
      };
      media.ondataavailable = (event) => {
        if (session.current !== current || !event.data.size) return;
        current.chunks.push(event.data);
        current.bytes += event.data.size;
        if (current.bytes > maxBytes) {
          current.failure = 'حجم صدا بیش از حد مجاز است. ضبط کوتاه‌تری انجام دهید.';
          stop();
        }
      };
      media.onerror = () => {
        if (session.current !== current) return;
        current.failure = 'ضبط صدا قطع شد. لطفاً دوباره ضبط کنید.';
        stop();
      };
      stream.getAudioTracks().forEach((track) => {
        track.onmute = () => {
          if (session.current !== current || current.stopping) return;
          current.failure = 'ورودی میکروفون قطع شد و ضبط ناقص است. دوباره ضبط کنید.';
          stop();
        };
        track.onended = () => {
          if (session.current !== current || current.stopping) return;
          current.failure = 'اتصال میکروفون قطع شد. لطفاً دوباره ضبط کنید.';
          stop();
        };
      });
      media.onstop = () => {
        if (session.current !== current) return;
        if (!current.stopping && !current.failure)
          current.failure = 'ضبط صدا ناخواسته قطع شد. دوباره ضبط کنید.';
        const duration = elapsedSeconds(current);
        session.current = null;
        release(current);
        recordingCallback.current?.(false);
        // Use the negotiated MIME type and include the final chunk before publishing.
        const mime = media.mimeType || current.chunks[0]?.type || format;
        const type = mime.split(';')[0];
        const blob = new Blob(current.chunks, { type: mime });
        const failure =
          current.failure ||
          (blob.size > maxBytes
            ? 'حجم صدا بیش از حد مجاز است. ضبط کوتاه‌تری انجام دهید.'
            : !blob.size
              ? 'صدایی ضبط نشد. دوباره تلاش کنید.'
              : '');
        if (failure) {
          setError(failure);
          setState('idle');
          callback.current(null);
          return;
        }
        const values = current.levels;
        const peak = Math.max(...values, 0.001);
        setWave(
          Array.from({ length: 64 }, (_, index) => {
            const samples = values.slice(
              Math.floor((index * values.length) / 64),
              Math.floor(((index + 1) * values.length) / 64),
            );
            return samples.length
              ? Math.sqrt(samples.reduce((sum, value) => sum + value, 0) / samples.length / peak)
              : 0;
          }),
        );
        const ext = type === 'audio/mp4' ? 'm4a' : type === 'audio/ogg' ? 'ogg' : 'webm';
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type });
        setSeconds(duration);
        setPreview(URL.createObjectURL(blob));
        callback.current(file);
        setState('ready');
      };
      setSeconds(0);
      setWave([]);
      if (tracks.some((track) => track.muted || !track.enabled || track.readyState === 'ended'))
        throw new Error('Microphone disconnected');
      // Nothing may initialize or reconfigure the audio graph after this point.
      media.start(250);
    } catch (cause) {
      release(current);
      if (session.current !== current) return;
      session.current = null;
      recordingCallback.current?.(false);
      setError(
        cause instanceof Error && cause.message === 'unsupported'
          ? 'قالب صوتی سازگار پیدا نشد. فایل صوتی را پیوست کنید.'
          : cause instanceof Error && cause.message.startsWith('Microphone ')
            ? 'ورودی میکروفون آماده نشد. اتصال و بی‌صدا نبودن میکروفون را بررسی کنید.'
            : 'دسترسی به میکروفون برقرار نشد. مجوز مرورگر و اتصال امن را بررسی کنید.',
      );
      setState('idle');
    }
  }

  function togglePause() {
    const current = session.current;
    if (!current?.media || current.stopping) return;
    if (state === 'recording') {
      current.media.pause();
      current.elapsed = elapsedSeconds(current) * 1000;
      current.startedAt = null;
      setSeconds(current.elapsed / 1000);
      setState('paused');
    } else {
      current.media.resume();
      current.startedAt = performance.now();
      setState('recording');
    }
  }

  function clear() {
    setPreview('');
    setSeconds(0);
    setState('idle');
    onFile(null);
  }

  const active = state === 'recording' || state === 'paused';
  const waiting = state === 'starting' || state === 'stopping';
  const liveWave = wave.slice(-32);
  const label = active
    ? 'پایان ضبط'
    : state === 'stopping'
      ? 'آماده‌سازی صدا'
      : state === 'starting'
        ? 'اتصال به میکروفون'
        : 'ضبط پیام صوتی';
  return (
    <div className={`voice-controls${compact ? ' voice-compact' : ''}`} data-state={state}>
      <div className="voice-row">
        {state !== 'ready' && (
          <Button
            type="button"
            className={`voice-toggle${active ? ' voice-toggle-active' : ''}`}
            variant="ghost"
            size={compact ? 'icon' : 'sm'}
            aria-label={label}
            title={label}
            disabled={waiting}
            onClick={active ? stop : start}
          >
            {waiting ? (
              <LoaderCircle className="voice-spinner" size={21} />
            ) : active ? (
              <Square size={19} fill="currentColor" />
            ) : (
              <Mic size={compact ? 21 : 17} />
            )}
            {!compact && <span>{label}</span>}
          </Button>
        )}
        {(active || waiting) && (
          <div className="voice-session">
            <span className="voice-recording-dot" aria-hidden="true" />
            <span className="voice-status" role="status">
              {state === 'starting'
                ? 'در حال اتصال به میکروفون…'
                : state === 'stopping'
                  ? 'در حال آماده‌سازی صدا…'
                  : state === 'paused'
                    ? 'ضبط متوقف است'
                    : 'در حال ضبط'}
            </span>
            <time className="voice-timer" dir="ltr" aria-label="مدت ضبط">
              {audioTime(seconds).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)])}
            </time>
            <div className="live-wave" aria-hidden="true">
              {Array.from({ length: 32 }, (_, index) => (
                <span key={index} style={{ height: `${4 + (liveWave[index] ?? 0) * 22}px` }} />
              ))}
            </div>
            {active && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={state === 'recording' ? 'مکث ضبط' : 'ادامه ضبط'}
                onClick={togglePause}
              >
                {state === 'recording' ? <Pause size={17} /> : <Play size={17} />}
              </Button>
            )}
          </div>
        )}
        {state === 'ready' && (
          <>
            <AudioPlayer
              src={preview}
              durationSeconds={seconds}
              waveform={wave}
              label="پیش‌شنوی پیام صوتی"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="حذف صدای ضبط‌شده"
              onClick={clear}
            >
              <Trash2 size={17} />
            </Button>
          </>
        )}
        {state === 'idle' && !compact && <small>حداکثر {digits(maxSeconds)} ثانیه</small>}
      </div>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
