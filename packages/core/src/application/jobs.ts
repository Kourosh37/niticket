import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db } from '@niticket/database';
import { config } from '../infrastructure/config';
import {
  publishRealtimeEvent,
  enqueueRealtime,
  realtimeNamespace,
} from '../infrastructure/realtime';
import { attachmentChanged } from './realtime-events';
import { objectBytes, putObject } from '../infrastructure/storage';
import { detectFile, scanBytes } from '../infrastructure/scanner';
import { log } from '../infrastructure/log';
import { measure, processMetrics } from '../infrastructure/metrics';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectAudio } from '../infrastructure/audio';
import { inspectVideo } from '../infrastructure/video';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { settings } from './settings';
import { transaction } from '../infrastructure/transaction';
import { imageThumbnail } from '../infrastructure/thumbnail';
import { expireUploads, deleteExpiredUpload } from './upload-lifecycle';
import { purgeCompletedOutbox } from './retention';
import {
  reservePromotion,
  assertPromotion,
  completePromotion,
  collectOrphanedStorage,
  deleteUnreferencedObject,
} from './storage-reconciliation';

export const eventPayload = z.object({
  ticketId: z.string(),
  actorId: z.string(),
  type: z.string(),
  messageId: z.string().optional(),
});

const mediaEventTypes = ['SCAN_ATTACHMENT', 'DELETE_PENDING_OBJECT', 'DELETE_UNREFERENCED_OBJECT'];

const titles: Record<string, string> = {
  TICKET_CREATED: 'درخواست جدید ثبت شد',
  PUBLIC_REPLY: 'پاسخ جدیدی برای درخواست ثبت شد',
  STATUS_CHANGED: 'وضعیت درخواست تغییر کرد',
  ASSIGNED: 'کارشناس درخواست تغییر کرد',
  TRANSFERRED: 'درخواست به واحد دیگری ارجاع شد',
};

export async function processNotification(eventId: string, payload: unknown) {
  const data = eventPayload.parse(payload);
  await transaction(async (tx) => {
    const event = await tx.outboxEvent.findUniqueOrThrow({ where: { id: eventId } });
    if (event.processedAt) return;
    const ticket = await tx.ticket.findUniqueOrThrow({
      where: { id: data.ticketId },
      include: {
        department: {
          include: {
            memberships: { where: { active: true, user: { active: true, role: 'STAFF' } } },
          },
        },
      },
    });
    const message = ['TICKET_CREATED', 'PUBLIC_REPLY'].includes(data.type)
      ? await tx.message.findFirst({
          where: {
            ticketId: ticket.id,
            senderId: data.actorId,
            visibility: 'PUBLIC',
            ...(data.messageId ? { id: data.messageId } : { createdAt: { lte: event.createdAt } }),
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true, readAt: true },
        })
      : null;
    const recipients = new Set([
      ticket.creatorId,
      ...ticket.department.memberships.map((m) => m.userId),
    ]);
    recipients.delete(data.actorId);
    for (const userId of recipients) {
      const receiver = await tx.user.findUnique({
        where: { id: userId },
        select: { active: true, isAdmin: true, role: true },
      });
      if (!receiver?.active || receiver.isAdmin || receiver.role === 'ADMIN') continue;
      // An older event may reach the queue after this officer has already replied.
      const handled =
        receiver.role === 'STAFF'
          ? await tx.message.findFirst({
              where: {
                ticketId: ticket.id,
                senderId: userId,
                visibility: 'PUBLIC',
                createdAt: { gt: event.createdAt },
              },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              select: { createdAt: true },
            })
          : null;
      await tx.notification.upsert({
        where: { eventId_userId: { eventId, userId } },
        create: {
          eventId,
          userId,
          ticketId: ticket.id,
          messageId: message?.id,
          title: titles[data.type] ?? 'درخواست شما به‌روزرسانی شد',
          readAt: handled?.createdAt ?? (userId === ticket.creatorId ? message?.readAt : null),
        },
        update: {},
      });
      await enqueueRealtime(tx, { scope: 'user', userId, topics: ['notifications'] });
    }
    await tx.outboxEvent.update({ where: { id: eventId }, data: { processedAt: new Date() } });
  });
}

