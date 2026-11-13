import { test as base } from '@playwright/test';

export * from '@playwright/test';

// Prisma is shared by imported application modules for the lifetime of this worker.
// Disconnecting after individual cases races post-commit publications and the next case.
export const test = base.extend<Record<never, never>, { applicationRuntime: void }>({
  applicationRuntime: [
    async ({}, use) => {
      await use();
      const { drainRealtime } = await import('@niticket/core/infrastructure/realtime');
      const { closeReadCache } = await import('@niticket/core/infrastructure/read-cache');
      const { redis } = await import('@niticket/core/infrastructure/redis');
      const { db } = await import('@niticket/database');
      try {
        await drainRealtime();
      } finally {
        closeReadCache();
        redis().disconnect();
        await db.$disconnect();
      }
    },
    { scope: 'worker', auto: true },
  ],
});
