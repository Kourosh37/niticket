'use client';

import { useState, useRef, useEffect } from 'react';
import { Mic, Pause, Play, Square, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { digits } from '@/lib/utils';
import { AudioPlayer } from './audio-player';

export function VoiceRecorder({
  onFile,
  maxSeconds,
  maxBytes,
  onRecordingChange,
}: {
  onFile: (file: File | null) => void;
  maxSeconds: number;
  maxBytes: number;
  onRecordingChange?: (recording: boolean) => void;
}) {
  const [state, setState] = useState<'idle' | 'starting' | 'recording' | 'paused' | 'ready'>(
    'idle',
  );
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [preview, setPreview] = useState('');
  const [wave, setWave] = useState<number[]>([]);
  const audioContext = useRef<AudioContext | null>(null),
    analyser = useRef<AnalyserNode | null>(null),
    levels = useRef<number[]>([]);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const elapsed = useRef(0);
  const bytes = useRef(0);
  const callback = useRef(onFile);
  const mounted = useRef(true);
  const recordingCallback = useRef(onRecordingChange);
  useEffect(() => {
    callback.current = onFile;
    recordingCallback.current = onRecordingChange;
  }, [onFile, onRecordingChange]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (recorder.current) {
        recorder.current.onstop = null;
        if (recorder.current.state !== 'inactive') recorder.current.stop();
      }
      stream.current?.getTracks().forEach((t) => t.stop());
      void audioContext.current?.close();
      recordingCallback.current?.(false);
    };
  }, []);
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);
  useEffect(() => {
    if (state !== 'recording') return;
    const timer = setInterval(() => {
      elapsed.current++;
      setSeconds(elapsed.current);
      if (elapsed.current >= maxSeconds && recorder.current?.state !== 'inactive')
        recorder.current?.stop();
    }, 1000);
    return () => clearInterval(timer);
  }, [state, maxSeconds]);
  useEffect(() => {
    if (state !== 'recording' || !analyser.current) return;
    const timer = setInterval(() => {
      const node = analyser.current;
      if (!node) return;
      const data = new Uint8Array(node.fftSize);
      node.getByteTimeDomainData(data);
      let sum = 0;
      for (const value of data) sum += ((value - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / data.length);
      levels.current.push(rms);
      setWave(levels.current.slice(-64).map((v) => Math.min(1, v * 6)));
    }, 100);
    return () => clearInterval(timer);
  }, [state]);

  async function start() {
    setError('');
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('ضبط صدا در این مرورگر پشتیبانی نمی‌شود. می‌توانید یک فایل صوتی پیوست کنید.');
      return;
    }
    try {
      const format = [
        'audio/webm;codecs=opus',
        'audio/mp4',
        'audio/ogg;codecs=opus',
        'audio/webm',
      ].find((t) => MediaRecorder.isTypeSupported(t));
      if (!format) {
        setError('قالب صوتی سازگار پیدا نشد. فایل صوتی را پیوست کنید.');
        return;
      }
      setState('starting');
      recordingCallback.current?.(true);
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) {
        stream.current.getTracks().forEach((track) => track.stop());
        recordingCallback.current?.(false);
        return;
      }
      levels.current = [];
      setWave([]);
      if (typeof AudioContext !== 'undefined') {
        audioContext.current = new AudioContext();
        analyser.current = audioContext.current.createAnalyser();
        analyser.current.fftSize = 256;
        audioContext.current.createMediaStreamSource(stream.current).connect(analyser.current);
        await audioContext.current.resume();
      }
      chunks.current = [];
      elapsed.current = 0;
      bytes.current = 0;
      setSeconds(0);
      const media = new MediaRecorder(stream.current, { mimeType: format });
      recorder.current = media;
      media.ondataavailable = (event) => {
        if (event.data.size) {
          chunks.current.push(event.data);
          bytes.current += event.data.size;
          if (bytes.current >= maxBytes && media.state !== 'inactive') media.stop();
        }
      };
      media.onerror = () => {
        setError('ضبط صدا متوقف شد. دوباره تلاش کنید.');
        if (media.state !== 'inactive') media.stop();
        stream.current?.getTracks().forEach((t) => t.stop());
      };
      media.onstop = () => {
        stream.current?.getTracks().forEach((t) => t.stop());
        void audioContext.current?.close();
        audioContext.current = null;
        analyser.current = null;
        recordingCallback.current?.(false);
        const values = levels.current;
        const peak = Math.max(...values, 0.001);
        setWave(
          Array.from({ length: 64 }, (_, i) => {
            const samples = values.slice(
              Math.floor((i * values.length) / 64),
              Math.floor(((i + 1) * values.length) / 64),
            );
            return samples.length
              ? Math.sqrt(samples.reduce((sum, v) => sum + v, 0) / samples.length / peak)
              : 0;
          }),
        );
        const type = format.split(';')[0];
        const blob = new Blob(chunks.current, { type });
        if (blob.size > maxBytes) {
          setError('حجم صدا بیش از حد مجاز است. ضبط کوتاه‌تری انجام دهید.');
          setState('idle');
          return;
        }
        const ext = type === 'audio/mp4' ? 'm4a' : type === 'audio/ogg' ? 'ogg' : 'webm';
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type });
        setPreview(URL.createObjectURL(blob));
        callback.current(file);
        setState('ready');
      };
      media.start(250);
      setState('recording');
    } catch {
      stream.current?.getTracks().forEach((t) => t.stop());
      void audioContext.current?.close();
      audioContext.current = null;
      analyser.current = null;
      recordingCallback.current?.(false);
      setError('دسترسی به میکروفون برقرار نشد. مجوز مرورگر و اتصال امن را بررسی کنید.');
      setState('idle');
    }
  }

  function clear() {
    setPreview('');
    setSeconds(0);
    setState('idle');
    onFile(null);
  }

  return (
    <div className="voice-controls">
      <div className="voice-row">
        {state === 'starting' && <span role="status">در حال اتصال به میکروفون…</span>}
        {state === 'idle' && (
          <Button type="button" variant="ghost" size="sm" onClick={start}>
            <Mic size={17} /> ضبط پیام صوتی
          </Button>
        )}
        {(state === 'recording' || state === 'paused') && (
          <>
            <span role="status">
              {state === 'recording' ? 'در حال ضبط' : 'ضبط متوقف است'} · {digits(seconds)} ثانیه
            </span>
            <div className="live-wave" aria-hidden="true">
              {wave.map((value, index) => (
                <span key={index} style={{ height: `${4 + value * 24}px` }} />
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={state === 'recording' ? 'مکث ضبط' : 'ادامه ضبط'}
              onClick={() => {
                if (state === 'recording') {
                  recorder.current?.pause();
                  setState('paused');
                } else {
                  recorder.current?.resume();
                  setState('recording');
                }
              }}
            >
              {state === 'recording' ? <Pause size={16} /> : <Play size={16} />}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="پایان ضبط"
              onClick={() => recorder.current?.stop()}
            >
              <Square size={16} />
            </Button>
          </>
        )}
        {state === 'ready' && (
          <>
            <AudioPlayer
              src={preview}
              durationSeconds={seconds}
              waveform={wave}
              label="پیش‌شنوی پیام صوتی"
            />
            <small>{digits(seconds)} ثانیه</small>
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
        {state === 'idle' && <small>حداکثر {digits(maxSeconds)} ثانیه</small>}
      </div>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
