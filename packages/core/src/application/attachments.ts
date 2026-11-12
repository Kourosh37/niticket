import { randomUUID, createHash } from 'node:crypto';
import { db, type Prisma } from '@niticket/database';
import type { Attachment } from '@prisma/client';
import {
  assertRead,
  assertStaff,
  assertParticipant,
  canReadInternal,
  userRole,
  type Actor,
} from '../domain/authorization';
import { fail } from '../domain/errors';
import { uploadSchema, uuid } from '../validation';
import { settings } from './settings';
import { signedUpload, headObject, objectBytes } from '../infrastructure/storage';
import { transaction } from '../infrastructure/transaction';
import { refreshActor } from './context';
import { z } from 'zod';
import { AppError } from '../domain/errors';
import { requireSavedReply } from './saved-replies';
import { byteRange } from '../domain/byte-range';
import { attachmentChanged } from './realtime-events';
import { acceptsRange, matchesETag } from '../domain/http-cache';

async function findUploadRetry(
  tx: Prisma.TransactionClient,
  actor: Actor,
  clientId: string | undefined,
  data: unknown,
) {
  if (!clientId) return null;
  const saved = await tx.idempotency.findUnique({
    where: { actorId_key: { actorId: actor.id, key: `upload:${clientId}` } },
  });
  if (!saved) return null;
  if (saved.fingerprint !== createHash('sha256').update(JSON.stringify(data)).digest('hex'))
    fail('IDEMPOTENCY_CONFLICT', 409, 'کلید تکراری برای فایل متفاوت استفاده شده است.');
  return tx.attachment.findUniqueOrThrow({ where: { id: saved.resourceId } });
}

async function rememberUpload(
  tx: Prisma.TransactionClient,
  actor: Actor,
  clientId: string | undefined,
  data: unknown,
  id: string,
) {
  if (clientId)
    await tx.idempotency.create({
      data: {
        actorId: actor.id,
        key: `upload:${clientId}`,
        resourceId: id,
        fingerprint: createHash('sha256').update(JSON.stringify(data)).digest('hex'),
      },
    });
}

async function uploadIntent(attachment: Attachment) {
  if (attachment.scanStatus !== 'PENDING')
    return { id: attachment.id, scanStatus: attachment.scanStatus, url: null, expiresIn: 0 };
  if (attachment.expiresAt <= new Date())
    fail('UPLOAD_EXPIRED', 409, 'مهلت بارگذاری تمام شده است.');
  return {
    id: attachment.id,
    scanStatus: attachment.scanStatus,
    url: await signedUpload(attachment.objectKey, attachment.declaredMime, attachment.expectedSize),
    expiresIn: 180,
  };
}

async function authorize(
  actor: Actor,
  a: Pick<Attachment, 'ticketId' | 'messageId' | 'noteId' | 'avatarOwnerId'> & {
    savedReplyId?: string | null;
    archivedAt?: Date | null;
  },
  write = false,
) {
  if (a.savedReplyId) {
    if (a.archivedAt) fail();
    await requireSavedReply(db, actor, a.savedReplyId);
    return null;
  }
  if (a.avatarOwnerId) {
    const user = await db.user.findUnique({
      where: { id: a.avatarOwnerId },
      select: { active: true, role: true },
    });
    if (!user?.active || user.role !== 'STAFF') fail();
    if (write && !(actor.isAdmin || (actor.id === a.avatarOwnerId && userRole(actor) === 'STAFF')))
      fail('FORBIDDEN', 403, 'اجازه تغییر تصویر این حساب را ندارید.');
    return null;
  }
  if (!a.ticketId) fail();
  const ticket = await db.ticket.findUnique({ where: { id: a.ticketId } });
  if (!ticket) fail();
  if (write) assertParticipant(actor, ticket);
  else assertRead(actor, ticket);
  if (a.messageId) {
    const message = await db.message.findUnique({ where: { id: a.messageId } });
    if (
      !message ||
      message.ticketId !== ticket.id ||
      (message.visibility === 'INTERNAL' && !canReadInternal(actor, ticket)) ||
      (write && message.senderId !== actor.id)
    )
      fail();
  }
  if (a.noteId) {
    const note = await db.activityNote.findUnique({
      where: { id: a.noteId },
      include: { activity: true },
    });
    if (
      !note ||
      note.activity.ticketId !== ticket.id ||
      !canReadInternal(actor, ticket) ||
      (write && note.authorId !== actor.id)
    )
      fail();
  }
  return ticket;
}

