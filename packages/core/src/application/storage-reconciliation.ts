import { z } from 'zod';
import { db, type Prisma } from '@niticket/database';
import { transaction } from '../infrastructure/transaction';
import { deleteObject } from '../infrastructure/storage';

const objectKey = z.string().regex(/^clean\/[a-f0-9-]{36}(?:\.thumbnail\.webp)?$/i);
const grace = 60 * 60 * 1000;

export async function reservePromotion(keys: string[]) {
  z.array(objectKey).min(1).max(2).parse(keys);
  const collectAfter = new Date(Date.now() + grace);
  await db.storageCandidate.createMany({ data: keys.map((key) => ({ key, collectAfter })) });
}

export async function assertPromotion(tx: Prisma.TransactionClient, keys: string[]) {
  const live = await tx.storageCandidate.count({
    where: { key: { in: keys }, collectAfter: { gt: new Date() } },
  });
  if (live !== keys.length) throw new Error('Storage promotion lease expired');
}

export async function completePromotion(tx: Prisma.TransactionClient, keys: string[]) {
  await tx.storageCandidate.deleteMany({ where: { key: { in: keys } } });
}

export async function collectPromotion(key: string, now = new Date()) {
  return transaction(async (tx) => {
    const candidate = await tx.storageCandidate.findUnique({ where: { key } });
    if (!candidate || candidate.collectAfter > now) return 0;
    const referenced = await tx.attachment.findFirst({
      where: { OR: [{ objectKey: key }, { thumbnailKey: key }] },
      select: { id: true },
    });
    if (!referenced)
      await tx.outboxEvent.create({
        data: { type: 'DELETE_UNREFERENCED_OBJECT', payload: { key } },
      });
    await tx.storageCandidate.delete({ where: { key } });
    return referenced ? 0 : 1;
  });
}

export async function collectOrphanedStorage(limit = 25, now = new Date()) {
  z.number().int().min(1).max(100).parse(limit);
  const candidates = await db.storageCandidate.findMany({
    where: { collectAfter: { lte: now } },
    orderBy: [{ collectAfter: 'asc' }, { key: 'asc' }],
    take: limit,
    select: { key: true },
  });
  let collected = 0;
  for (const { key } of candidates) collected += await collectPromotion(key, now);
  return collected;
}

export async function deleteUnreferencedObject(eventId: string, payload: unknown) {
  const { key } = z.object({ key: objectKey }).strict().parse(payload);
  const referenced = await db.attachment.findFirst({
    where: { OR: [{ objectKey: key }, { thumbnailKey: key }] },
    select: { id: true },
  });
  if (!referenced) await deleteObject(key);
  await db.outboxEvent.update({ where: { id: eventId }, data: { processedAt: new Date() } });
}
