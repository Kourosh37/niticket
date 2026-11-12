/** A live track can still be muted while the browser opens the capture device. */
export async function waitForMicrophone(track: MediaStreamTrack, signal: AbortSignal) {
  signal.throwIfAborted();
  if (track.readyState === 'ended' || !track.enabled) throw new Error('Microphone disconnected');
  if (!track.muted) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('Microphone unavailable')), 5000);

    function finish(error?: unknown) {
      clearTimeout(timeout);
      track.removeEventListener('unmute', ready);
      track.removeEventListener('ended', ended);
      signal.removeEventListener('abort', cancel);
      if (error) reject(error);
      else resolve();
    }

    function ready() {
      if (!track.muted && track.enabled) finish();
    }

    function ended() {
      finish(new Error('Microphone disconnected'));
    }

    function cancel() {
      finish(signal.reason);
    }

    track.addEventListener('unmute', ready);
    track.addEventListener('ended', ended);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    else if (track.readyState === 'ended') ended();
    else ready();
  });
}
