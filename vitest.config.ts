import { defineConfig } from 'vitest/config';
import { loadEnvFile } from 'node:process';
import path from 'node:path';
import { randomInt } from 'node:crypto';

try {
  loadEnvFile('.env');
} catch {
  /* CI injects environment directly. */
}
const alias = {
  '@': path.resolve('apps/web/src'),
  '@niticket/database': path.resolve('packages/database/src/index.ts'),
  '@niticket/core': path.resolve('packages/core/src'),
};
const testUrl = new URL(
  process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgresql://unused:unused@localhost/niticket_test',
);
if (!process.env.TEST_DATABASE_URL) testUrl.pathname = '/niticket_test';
if (!testUrl.pathname.endsWith('_test'))
  throw new Error('Integration database name must end in _test');

export default defineConfig({
  resolve: { alias },
  test: {
    // Bun 1.4.4's ESM namespace interop drops Zod's named export when externalized.
    // Transform it with Vite until https://github.com/oven-sh/bun/issues/39866 is fixed.
    server: { deps: { inline: ['zod'] } },
    maxWorkers: 2,
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'] },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          fileParallelism: false,
          testTimeout: 30000,
          env: {
            DATABASE_URL: testUrl.toString(),
            QUEUE_NAME: 'niticket-test',
            ADMIN_PHONE: `+989${randomInt(100000000, 999999999)}`,
          },
        },
      },
    ],
  },
});
