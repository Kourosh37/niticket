import { db, Prisma } from '@niticket/database';
import { config } from '../infrastructure/config';

export function outboxRetentionCutoff(now = new Date()) {
  return new Date(now.getTime() - config().OUTBOX_RETENTION_DAYS * 86400000);
}

/** Only completed delivery envelopes expire. Chat history and replay keys are durable. */
export async function purgeCompletedOutbox(now = new Date()) {
  const cutoff = outboxRetentionCutoff(now);
  const removed = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    WITH expired AS (
      SELECT id FROM "OutboxEvent"
      WHERE "processedAt" < ${cutoff} AND "failedAt" IS NULL
      ORDER BY "processedAt", id LIMIT 200 FOR UPDATE SKIP LOCKED
    )
    DELETE FROM "OutboxEvent" o USING expired
    WHERE o.id = expired.id RETURNING o.id
  `);
  return removed.length;
}
