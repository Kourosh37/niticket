// Fixed labels keep memory bounded and prevent user content entering telemetry.
export type Metric =
  | 'cache.local_hit'
  | 'cache.shared_hit'
  | 'cache.coalesced'
  | 'cache.load'
  | 'cache.fallback'
  | 'search'
  | 'job.events'
  | 'job.media';

type Sample = { count: number; failures: number; totalMs: number; maxMs: number };
const samples = new Map<Metric, Sample>();
const startedAt = new Date().toISOString();

export function measure(name: Metric, ms = 0, failed = false) {
  if (!Number.isFinite(ms) || ms < 0) return;
  const sample = samples.get(name) ?? { count: 0, failures: 0, totalMs: 0, maxMs: 0 };
  sample.count++;
  sample.failures += Number(failed);
  sample.totalMs += ms;
  sample.maxMs = Math.max(sample.maxMs, ms);
  samples.set(name, sample);
}

export function processMetrics() {
  return {
    startedAt,
    scope: 'process' as const,
    samples: Object.fromEntries(
      [...samples].map(([key, value]) => [key, { ...value, meanMs: value.totalMs / value.count }]),
    ),
  };
}