export async function processScan(eventId: string, payload: unknown) {
  const { attachmentId } = z.object({ attachmentId: z.string() }).parse(payload);
  const attachment = await db.attachment.findUniqueOrThrow({ where: { id: attachmentId } });
  if (attachment.scanStatus !== 'QUARANTINED') {
    await db.outboxEvent.update({ where: { id: eventId }, data: { processedAt: new Date() } });
    return;
  }
  const policy = await settings();
  try {
    // The intent already passed the upload policy. Later policy edits apply to new intents.
    const bytes = await objectBytes(
      attachment.objectKey,
      Math.min(attachment.expectedSize, attachment.avatarOwnerId ? 2097152 : 52428800),
    );
    if (bytes.length !== attachment.expectedSize) throw new Error('File size mismatch');
    const detected = await detectFile(bytes, attachment.declaredMime);
    await scanBytes(bytes);
    const audio = detected.mime.startsWith('audio/')
      ? await inspectAudio(bytes, policy.maxVoiceSeconds)
      : null;
    const video = detected.mime.startsWith('video/') ? await inspectVideo(bytes) : null;
    let cleanBytes = bytes;
    if (attachment.avatarOwnerId) {
      if (!detected.mime.startsWith('image/')) throw new Error('Avatar invalid');
      try {
        cleanBytes = await sharp(bytes, { limitInputPixels: 10000000 })
          .rotate()
          .resize(512, 512, { fit: 'cover', withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer();
        detected.mime = 'image/webp';
        detected.checksum = createHash('sha256').update(cleanBytes).digest('hex');
      } catch {
        throw new Error('Avatar invalid');
      }
    }
    // Promote the exact scanned bytes to a new key: a replayed presigned PUT cannot replace approved content.
    const cleanKey = `clean/${randomUUID()}`;
    let thumbnail: Buffer | undefined;
    if (detected.mime.startsWith('image/') && !attachment.avatarOwnerId) {
      try {
        thumbnail = await imageThumbnail(cleanBytes);
      } catch {
        log.warn(
          { operation: 'thumbnail', category: 'DECODE_UNAVAILABLE' },
          'Using the approved original image',
        );
      }
    }
    const thumbnailKey = thumbnail ? `${cleanKey}.thumbnail.webp` : null;
    const promotion = [cleanKey, ...(thumbnailKey ? [thumbnailKey] : [])];
    await reservePromotion(promotion);
    await putObject(cleanKey, cleanBytes, detected.mime);
    if (thumbnailKey && thumbnail) await putObject(thumbnailKey, thumbnail, 'image/webp');
    await transaction(async (tx) => {
      await assertPromotion(tx, promotion);
      const changed = await tx.attachment.updateMany({
        where: { id: attachmentId, scanStatus: 'QUARANTINED' },
        data: {
          objectKey: cleanKey,
          detectedMime: detected.mime,
          checksum: detected.checksum,
          size: cleanBytes.length,
          thumbnailKey,
          thumbnailSize: thumbnail?.length ?? null,
          ...(audio ? { durationSeconds: audio.durationSeconds, waveform: audio.waveform } : {}),
          ...(video ? { durationSeconds: video.durationSeconds } : {}),
          scanStatus: 'CLEAN',
          scanResult: 'CLEAN',
        },
      });
      if (changed.count && attachment.avatarOwnerId) {
        const user = await tx.user.findUniqueOrThrow({
          where: { id: attachment.avatarOwnerId },
          include: { avatarAttachment: true },
        });
        if (!user.avatarAttachment || user.avatarAttachment.createdAt <= attachment.createdAt)
          await tx.user.update({
            where: { id: user.id },
            data: {
              avatarAttachmentId: attachment.id,
              image: `/api/v1/avatars/${user.id}?v=${attachment.id}`,
            },
          });
        await tx.auditLog.create({
          data: {
            actorId: attachment.uploaderId,
            action: 'AVATAR_CHANGED',
            resourceId: user.id,
            metadata: {},
          },
        });
      }
      if (changed.count && attachment.ticketId) {
        await tx.ticket.update({
          where: { id: attachment.ticketId },
          data: { updatedAt: new Date() },
        });
        await tx.activity.create({
          data: {
            ticketId: attachment.ticketId,
            actorId: attachment.uploaderId,
            type: 'ATTACHMENT_READY',
            visibility: 'INTERNAL',
            metadata: { attachmentId },
          },
        });
      }
      if (changed.count) await attachmentChanged(tx, attachment);
      if (changed.count) await completePromotion(tx, promotion);
      await tx.outboxEvent.create({
        data: { type: 'DELETE_PENDING_OBJECT', payload: { key: attachment.objectKey } },
      });
      await tx.outboxEvent.update({ where: { id: eventId }, data: { processedAt: new Date() } });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (
      [
        'MALWARE_FOUND',
        'File signature mismatch',
        'File size mismatch',
        'Invalid object size',
        'Object too large',
        'Audio duration or stream invalid',
        'Audio duration invalid',
        'Avatar invalid',
        'Video stream invalid',
      ].includes(message)
    ) {
      await transaction(async (tx) => {
        await tx.attachment.update({
          where: { id: attachmentId },
          data: { scanStatus: 'REJECTED', scanResult: message },
        });
        if (attachment.ticketId)
          await tx.ticket.update({
            where: { id: attachment.ticketId },
            data: { updatedAt: new Date() },
          });
        await attachmentChanged(tx, attachment);
        await tx.outboxEvent.create({
          data: { type: 'DELETE_PENDING_OBJECT', payload: { key: attachment.objectKey } },
        });
        await tx.outboxEvent.update({ where: { id: eventId }, data: { processedAt: new Date() } });
      });
      return;
    }
    throw error; // Scanner/decoder outages never approve content.
  }
}

export async function cleanupExpiredAuth() {
  const now = new Date();
  const [sessions, verifications] = await Promise.all([
    db.session.findMany({ where: { expiresAt: { lt: now } }, select: { id: true }, take: 200 }),
    db.verification.findMany({
      where: { expiresAt: { lt: now } },
      select: { id: true },
      take: 200,
    }),
  ]);
  if (sessions.length)
    await db.session.deleteMany({
      where: { id: { in: sessions.map((s) => s.id) }, expiresAt: { lt: now } },
    });
  if (verifications.length)
    await db.verification.deleteMany({
      where: { id: { in: verifications.map((v) => v.id) }, expiresAt: { lt: now } },
    });
}

export async function dispatchOutbox(queue: Queue, limit = 100, mediaQueue?: Queue) {
  z.number().int().min(1).max(100).parse(limit);
  if (mediaQueue) {
    await Promise.all([
      dispatchLane(queue, limit, { notIn: mediaEventTypes }),
      dispatchLane(mediaQueue, limit, { in: mediaEventTypes }),
    ]);
  } else await dispatchLane(queue, limit);
}

async function dispatchLane(
  queue: Queue,
  limit: number,
  type?: { in: string[] } | { notIn: string[] },
) {
  const events = await db.outboxEvent.findMany({
    where: {
      ...(type ? { type } : {}),
      processedAt: null,
      failedAt: null,
      OR: [{ dispatchedAt: null }, { dispatchedAt: { lt: new Date(Date.now() - 60000) } }],
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit,
  });
  for (const event of events) {
    const existing = await queue.getJob(event.id);
    if (existing && (await existing.getState()) === 'failed') {
      // A terminal job needs explicit retry; repeatedly adding its ID cannot restart it.
      await db.outboxEvent.updateMany({
        where: { id: event.id, processedAt: null, dispatchedAt: event.dispatchedAt },
        data: { failedAt: new Date(existing.finishedOn ?? Date.now()) },
      });
      continue;
    }
    await queue.add(
      event.type,
      { eventId: event.id },
      {
        jobId: event.id,
        attempts: 8,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 86400 },
        removeOnFail: false,
      },
    );
    await db.outboxEvent.update({ where: { id: event.id }, data: { dispatchedAt: new Date() } });
  }
}

export function startJobs(role = config().WORKER_ROLE) {
  const connection = new Redis(config().REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue(config().QUEUE_NAME, { connection });
  const mediaQueue = new Queue(`${config().QUEUE_NAME}-media`, { connection });
  const workers: Worker[] = [];
  const process = async (job: { data: { eventId: string }; queueName: string }) => {
    const event = await db.outboxEvent.findUniqueOrThrow({ where: { id: job.data.eventId } });
    if (event.processedAt) return;
    if (job.queueName === queue.name && mediaEventTypes.includes(event.type)) {
      // Drain pre-upgrade scan jobs from the original queue into the isolated media lane.
      await mediaQueue.add(
        event.type,
        { eventId: event.id },
        {
          jobId: event.id,
          attempts: 8,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { age: 86400 },
          removeOnFail: false,
        },
      );
      return;
    }
    if (event.type === 'TICKET_NOTIFICATION') await processNotification(event.id, event.payload);
    else if (event.type === 'SCAN_ATTACHMENT') await processScan(event.id, event.payload);
    else if (event.type === 'DELETE_PENDING_OBJECT')
      await deleteExpiredUpload(event.id, event.payload);
    else if (event.type === 'DELETE_UNREFERENCED_OBJECT')
      await deleteUnreferencedObject(event.id, event.payload);
    else if (event.type === 'REALTIME_INVALIDATION')
      await publishRealtimeEvent(event.id, event.payload);
    else throw new Error('Unknown event type');
  };
  if (role !== 'media')
    workers.push(new Worker(config().QUEUE_NAME, process, { connection, concurrency: 4 }));
  if (role !== 'events')
    workers.push(
      new Worker(mediaQueue.name, process, { connection, concurrency: config().MEDIA_CONCURRENCY }),
    );
  for (const worker of workers) {
    worker.on('error', (error) =>
      log.error({ operation: 'worker', category: error.name }, 'Worker connection failed'),
    );
    worker.on('completed', (job) =>
      measure(
        job.queueName === mediaQueue.name ? 'job.media' : 'job.events',
        Math.max(0, (job.finishedOn ?? Date.now()) - (job.processedOn ?? Date.now())),
      ),
    );
    worker.on('failed', (job, error) => {
      measure(
        worker.name === mediaQueue.name ? 'job.media' : 'job.events',
        Math.max(0, Date.now() - (job?.processedOn ?? Date.now())),
        true,
      );
      log.error(
        { operation: 'job', jobId: job?.id, category: error.message },
        'Background job failed',
      );
    });
  }
  let dispatching = false,
    dispatchAgain = false,
    closing = false;
  let lastAuthCleanup = 0,
    lastTelemetry = 0;
  const dispatch = async () => {
    if (closing) return;
    if (dispatching) {
      dispatchAgain = true;
      return;
    }
    dispatching = true;
    try {
      if (role !== 'media') await dispatchOutbox(queue, 100, mediaQueue);
      else await connection.ping();
      if (!workers.every((worker) => worker.isRunning())) throw new Error('Worker is not running');
      await writeFile(path.join(tmpdir(), 'niticket-worker-heartbeat'), String(Date.now()));
      if (Date.now() - lastTelemetry >= 60000) {
        log.info({ metrics: processMetrics(), role }, 'Worker metrics');
        lastTelemetry = Date.now();
      }
      if (role !== 'media' && Date.now() - lastAuthCleanup >= 60000) {
        await cleanupExpiredAuth();
        await collectOrphanedStorage();
        await purgeCompletedOutbox();
        lastAuthCleanup = Date.now();
      }
      if (role !== 'media') await expireUploads();
    } catch (error) {
      log.error(
        { operation: 'outbox_dispatch', category: error instanceof Error ? error.name : 'unknown' },
        'Dispatch failed',
      );
    } finally {
      dispatching = false;
      if (dispatchAgain && !closing) {
        dispatchAgain = false;
        void dispatch();
      }
    }
  };
  const timer = setInterval(() => void dispatch(), 5000);
  // Post-commit wakeups avoid adding the dispatch interval to normal message
  // and attachment latency. The interval remains a durable recovery sweep.
  const wake = new Redis(config().REDIS_URL, { maxRetriesPerRequest: 1 });
  wake.on('error', () => {});
  wake.on('message', () => void dispatch());
  void wake.subscribe(`${realtimeNamespace()}:work`).catch(() => {});
  void dispatch();
  return {
    queue,
    mediaQueue,
    close: async () => {
      closing = true;
      clearInterval(timer);
      wake.disconnect();
      while (dispatching) await new Promise((r) => setTimeout(r, 100));
      await Promise.all(workers.map((worker) => worker.close()));
      await Promise.all([queue.close(), mediaQueue.close()]);
      await connection.quit();
    },
  };
}
