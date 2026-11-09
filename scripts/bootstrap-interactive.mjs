import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, ['scripts/bootstrap.ts'], {
  env: process.env,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
