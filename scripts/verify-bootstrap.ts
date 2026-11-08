// Root mobile provisioning, OTP proof and idempotency are covered by mobile-auth.test.ts.
import { spawnSync } from 'node:child_process';

const result = spawnSync(
  process.execPath,
  [
    'node_modules/vitest/vitest.mjs',
    'run',
    '--project',
    'integration',
    'tests/integration/mobile-auth.test.ts',
  ],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
