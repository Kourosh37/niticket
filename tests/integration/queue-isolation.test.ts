import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { db } from '@niticket/database';
import { config } from '@niticket/core/infrastructure/config';
import { dispatchOutbox } from '@niticket/core/application/jobs';

afterAll(() => db.$disconnect());

it('dispatches light events independently while the media worker is occupied', async () => {
  const connection = new Redis(config().REDIS_URL, { maxRetriesPerRequest: null });
  const base = `${config().QUEUE_NAME}-isolation-${randomUUID()}`;
  const events = new Queue(base, { connection }),
    media = new Queue(`${base}-media`, { connection });
  const scan = await db.outboxEvent.create({
    data: { type: 'SCAN_ATTACHMENT', payload: {}, createdAt: new Date('1800-01-01') },
  });
  const notice = await db.outboxEvent.create({
    data: { type: 'TEST_LANE_NOTICE', payload: {}, createdAt: new Date('1800-01-01') },
  });
  let release!: () => void,
    started = false;
  const mediaWorker = new Worker(
    media.name,
    async () => {
      started = true;
      await new Promise<void>((done) => {
        release = done;
      });
    },
    { connection, concurrency: 1 },
  );
  const eventWorker = new Worker(
    events.name,
    async (job) => {
      await db.outboxEvent.update({
        where: { id: job.data.eventId },
        data: { processedAt: new Date() },
      });
    },
    { connection },
  );
  try {
    await dispatchOutbox(events, 1, media);
    await expect.poll(() => started).toBe(true);
    await expect
      .poll(
        async () =>
          !!(await db.outboxEvent.findUniqueOrThrow({ where: { id: notice.id } })).processedAt,
      )
      .toBe(true);
    expect((await media.getJob(scan.id))?.queueName).toBe(media.name);
    expect(await events.getJob(scan.id)).toBeUndefined();
    expect(
      (await db.outboxEvent.findUniqueOrThrow({ where: { id: scan.id } })).processedAt,
    ).toBeNull();
  } finally {
    release?.();
    await Promise.all([eventWorker.close(), mediaWorker.close()]);
    await db.outboxEvent.updateMany({
      where: { id: { in: [scan.id, notice.id] } },
      data: { processedAt: new Date() },
    });
    await Promise.all([events.obliterate({ force: true }), media.obliterate({ force: true })]);
    await Promise.all([events.close(), media.close()]);
    await connection.quit();
  }
});
