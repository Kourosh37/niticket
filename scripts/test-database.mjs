import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const url = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL);
if (!process.env.TEST_DATABASE_URL) url.pathname = '/niticket_test';
if (!url.pathname.endsWith('_test')) throw new Error('Test database must end in _test');
const result = spawnSync(
  process.execPath,
  [
    resolve('node_modules/prisma/build/index.js'),
    'migrate',
    'deploy',
    '--schema',
    'packages/database/prisma/schema.prisma',
  ],
  { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'inherit' },
);
process.exit(result.status ?? 1);