export async function createUpload(actor: Actor, input: unknown) {
  const { clientId, ...data } = uploadSchema.extend({ clientId: uuid.optional() }).parse(input);
  if (data.messageId && data.noteId)
    fail('VALIDATION', 400, 'پیوست فقط به یک پیام یا یادداشت متصل می‌شود.');
  const limit = (await settings()).maxUploadBytes;
  const context = {
    ticketId: data.ticketId,
    messageId: data.messageId ?? null,
    noteId: data.noteId ?? null,
    avatarOwnerId: null,
  };
  const ticket = await authorize(actor, context, true);
  if (!ticket) fail();
  if (data.noteId) assertStaff(actor, ticket);
  const id = randomUUID(),
    objectKey = `pending/${randomUUID()}`;
  const attachment = await transaction(async (tx) => {
    actor = await refreshActor(tx, actor);
    const current = await tx.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    assertParticipant(actor, current);
    if (data.noteId) assertStaff(actor, current);
    const retry = await findUploadRetry(tx, actor, clientId, data);
    if (retry) return retry;
    if (data.size > limit) fail('VALIDATION', 400, 'حجم فایل بیش از حد مجاز است.');
    if (
      (await tx.attachment.count({
        where: {
          ticketId: ticket.id,
          uploaderId: actor.id,
          scanStatus: { in: ['PENDING', 'QUARANTINED'] },
        },
      })) >= 100
    )
      fail('VALIDATION', 400, 'تعداد پیوست‌ها به حد مجاز رسیده است.');
    const created = await tx.attachment.create({
      data: {
        id,
        ...context,
        uploaderId: actor.id,
        filename: data.filename,
        objectKey,
        declaredMime: data.mime,
        expectedSize: data.size,
        expiresAt: new Date(Date.now() + 600000),
      },
    });
    await rememberUpload(tx, actor, clientId, data, created.id);
    return created;
  });
  return uploadIntent(attachment);
}

export async function createAvatarUpload(actor: Actor, input: unknown) {
  const { clientId, ...data } = uploadSchema
    .omit({ ticketId: true, messageId: true, noteId: true })
    .extend({ userId: uuid.optional(), clientId: uuid.optional() })
    .strict()
    .parse(input);
  const userId = data.userId ?? actor.id;
  if (data.size > 2097152 || !['image/png', 'image/jpeg', 'image/webp'].includes(data.mime))
    fail('VALIDATION', 400, 'تصویر باید پی‌ان‌جی، جی‌پی‌جی یا وب‌پی و حداکثر ۲ مگابایت باشد.');
  const context = { ticketId: null, messageId: null, noteId: null, avatarOwnerId: userId };
  await authorize(actor, context, true);
  const id = randomUUID(),
    objectKey = `pending/${randomUUID()}`;
  const attachment = await transaction(async (tx) => {
    actor = await refreshActor(tx, actor);
    if (!actor.isAdmin && actor.id !== userId) fail();
    const retry = await findUploadRetry(tx, actor, clientId, data);
    if (retry) return retry;
    if (
      (await tx.attachment.count({
        where: { avatarOwnerId: userId, scanStatus: { in: ['PENDING', 'QUARANTINED'] } },
      })) >= 5
    )
      fail('VALIDATION', 400, 'لطفاً تا پایان بررسی تصویر قبلی صبر کنید.');
    const created = await tx.attachment.create({
      data: {
        id,
        ...context,
        uploaderId: actor.id,
        filename: data.filename,
        objectKey,
        declaredMime: data.mime,
        expectedSize: data.size,
        expiresAt: new Date(Date.now() + 600000),
      },
    });
    await rememberUpload(tx, actor, clientId, data, created.id);
    return created;
  });
  return uploadIntent(attachment);
}

