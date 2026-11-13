import { afterAll, expect, it } from 'vitest';
import { db, Prisma } from '@niticket/database';
import { boundedQuery } from '@niticket/core/infrastructure/bounded-query';

afterAll(() => db.$disconnect());

it('cancels expensive search SQL with a recoverable error and keeps ordinary database reads available', async () => {
  await expect(boundedQuery(Prisma.sql`SELECT pg_sleep(4)`)).rejects.toMatchObject({
    code: 'SEARCH_BUSY',
    status: 503,
  });
  expect(await boundedQuery<{ value: number }[]>(Prisma.sql`SELECT 1::int AS value`)).toEqual([
    { value: 1 },
  ]);
  expect(await db.$queryRaw<{ value: number }[]>`SELECT 2::int AS value`).toEqual([{ value: 2 }]);
});
