import { db, Prisma } from '@niticket/database';
import { AppError } from '../domain/errors';

export async function transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await db.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 15000,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        if (attempt < 5) {
          await new Promise((resolve) =>
            setTimeout(resolve, 20 * 2 ** attempt + Math.random() * 35),
          );
          continue;
        }
        throw new AppError('CONFLICT', 409, 'داده‌ها هم‌زمان تغییر کرده‌اند؛ دوباره تلاش کنید.');
      }
      throw error;
    }
  }
  throw new Error('Unreachable transaction retry');
}