export async function createSavedReplyUpload(actor: Actor, savedReplyId: string, input: unknown) {
  const { clientId, ...file } = uploadSchema
    .omit({ ticketId: true, messageId: true, noteId: true })
    .extend({ clientId: uuid.optional() })
    .strict()
    .parse(input);
  const data = { ...file, savedReplyId: uuid.parse(savedReplyId) };
  const limit = (await settings()).maxUploadBytes;
  const attachment = await transaction(async (tx) => {
    actor = await refreshActor(tx, actor);
    await requireSavedReply(tx, actor, savedReplyId);
    const retry = await findUploadRetry(tx, actor, clientId, data);
    if (retry) {
      if (retry.archivedAt) fail();
      return retry;
    }
    if (file.size > limit) fail('VALIDATION', 400, 'حجم فایل بیش از حد مجاز است.');
    if ((await tx.attachment.count({ where: { savedReplyId, archivedAt: null } })) >= 5)
      fail('VALIDATION', 400, 'هر پیام آماده حداکثر ۵ پیوست دارد.');
    const created = await tx.attachment.create({
      data: {
        savedReplyId,
        uploaderId: actor.id,
        filename: file.filename,
        objectKey: `pending/${randomUUID()}`,
        declaredMime: file.mime,
        expectedSize: file.size,
        expiresAt: new Date(Date.now() + 600000),
      },
    });
    await rememberUpload(tx, actor, clientId, data, created.id);
    await tx.savedReply.update({
      where: { id: savedReplyId },
      data: { version: { increment: 1 } },
    });
    return created;
  });
  return uploadIntent(attachment);
}

export async function completeUpload(actor: Actor, id: string) {
  uuid.parse(id);
  const a = await db.attachment.findUnique({ where: { id } });
  if (!a || a.uploaderId !== actor.id) fail();
  await authorize(actor, a, true);
  if (a.scanStatus !== 'PENDING') return { id, scanStatus: a.scanStatus };
  if (a.expiresAt < new Date()) fail('VALIDATION', 400, 'مهلت بارگذاری تمام شده است.');
  // Honor the size approved when this intent was created, with an absolute safety cap.
  const limit = a.avatarOwnerId ? 2097152 : 52428800;
  const head = await headObject(a.objectKey);
  if (head.ContentLength !== a.expectedSize || head.ContentLength > limit)
    fail('VALIDATION', 400, 'حجم فایل بارگذاری‌شده معتبر نیست.');
  await transaction(async (tx) => {
    actor = await refreshActor(tx, actor);
    if (a.ticketId) {
      const t = await tx.ticket.findUniqueOrThrow({ where: { id: a.ticketId } });
      assertParticipant(actor, t);
    } else if (a.savedReplyId) await requireSavedReply(tx, actor, a.savedReplyId);
    else if (!actor.isAdmin && actor.id !== a.avatarOwnerId) fail();
    const changed = await tx.attachment.updateMany({
      where: { id, scanStatus: 'PENDING' },
      data: { scanStatus: 'QUARANTINED' },
    });
    if (changed.count && a.ticketId)
      await tx.ticket.update({ where: { id: a.ticketId }, data: { updatedAt: new Date() } });
    if (changed.count)
      await tx.outboxEvent.create({
        data: { type: 'SCAN_ATTACHMENT', payload: { attachmentId: id } },
      });
    if (changed.count) await attachmentChanged(tx, a);
  });
  return { id, scanStatus: 'QUARANTINED' };
}

