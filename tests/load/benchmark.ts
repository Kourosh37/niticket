import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';

const testUrl = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!);
if (!process.env.TEST_DATABASE_URL) testUrl.pathname = '/niticket_test';
if (!testUrl.pathname.endsWith('_test'))
  throw new Error('Benchmark requires an isolated test database');
process.env.DATABASE_URL = testUrl.toString();
process.env.APP_ORIGIN = 'http://localhost:3001';
process.env.BETTER_AUTH_URL = 'http://localhost:3001';
const { fixtures } = await import('../helpers/fixtures');
const { db } = await import('@niticket/database');
const f = await fixtures();
const origin = 'http://localhost:3001';
type Metric = {
  name: string;
  count: number;
  failures: number;
  p50: number;
  p95: number;
  max: number;
  elapsedMs: number;
};
const metrics: Metric[] = [];

async function measure(
  name: string,
  count: number,
  concurrency: number,
  fn: (index: number) => Promise<Response>,
) {
  const durations: number[] = [];
  let failures = 0;
  let next = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < count) {
        const index = next++;
        const start = performance.now();
        try {
          const response = await fn(index);
          await response.arrayBuffer();
          if (!response.ok) failures++;
        } catch {
          failures++;
        }
        durations.push(performance.now() - start);
      }
    }),
  );
  durations.sort((a, b) => a - b);
  const percentile = (p: number) =>
    Math.round(
      durations[Math.min(durations.length - 1, Math.ceil(durations.length * p) - 1)] * 100,
    ) / 100;
  metrics.push({
    name,
    count,
    failures,
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: percentile(1),
    elapsedMs: Math.round(performance.now() - started),
  });
}

let cookie = '';
await measure('login', 1, 1, async () => {
  const response = await fetch(origin + '/api/auth/sign-in/email', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ email: f.student.email, password: f.password, rememberMe: false }),
  });
  cookie = response.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; ');
  return response;
});
const headers = { origin, 'content-type': 'application/json', cookie };
await measure('ticket-list', 32, 4, () =>
  fetch(origin + '/api/v1/tickets?scope=mine&limit=20', { headers }),
);
await measure('ticket-create', 12, 4, () =>
  fetch(origin + '/api/v1/tickets', {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': randomUUID() },
    body: JSON.stringify({
      departmentId: f.department.id,
      subject: 'درخواست سنجش کارایی سامانه',
      body: 'این درخواست در پایگاه آزمایشی برای سنجش کارایی ایجاد شده است.',
    }),
  }),
);
await measure('dashboard-report', 16, 4, () => fetch(origin + '/api/v1/reports', { headers }));
const report = {
  timestamp: new Date().toISOString(),
  environment:
    'local Windows host Next production server; Docker PostgreSQL/Redis; isolated test database',
  concurrency: 4,
  metrics,
  limitations:
    'Small synthetic smoke test. Not a university-scale capacity claim; login concurrency, large data sets, message contention and sustained queue throughput require an agreed profile.',
};
await mkdir('test-results', { recursive: true });
await writeFile('test-results/benchmark.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await db.$disconnect();
if (metrics.some((m) => m.failures)) process.exitCode = 1;
