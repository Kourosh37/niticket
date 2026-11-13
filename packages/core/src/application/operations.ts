import { Queue, type Job } from 'bullmq';
import Redis from 'ioredis';
import { db } from '@niticket/database';
import { assertAdmin, type Actor } from '../domain/authorization';
import { config } from '../infrastructure/config';
import { requireFresh } from './context';
import { uuid } from '../validation';
import { fail } from '../domain/errors';
import { processMetrics } from '../infrastructure/metrics';
import { readCacheState } from '../infrastructure/read-cache';
import { operationalAlerts } from '../domain/operational-alerts';

export async function operationalMetrics(actor: Actor) {
  assertAdmin(actor);
  const now = Date.now();
  const [queues, pendingOutbox, failedOutbox, oldest, overdueStorage] = await Promise.all([
    withQueue(async (events, media) => ({
      events: await events.getJobCounts('waiting', 'active', 'delayed', 'failed'),
      media: await media.getJobCounts('waiting', 'active', 'delayed', 'failed'),
    })),
    db.outboxEvent.count({ where: { processedAt: null, failedAt: null } }),
    db.outboxEvent.count({ where: { processedAt: null, failedAt: { not: null } } }),
    db.outboxEvent.findFirst({
      where: { processedAt: null, failedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
    db.storageCandidate.count({ where: { collectAfter: { lt: new Date(now - 5 * 60000) } } }),
  ]);
  const oldestPendingMs = oldest ? Math.max(0, now - oldest.createdAt.getTime()) : 0;
  return {
    sampledAt: new Date(now).toISOString(),
    process: processMetrics(),
    cache: readCacheState(),
    queues,
    outbox: { pending: pendingOutbox, failed: failedOutbox, oldestPendingMs },
    storage: { overdue: overdueStorage },
    alerts: operationalAlerts({
      failedOutbox,
      oldestPendingMs,
      overdueStorage,
      failedJobs: (queues.events.failed ?? 0) + (queues.media.failed ?? 0),
    }),
  };
}

async function withQueue<T>(fn: (queue: Queue, mediaQueue: Queue) => Promise<T>) {
  const connection = new Redis(config().REDIS_URL, { maxRetriesPerRequest: 1 });
  const queue = new Queue(config().QUEUE_NAME, { connection });
  const mediaQueue = new Queue(`${config().QUEUE_NAME}-media`, { connection });
  try {
    return await fn(queue, mediaQueue);
  } finally {
    await Promise.all([queue.close(), mediaQueue.close()]);
    await connection.quit();
  }
}

export async function failedJobs(actor: Actor) {
  assertAdmin(actor);
  return withQueue(async (queue, mediaQueue) => {
    const [eventCounts, mediaCounts, eventJobs, mediaJobs] = await Promise.all([
      queue.getJobCounts('waiting', 'active', 'failed', 'completed'),
      mediaQueue.getJobCounts('waiting', 'active', 'failed', 'completed'),
      queue.getJobs(['failed'], 0, 49),
      mediaQueue.getJobs(['failed'], 0, 49),
    ]);
    const counts = Object.fromEntries(
      Object.keys(eventCounts).map((key) => [key, eventCounts[key] + (mediaCounts[key] ?? 0)]),
    );
    const jobs = [...eventJobs, ...mediaJobs]
      .sort((a, b) => (b.finishedOn ?? b.timestamp) - (a.finishedOn ?? a.timestamp))
      .slice(0, 50);
    return {
      counts,
      jobs: jobs.map((j) => ({
        id: j.id!,
        type: j.name,
        queue: j.queueName === mediaQueue.name ? 'media' : 'events',
        attempts: j.attemptsMade,
        failedAt: j.finishedOn ?? j.timestamp,
      })),
      pendingOutbox: await db.outboxEvent.count({ where: { processedAt: null, failedAt: null } }),
      failedOutbox: await db.outboxEvent.count({
        where: { processedAt: null, failedAt: { not: null } },
      }),
    };
  });
}

export async function retryOutboxJob(job: Job) {
  await job.retry('failed', { resetAttemptsMade: true });
  await db.outboxEvent.update({
    where: { id: job.id! },
    data: { failedAt: null, dispatchedAt: new Date() },
  });
  return { ok: true };
}

export async function retryJob(actor: Actor, id: string) {
  assertAdmin(actor);
  await requireFresh(actor);
  uuid.parse(id);
  return withQueue(async (queue, mediaQueue) => {
    const job = (await mediaQueue.getJob(id)) ?? (await queue.getJob(id));
    if (!job) fail();
    await db.auditLog.create({
      data: { actorId: actor.id, action: 'JOB_RETRY_REQUESTED', resourceId: id, metadata: {} },
    });
    return retryOutboxJob(job);
  });
}
