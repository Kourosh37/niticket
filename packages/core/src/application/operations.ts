import { Queue, type Job } from 'bullmq';
import Redis from 'ioredis';
import { db } from '@niticket/database';
import { assertAdmin, type Actor } from '../domain/authorization';
import { config } from '../infrastructure/config';
import { requireFresh } from './context';
import { uuid } from '../validation';
import { fail } from '../domain/errors';

async function withQueue<T>(fn: (queue: Queue) => Promise<T>) {
  const connection = new Redis(config().REDIS_URL, { maxRetriesPerRequest: 1 });
  const queue = new Queue(config().QUEUE_NAME, { connection });
  try {
    return await fn(queue);
  } finally {
    await queue.close();
    await connection.quit();
  }
}

export async function failedJobs(actor: Actor) {
  assertAdmin(actor);
  return withQueue(async (queue) => {
    const [counts, jobs] = await Promise.all([
      queue.getJobCounts('waiting', 'active', 'failed', 'completed'),
      queue.getJobs(['failed'], 0, 49),
    ]);
    return {
      counts,
      jobs: jobs.map((j) => ({
        id: j.id!,
        type: j.name,
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
  return withQueue(async (queue) => {
    const job = await queue.getJob(id);
    if (!job) fail();
    await db.auditLog.create({
      data: { actorId: actor.id, action: 'JOB_RETRY_REQUESTED', resourceId: id, metadata: {} },
    });
    return retryOutboxJob(job);
  });
}
