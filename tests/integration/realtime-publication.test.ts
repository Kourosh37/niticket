import { afterAll, expect, it, vi } from 'vitest';
import { db } from '@niticket/database';
import { transaction } from '@niticket/core/infrastructure/transaction';
import {
  enqueueRealtime,
  publishRealtimeEvent,
  realtimeNamespace,
  subscribeRealtime,
  drainRealtime,
} from '@niticket/core/infrastructure/realtime';
import { redis } from '@niticket/core/infrastructure/redis';
import { fixtures } from '../helpers/fixtures';
import type { RealtimeEnvelope } from '@niticket/core/domain/realtime';

afterAll(async () => {
  await drainRealtime();
  await db.$disconnect();
  redis().disconnect();
});

it('retains a failed fast publication for durable retry and drains background work before shutdown', async () => {
  const f = await fixtures();
  await drainRealtime();
  const failure = vi.spyOn(redis(), 'publish').mockRejectedValueOnce(new Error('Simulated outage'));
  let id: string;
  const payload = { scope: 'user', userId: f.student.id, topics: ['inbox'] } as const;
  try {
    id = await transaction((tx) => enqueueRealtime(tx, { ...payload, topics: ['inbox'] }));
    await drainRealtime();
    expect((await db.outboxEvent.findUniqueOrThrow({ where: { id } })).processedAt).toBeNull();
  } finally {
    failure.mockRestore();
  }
  await publishRealtimeEvent(id!, payload);
  expect(
    (await db.outboxEvent.findUniqueOrThrow({ where: { id: id! } })).processedAt,
  ).not.toBeNull();
});

it('publishes committed invalidations immediately across Redis and durably records their delivery', async () => {
  const f = await fixtures();
  const received: RealtimeEnvelope[] = [];
  const stop = await subscribeRealtime({
    change: (event) => received.push(event),
    disconnect: () => {},
  });
  try {
    const id = await transaction(async (tx) =>
      enqueueRealtime(tx, { scope: 'user', userId: f.student.id, topics: ['notifications'] }),
    );
    await expect.poll(() => received.some((event) => event.id === id)).toBe(true);
    await expect
      .poll(async () => !!(await db.outboxEvent.findUniqueOrThrow({ where: { id } })).processedAt)
      .toBe(true);
    expect(received.find((event) => event.id === id)?.change).toEqual({
      scope: 'user',
      userId: f.student.id,
      topics: ['notifications'],
    });
    expect(realtimeNamespace()).toContain('_test');
    expect(JSON.stringify(received)).not.toMatch(/body|cookie|token/);
  } finally {
    stop();
  }
});

it('does not publish rolled-back mutations and can retry a persisted delivery without changing application data', async () => {
  const f = await fixtures();
  let rolledBack = '';
  await expect(
    transaction(async (tx) => {
      rolledBack = await enqueueRealtime(tx, {
        scope: 'user',
        userId: f.student.id,
        topics: ['inbox'],
      });
      throw new Error('rollback');
    }),
  ).rejects.toThrow('rollback');
  expect(await db.outboxEvent.findUnique({ where: { id: rolledBack } })).toBeNull();
  const payload = { scope: 'user', userId: f.student.id, topics: ['inbox'] };
  const event = await db.outboxEvent.create({ data: { type: 'REALTIME_INVALIDATION', payload } });
  await publishRealtimeEvent(event.id, payload);
  await publishRealtimeEvent(event.id, payload);
  expect(
    (await db.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).processedAt,
  ).not.toBeNull();
  expect(await db.outboxEvent.count({ where: { id: event.id } })).toBe(1);
});
