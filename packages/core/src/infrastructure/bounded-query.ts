import { db, Prisma } from '@niticket/database';
import { fail } from '../domain/errors';

/** Apply search deadlines to the transaction, without changing unrelated pooled requests. */
export async function boundedQuery<T>(query: Prisma.Sql): Promise<T> {
  try {
    return await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '2500ms'`;
        await tx.$executeRaw`SET LOCAL plan_cache_mode = force_custom_plan`;
        return tx.$queryRaw<T>(query);
      },
      { timeout: 5000, maxWait: 3000 },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2028' || (error.code === 'P2010' && error.meta?.code === '57014'))
    )
      fail('SEARCH_BUSY', 503, 'جستجو زمان‌بر شد؛ عبارت دقیق‌تر یا بازهٔ تاریخ انتخاب کنید.');
    throw error;
  }
}
