import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db } from '@niticket/database';
import { config } from '../infrastructure/config';
import { objectBytes, putObject, deleteObject } from '../infrastructure/storage';
import { detectFile, scanBytes } from '../infrastructure/scanner';
import { log } from '../infrastructure/log';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectAudio } from '../infrastructure/audio';
import { inspectVideo } from '../infrastructure/video';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { settings } from './settings';
import { transaction } from '../infrastructure/transaction';

export const eventPayload = z.object({
  ticketId: z.string(),
  actorId: z.string(),
  type: z.string(),
  messageId: z.string().optional(),
});

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
    await putObject(cleanKey, cleanBytes, detected.mime);
    await db.$transaction(async (tx) => {
      const changed = await tx.attachment.updateMany({
        where: { id: attachmentId, scanStatus: 'QUARANTINED' },
        data: {
          objectKey: cleanKey,
          detectedMime: detected.mime,
          checksum: detected.checksum,
          size: cleanBytes.length,
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
      await tx.outboxEvent.update({ where: { id: eventId }, data: { processedAt: new Date() } });
    });
    await deleteObject(attachment.objectKey);
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
      await db.$transaction([
        db.attachment.update({
          where: { id: attachmentId },
          data: { scanStatus: 'REJECTED', scanResult: message },
        }),
        ...(attachment.ticketId
          ? [
              db.ticket.update({
                where: { id: attachment.ticketId },
                data: { updatedAt: new Date() },
              }),
            ]
          : []),
        db.outboxEvent.update({ where: { id: eventId }, data: { processedAt: new Date() } }),
      ]);
      await deleteObject(attachment.objectKey);
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

export async function dispatchOutbox(queue: Queue, limit = 100) {
  z.number().int().min(1).max(100).parse(limit);
  const events = await db.outboxEvent.findMany({
    where: {
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

export function startJobs() {
  const connection = new Redis(config().REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue(config().QUEUE_NAME, { connection });
  const worker = new Worker(
    config().QUEUE_NAME,
    async (job) => {
      const event = await db.outboxEvent.findUniqueOrThrow({ where: { id: job.data.eventId } });
      if (event.processedAt) return;
      if (event.type === 'TICKET_NOTIFICATION') await processNotification(event.id, event.payload);
      else if (event.type === 'SCAN_ATTACHMENT') await processScan(event.id, event.payload);
      else throw new Error('Unknown event type');
    },
    { connection, concurrency: 4 },
  );
  worker.on('failed', (job, error) =>
    log.error(
      { operation: 'job', jobId: job?.id, category: error.message },
      'Background job failed',
    ),
  );
  let dispatching = false;
  let lastAuthCleanup = 0;
  const dispatch = async () => {
    if (dispatching) return;
    dispatching = true;
    try {
      await dispatchOutbox(queue);
      await writeFile(path.join(tmpdir(), 'niticket-worker-heartbeat'), String(Date.now()));
      if (Date.now() - lastAuthCleanup >= 60000) {
        await cleanupExpiredAuth();
        lastAuthCleanup = Date.now();
      }
      const expired = await db.attachment.findMany({
        where: { scanStatus: 'PENDING', expiresAt: { lt: new Date() } },
        take: 25,
      });
      for (const a of expired) {
        await deleteObject(a.objectKey);
        await db.attachment.update({
          where: { id: a.id },
          data: { scanStatus: 'REJECTED', scanResult: 'EXPIRED' },
        });
      }
    } catch (error) {
      log.error(
        { operation: 'outbox_dispatch', category: error instanceof Error ? error.name : 'unknown' },
        'Dispatch failed',
      );
    } finally {
      dispatching = false;
    }
  };
  const timer = setInterval(() => void dispatch(), 5000);
  void dispatch();
  return {
    queue,
    close: async () => {
      clearInterval(timer);
      while (dispatching) await new Promise((r) => setTimeout(r, 100));
      await worker.close();
      await queue.close();
      await connection.quit();
    },
  };
}
