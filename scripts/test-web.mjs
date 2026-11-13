import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createWriteStream, mkdirSync } from 'node:fs';
import { cp } from 'node:fs/promises';

mkdirSync('.local', { recursive: true });
const otpLog = createWriteStream('.local/e2e-auth.log', { flags: 'w' });

const url = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL);
if (!process.env.TEST_DATABASE_URL) url.pathname = '/niticket_test';
if (!url.pathname.endsWith('_test')) throw new Error('Test DB must end in _test');
// Exercise the same standalone entry point and asset layout as the production Bun image.
const standalone = resolve('apps/web/.next/standalone/apps/web');
await cp(resolve('apps/web/.next/static'), resolve(standalone, '.next/static'), {
  recursive: true,
});
await cp(resolve('apps/web/public'), resolve(standalone, 'public'), { recursive: true });
const child = spawn(process.execPath, [resolve(standalone, 'server.js')], {
  env: {
    ...process.env,
    DATABASE_URL: url.toString(),
    APP_ORIGIN: 'http://localhost:3001',
    BETTER_AUTH_URL: 'http://localhost:3001',
    SMS_PROVIDER: 'log',
    LOG_LEVEL: 'info',
    QUEUE_NAME: process.env.TEST_QUEUE_NAME ?? 'niticket-test',
    PORT: '3001',
    HOSTNAME: '127.0.0.1',
  },
  stdio: ['inherit', 'pipe', 'inherit'],
});
child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  otpLog.write(chunk);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 0));
