import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createWriteStream, mkdirSync } from 'node:fs';

mkdirSync('.local', { recursive: true });
const otpLog = createWriteStream('.local/e2e-auth.log', { flags: 'w' });

const url = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL);
if (!process.env.TEST_DATABASE_URL) url.pathname = '/niticket_test';
if (!url.pathname.endsWith('_test')) throw new Error('Test DB must end in _test');
const child = spawn(
  process.execPath,
  [resolve('node_modules/next/dist/bin/next'), 'start', 'apps/web', '--port', '3001'],
  {
    env: {
      ...process.env,
      DATABASE_URL: url.toString(),
      APP_ORIGIN: 'http://localhost:3001',
      BETTER_AUTH_URL: 'http://localhost:3001',
      SMS_PROVIDER: 'log',
      LOG_LEVEL: 'info',
      QUEUE_NAME: 'niticket-test',
    },
    stdio: ['inherit', 'pipe', 'inherit'],
  },
);
child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  otpLog.write(chunk);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 0));
