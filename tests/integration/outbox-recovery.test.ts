import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { db } from '@niticket/database';
import { dispatchOutbox } from '@niticket/core/application/jobs';
import { retryOutboxJob } from '@niticket/core/application/operations';
import { config } from '@niticket/core/infrastructure/config';

afterAll(() => db.$disconnect());

it('quarantines terminal jobs without starving new events and supports an explicit fresh retry', async () => {
  const connection = new Redis(config().REDIS_URL, { maxRetriesPerRequest: null });
  const queueName = `${config().QUEUE_NAME}-recovery-${randomUUID()}`;
  const queue = new Queue(queueName, { connection });
  const failedId = randomUUID();
  const failed = await db.outboxEvent.create({
    data: {
      id: failedId,
      type: 'TEST_RECOVERY',
      payload: {},
      createdAt: new Date('1900-01-01'),
      dispatchedAt: new Date('1900-01-01'),
    },
  });
  const next = await db.outboxEvent.create({
    data: {
      type: 'TEST_RECOVERY',
      payload: {},
      createdAt: new Date('1900-01-02'),
    },
  });
  let recovered = false;
  const worker = new Worker(
    queueName,
    async (job) => {
      if (job.id === failed.id && !recovered) throw new Error('Temporary outage');
      if (job.id === failed.id || job.id === next.id)
        await db.outboxEvent.update({ where: { id: job.id }, data: { processedAt: new Date() } });
    },
    { connection },
  );
  worker.on('error', () => {});
  try {
    await queue.add(
      failed.type,
      { eventId: failed.id },
      { jobId: failed.id, attempts: 1, removeOnFail: false },
    );
    await expect.poll(async () => (await queue.getJob(failed.id))?.getState()).toBe('failed');
    await dispatchOutbox(queue, 2);
    expect(
      (await db.outboxEvent.findUniqueOrThrow({ where: { id: failed.id } })).failedAt,
    ).not.toBeNull();
    await expect
      .poll(
        async () =>
          !!(await db.outboxEvent.findUniqueOrThrow({ where: { id: next.id } })).processedAt,
      )
      .toBe(true);
    recovered = true;
    await retryOutboxJob((await queue.getJob(failed.id))!);
    await expect
      .poll(
        async () =>
          !!(await db.outboxEvent.findUniqueOrThrow({ where: { id: failed.id } })).processedAt,
      )
      .toBe(true);
    expect(
      (await db.outboxEvent.findUniqueOrThrow({ where: { id: failed.id } })).failedAt,
    ).toBeNull();
  } finally {
    await worker.close();
    await (await queue.getJob(failed.id))?.remove();
    await (await queue.getJob(next.id))?.remove();
    await queue.close();
    await connection.quit();
  }
});
