import { db } from '@niticket/database';
import { redis } from '@niticket/core/infrastructure/redis';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await Promise.all([db.$queryRaw`SELECT 1`, redis().ping()]);
    return Response.json({ status: 'ready' });
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503 });
  }
}
