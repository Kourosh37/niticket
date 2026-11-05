import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

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
    },
    stdio: 'inherit',
  },
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 0));
