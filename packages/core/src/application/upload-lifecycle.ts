import { z } from 'zod';
import { db } from '@niticket/database';
import { transaction } from '../infrastructure/transaction';
import { deleteObject } from '../infrastructure/storage';
import { attachmentChanged } from './realtime-events';

/** Claim expiry before touching storage. Completion and expiry compete on the same row. */
export async function expireUploads(limit = 25, now = new Date()) {
  z.number().int().min(1).max(100).parse(limit);
  const candidates = await db.attachment.findMany({
    where: { scanStatus: 'PENDING', expiresAt: { lte: now } },
    orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
    take: limit,
    select: { id: true },
  });
  let expired = 0;
  for (const file of candidates) expired += await expireUpload(file.id, now);
  return expired;
}

export async function expireUpload(id: string, now = new Date()) {
  return transaction(async (tx) => {
    const file = await tx.attachment.findUnique({ where: { id } });
    if (!file || file.scanStatus !== 'PENDING' || file.expiresAt > now) return 0;
    const changed = await tx.attachment.updateMany({
      where: { id: file.id, scanStatus: 'PENDING', expiresAt: { lte: now } },
      data: { scanStatus: 'REJECTED', scanResult: 'EXPIRED' },
    });
    if (!changed.count) return 0;
    await tx.outboxEvent.create({
      data: { type: 'DELETE_PENDING_OBJECT', payload: { key: file.objectKey } },
    });
    await attachmentChanged(tx, file);
    return 1;
  });
}

/** Retries survive storage failures; never delete a file still being uploaded or scanned. */
export async function deleteExpiredUpload(eventId: string, payload: unknown) {
  const { key } = z
    .object({ key: z.string().regex(/^pending\/[a-zA-Z0-9-]+$/) })
    .strict()
    .parse(payload);
  if (
    await db.attachment.findFirst({
      where: { objectKey: key, scanStatus: { not: 'REJECTED' } },
      select: { id: true },
    })
  )
    throw new Error('Pending object is still in use');
  await deleteObject(key);
  await db.outboxEvent.update({ where: { id: eventId }, data: { processedAt: new Date() } });
}
