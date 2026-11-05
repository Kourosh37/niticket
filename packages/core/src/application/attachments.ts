import { randomUUID } from 'node:crypto';
import { db } from '@niticket/database';
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

async function authorize(
  actor: Actor,
  a: Pick<Attachment, 'ticketId' | 'messageId' | 'noteId' | 'avatarOwnerId'>,
  write = false,
) {
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
  const data = uploadSchema.parse(input);
  if (data.messageId && data.noteId)
    fail('VALIDATION', 400, 'پیوست فقط به یک پیام یا یادداشت متصل می‌شود.');
  if (data.size > (await settings()).maxUploadBytes)
    fail('VALIDATION', 400, 'حجم فایل بیش از حد مجاز است.');
  const context = {
    ticketId: data.ticketId,
    messageId: data.messageId ?? null,
    noteId: data.noteId ?? null,
    avatarOwnerId: null,
  };
  const ticket = await authorize(actor, context, true);
  if (!ticket) fail();
  if (ticket.status === 'CLOSED' && !data.noteId)
    fail('CONFLICT', 409, 'این درخواست بسته شده است.');
  if (data.noteId) assertStaff(actor, ticket);
  const id = randomUUID(),
    objectKey = `pending/${randomUUID()}`;
  await transaction(async (tx) => {
    actor = await refreshActor(tx, actor);
    const current = await tx.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    assertParticipant(actor, current);
    if (data.noteId) assertStaff(actor, current);
    if (
      (await tx.attachment.count({
        where: {
          ticketId: ticket.id,
          uploaderId: actor.id,
          scanStatus: { in: ['PENDING', 'QUARANTINED', 'CLEAN'] },
        },
      })) >= 100
    )
      fail('VALIDATION', 400, 'تعداد پیوست‌ها به حد مجاز رسیده است.');
    await tx.attachment.create({
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
  });
  return { id, url: await signedUpload(objectKey, data.mime), expiresIn: 180 };
}

export async function createAvatarUpload(actor: Actor, input: unknown) {
  const data = uploadSchema
    .omit({ ticketId: true, messageId: true, noteId: true })
    .extend({ userId: uuid.optional() })
    .strict()
    .parse(input);
  const userId = data.userId ?? actor.id;
  if (data.size > 2097152 || !['image/png', 'image/jpeg', 'image/webp'].includes(data.mime))
    fail('VALIDATION', 400, 'تصویر باید پی‌ان‌جی، جی‌پی‌جی یا وب‌پی و حداکثر ۲ مگابایت باشد.');
  const context = { ticketId: null, messageId: null, noteId: null, avatarOwnerId: userId };
  await authorize(actor, context, true);
  const id = randomUUID(),
    objectKey = `pending/${randomUUID()}`;
  await transaction(async (tx) => {
    actor = await refreshActor(tx, actor);
    if (!actor.isAdmin && actor.id !== userId) fail();
    if (
      (await tx.attachment.count({
        where: { avatarOwnerId: userId, scanStatus: { in: ['PENDING', 'QUARANTINED'] } },
      })) >= 5
    )
      fail('VALIDATION', 400, 'لطفاً تا پایان بررسی تصویر قبلی صبر کنید.');
    await tx.attachment.create({
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
  });
  return { id, url: await signedUpload(objectKey, data.mime), expiresIn: 180 };
}

export async function completeUpload(actor: Actor, id: string) {
  uuid.parse(id);
  const a = await db.attachment.findUnique({ where: { id } });
  if (!a || a.uploaderId !== actor.id) fail();
  await authorize(actor, a, true);
  if (a.scanStatus !== 'PENDING') return { id, scanStatus: a.scanStatus };
  if (a.expiresAt < new Date()) fail('VALIDATION', 400, 'مهلت بارگذاری تمام شده است.');
  const limit = a.avatarOwnerId ? 2097152 : (await settings()).maxUploadBytes;
  const head = await headObject(a.objectKey);
  if (head.ContentLength !== a.expectedSize || head.ContentLength > limit)
    fail('VALIDATION', 400, 'حجم فایل بارگذاری‌شده معتبر نیست.');
  await transaction(async (tx) => {
    actor = await refreshActor(tx, actor);
    if (a.ticketId) {
      const t = await tx.ticket.findUniqueOrThrow({ where: { id: a.ticketId } });
      assertParticipant(actor, t);
    } else if (!actor.isAdmin && actor.id !== a.avatarOwnerId) fail();
    const changed = await tx.attachment.updateMany({
      where: { id, scanStatus: 'PENDING' },
      data: { scanStatus: 'QUARANTINED' },
    });
    if (changed.count)
      await tx.outboxEvent.create({
        data: { type: 'SCAN_ATTACHMENT', payload: { attachmentId: id } },
      });
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
  return { id, scanStatus: a.scanStatus };
}

export async function downloadAttachment(actor: Actor, id: string) {
  uuid.parse(id);
  const a = await db.attachment.findUnique({ where: { id } });
  if (!a || a.scanStatus !== 'CLEAN') fail();
  await authorize(actor, a);
  return {
    bytes: await objectBytes(a.objectKey, 52428800),
    mime: a.detectedMime ?? 'application/octet-stream',
    filename: a.filename,
  };
}

export async function downloadAvatar(actor: Actor, userId: string) {
  uuid.parse(userId);
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { active: true, role: true, avatarAttachmentId: true },
  });
  if (!user?.active || user.role !== 'STAFF' || !user.avatarAttachmentId) fail();
  return downloadAttachment(actor, user.avatarAttachmentId);
}
