import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { db } from '@niticket/database';
import { purgeCompletedOutbox, outboxRetentionCutoff } from '@niticket/core/application/retention';

afterAll(() => db.$disconnect());

it('purges bounded completed envelopes by completion age while preserving retries and durable records', async () => {
  const now = new Date('1900-06-01');
  const old = new Date('1900-01-01');
  const ids = Array.from({ length: 205 }, () => randomUUID());
  const guards = Array.from({ length: 4 }, () => randomUUID());
  const replay = await db.idempotency.create({
    data: {
      actorId: randomUUID(),
      key: randomUUID(),
      fingerprint: 'test',
      resourceId: randomUUID(),
      createdAt: old,
    },
  });
  const audit = await db.auditLog.create({
    data: { action: 'RETENTION_TEST', metadata: {}, createdAt: old },
  });
  await db.outboxEvent.createMany({
    data: [
      ...ids.map((id) => ({
        id,
        type: 'RETENTION_TEST',
        payload: {},
        processedAt: old,
        createdAt: old,
      })),
      { id: guards[0], type: 'RETENTION_TEST', payload: {}, createdAt: old },
      { id: guards[1], type: 'RETENTION_TEST', payload: {}, createdAt: old, failedAt: old },
      {
        id: guards[2],
        type: 'RETENTION_TEST',
        payload: {},
        createdAt: old,
        processedAt: old,
        failedAt: old,
      },
      {
        id: guards[3],
        type: 'RETENTION_TEST',
        payload: {},
        createdAt: old,
        processedAt: outboxRetentionCutoff(now),
      },
    ],
  });
  try {
    expect(await purgeCompletedOutbox(now)).toBe(200);
    expect(await purgeCompletedOutbox(now)).toBe(5);
    expect(await purgeCompletedOutbox(now)).toBe(0);
    expect(await db.outboxEvent.count({ where: { id: { in: guards } } })).toBe(4);
    expect(await db.idempotency.findUnique({ where: { id: replay.id } })).not.toBeNull();
    expect(await db.auditLog.findUnique({ where: { id: audit.id } })).not.toBeNull();
  } finally {
    await db.outboxEvent.deleteMany({ where: { id: { in: [...ids, ...guards] } } });
    await db.idempotency.delete({ where: { id: replay.id } });
    // AuditLog is append-only, including in tests.
  }
});
