import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

it('runs the test process and its children on the pinned Bun runtime', () => {
  const expected = readFileSync('.bun-version', 'utf8').trim();
  expect(process.versions.bun).toBe(expected);
  const child = spawnSync(process.execPath, ['-e', 'console.log(process.versions.bun)'], {
    encoding: 'utf8',
    timeout: 10000,
  });
  expect(child.status).toBe(0);
  expect(child.stdout.trim()).toBe(expected);
});
