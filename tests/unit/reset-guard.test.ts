import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

it('refuses database resets without both an exact database name and the explicit reset flag', () => {
  for (const args of [
    [],
    ['--confirm-reset'],
    ['--database', 'reset_guard_test'],
    ['--database', 'another_database', '--confirm-reset'],
  ]) {
    const result = spawnSync(process.execPath, ['scripts/reset-data.ts', ...args], {
      env: {
        ...process.env,
        DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/reset_guard_test',
      },
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Refusing reset');
    expect(result.stderr).not.toContain("Can't reach database");
  }
}, 15000);