export async function uploadStatus(actor: Actor, id: string) {
  uuid.parse(id);
  const a = await db.attachment.findUnique({ where: { id } });
  if (!a) fail();
  await authorize(actor, a);
  if (
    a.avatarOwnerId &&
    !actor.isAdmin &&
    a.uploaderId !== actor.id &&
    a.avatarOwnerId !== actor.id
  )
    fail();
  return {
    id,
    filename: a.filename,
    scanStatus: a.scanStatus,
    detectedMime: a.detectedMime,
    size: a.size,
    durationSeconds: a.durationSeconds,
    waveform: a.waveform,
  };
}

export async function uploadStatuses(actor: Actor, input: unknown) {
  const ids = z.array(uuid).min(1).max(50).parse(input);
  const results = await Promise.all(
    [...new Set(ids)].map(async (id) => {
      try {
        return await uploadStatus(actor, id);
      } catch (error) {
        // A revoked or inaccessible attachment must not reveal its existence or block other items.
        if (error instanceof AppError && [403, 404].includes(error.status)) return null;
        throw error;
      }
    }),
  );
  return results.filter((item) => item !== null);
}

async function authorizedDownload(actor: Actor, id: string) {
  uuid.parse(id);
  const a = await db.attachment.findUnique({ where: { id } });
  if (!a || a.scanStatus !== 'CLEAN') fail();
  await authorize(actor, a);
  return a;
}

function contentTag(a: Attachment) {
  return `"${createHash('sha256')
    .update([a.id, a.objectKey, a.checksum, a.size ?? a.expectedSize].join(':'))
    .digest('hex')}"`;
}

export async function attachmentMetadata(actor: Actor, id: string) {
  const file = await authorizedDownload(actor, id);
  return {
    id: file.id,
    version: contentTag(file),
    size: file.size ?? file.expectedSize,
    mime: file.detectedMime,
  };
}

export async function avatarAttachment(actor: Actor, userId: string, version?: string) {
  uuid.parse(userId);
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { active: true, role: true, avatarAttachmentId: true },
  });
  if (!user?.active || user.role !== 'STAFF' || !user.avatarAttachmentId) fail();
  if (version !== undefined && uuid.parse(version) !== user.avatarAttachmentId) fail();
  return user.avatarAttachmentId;
}

export async function streamAttachment(
  actor: Actor,
  id: string,
  signal?: AbortSignal,
  rangeHeader?: string,
  conditional: { ifNoneMatch?: string; ifRange?: string; head?: boolean } = {},
) {
  const a = await authorizedDownload(actor, id);
  const etag = contentTag(a);
  const total = a.size ?? a.expectedSize;
  const range = byteRange(
    !conditional.head && acceptsRange(conditional.ifRange, etag) ? rangeHeader : undefined,
    total,
  );
  const metadata = {
    mime: a.detectedMime ?? 'application/octet-stream',
    filename: a.filename,
    etag,
  };
  if (matchesETag(conditional.ifNoneMatch, etag))
    return { ...metadata, stream: null, size: 0, status: 304, contentRange: undefined };
  if (conditional.head)
    return { ...metadata, stream: null, size: total, status: 200, contentRange: undefined };
  if (range === null)
    return { ...metadata, stream: null, size: 0, status: 416, contentRange: `bytes */${total}` };
  const { objectStream } = await import('../infrastructure/storage');
  return {
    ...(await objectStream(
      a.objectKey,
      52428800,
      signal,
      range ? `bytes=${range.start}-${range.end}` : undefined,
    )),
    ...metadata,
    status: range ? 206 : 200,
    contentRange: range ? `bytes ${range.start}-${range.end}/${total}` : undefined,
  };
}

export async function downloadAttachment(actor: Actor, id: string) {
  const a = await authorizedDownload(actor, id);
  return {
    bytes: await objectBytes(a.objectKey, 52428800),
    mime: a.detectedMime ?? 'application/octet-stream',
    filename: a.filename,
  };
}

export async function downloadAvatar(actor: Actor, userId: string) {
  return downloadAttachment(actor, await avatarAttachment(actor, userId));
}
