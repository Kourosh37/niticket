import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/bootstrap.ts'], {
  env: process.env,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
