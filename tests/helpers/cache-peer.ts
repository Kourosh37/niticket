import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import {
  cachedRead,
  closeReadCache,
  readCacheState,
} from '@niticket/core/infrastructure/read-cache';
import { db } from '@niticket/database';

if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('_test'))
  throw new Error('Cache peer requires a test database');

try {
  const deadline = Date.now() + 5000;
  while (!readCacheState().sharedReady) {
    if (Date.now() > deadline) throw new Error('Cache peer failed to connect');
    await cachedRead(`warm:${randomUUID()}`, [], 100, async () => 0);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  process.stdout.write('ready\n');
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    const { key, tag, value } = JSON.parse(line) as { key: string; tag: string; value: number };
    const result = await cachedRead(key, [tag], 30000, async () => value);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
} finally {
  closeReadCache();
  await db.$disconnect();
}
