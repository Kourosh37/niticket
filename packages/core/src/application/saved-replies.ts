import { z } from 'zod';
import { db, Prisma } from '@niticket/database';
import { type Actor, userRole, roleIn } from '../domain/authorization';
import { fail } from '../domain/errors';
import { normalizeSearchText } from '../domain/search-text';
import { uuid } from '../validation';
import { transaction } from '../infrastructure/transaction';
import { enqueueRealtime } from '../infrastructure/realtime';
import { refreshActor } from './context';

export const savedReplySchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    body: z.string().trim().max(20000).default(''),
  })
  .strict();

const select = {
  id: true,
  departmentId: true,
  title: true,
  body: true,
  version: true,
  updatedAt: true,
  attachments: {
    where: { archivedAt: null },
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    select: {
      id: true,
      filename: true,
      detectedMime: true,
      size: true,
      scanStatus: true,
      durationSeconds: true,
      waveform: true,
    },
  },
} satisfies Prisma.SavedReplySelect;

export function assertSavedReplyStaff(actor: Actor, departmentId?: string) {
  if (!actor.active || userRole(actor) !== 'STAFF')
    fail('FORBIDDEN', 403, 'پیام‌های آماده فقط در دسترس مسئولان واحد هستند.');
  if (departmentId && !roleIn(actor, departmentId)) fail();
}

export async function requireSavedReply(
  client: Prisma.TransactionClient,
  actor: Actor,
  id: string,
  departmentId?: string,
) {
  assertSavedReplyStaff(actor);
  const reply = await client.savedReply.findFirst({
    where: { id: uuid.parse(id), deletedAt: null },
  });
  if (!reply || (departmentId && reply.departmentId !== departmentId)) fail();
  assertSavedReplyStaff(actor, reply.departmentId);
  return reply;
}

export async function listSavedReplies(actor: Actor, input: unknown = {}) {
  assertSavedReplyStaff(actor);
  const data = z
    .object({
      departmentId: uuid.optional(),
      q: z.string().trim().max(100).default(''),
      cursor: uuid.optional(),
    })
    .strict()
    .parse(input);
  if (data.departmentId) assertSavedReplyStaff(actor, data.departmentId);
  const units = actor.memberships.filter((m) => m.active).map((m) => m.departmentId);
  if (!units.length) return { items: [], nextCursor: null };
  const term = `%${normalizeSearchText(data.q).replace(/[\\%_]/g, '\\$&')}%`;
  const where = Prisma.sql`r."deletedAt" IS NULL AND r."departmentId" IN (${Prisma.join(data.departmentId ? [data.departmentId] : units)})
    ${
      data.q
        ? Prisma.sql`AND (niticket_search_text(r.title || ' ' || r.body) LIKE ${term}
      OR EXISTS (SELECT 1 FROM "Attachment" a WHERE a."savedReplyId"=r.id AND a."archivedAt" IS NULL
        AND niticket_search_text(a.filename) LIKE ${term}))`
        : Prisma.empty
    }`;
  const anchors = data.cursor
    ? await db.$queryRaw<{ id: string; updatedAt: Date }[]>(
        Prisma.sql`SELECT r.id,r."updatedAt" FROM "SavedReply" r WHERE ${where} AND r.id=${data.cursor}`,
      )
    : [];
  if (data.cursor && !anchors.length) fail();
  const anchor = anchors[0];
  const ids = await db.$queryRaw<
    { id: string }[]
  >(Prisma.sql`SELECT r.id FROM "SavedReply" r WHERE ${where}
    ${anchor ? Prisma.sql`AND (r."updatedAt",r.id)<(${anchor.updatedAt},${anchor.id})` : Prisma.empty}
    ORDER BY r."updatedAt" DESC,r.id DESC LIMIT 21`);
  const replies = await db.savedReply.findMany({
    where: {
      id: { in: ids.slice(0, 20).map((row) => row.id) },
      deletedAt: null,
      departmentId: { in: units },
    },
    select,
  });
  const byId = new Map(replies.map((reply) => [reply.id, reply]));
  return {
    items: ids.slice(0, 20).flatMap((row) => (byId.has(row.id) ? [byId.get(row.id)!] : [])),
    nextCursor: ids.length > 20 ? ids[19].id : null,
  };
}

export async function getSavedReply(actor: Actor, id: string) {
  assertSavedReplyStaff(actor);
  const reply = await db.savedReply.findFirst({
    where: {
      id: uuid.parse(id),
      deletedAt: null,
      departmentId: { in: actor.memberships.filter((m) => m.active).map((m) => m.departmentId) },
    },
    select,
  });
  if (!reply) fail();
  return reply;
}

export async function createSavedReply(actor: Actor, input: unknown) {
  const data = savedReplySchema
    .extend({ departmentId: uuid, clientId: uuid })
    .strict()
    .parse(input);
  return transaction(async (tx) => {
    actor = await refreshActor(tx, actor);
    assertSavedReplyStaff(actor, data.departmentId);
    const prior = await tx.savedReply.findUnique({ where: { id: data.clientId } });
    if (prior) {
      if (
        prior.deletedAt ||
        prior.creatorId !== actor.id ||
        prior.departmentId !== data.departmentId ||
        prior.title !== data.title ||
        prior.body !== data.body
      )
        fail('IDEMPOTENCY_CONFLICT', 409, 'شناسه پیام آماده برای محتوای دیگری استفاده شده است.');
      return tx.savedReply.findUniqueOrThrow({ where: { id: prior.id }, select });
    }
    if (
      (await tx.savedReply.count({
        where: { departmentId: data.departmentId, deletedAt: null },
      })) >= 500
    )
      fail('VALIDATION', 400, 'حداکثر ۵۰۰ پیام آماده برای هر واحد قابل ذخیره است.');
    const reply = await tx.savedReply.create({
      data: {
        id: data.clientId,
        departmentId: data.departmentId,
        creatorId: actor.id,
        title: data.title,
        body: data.body,
      },
      select,
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'SAVED_REPLY_CREATED',
        resourceId: reply.id,
        metadata: { departmentId: data.departmentId },
      },
    });
    await enqueueRealtime(tx, {
      scope: 'department',
      departmentId: data.departmentId,
      topics: ['saved-replies'],
    });
    return reply;
  });
}

export async function updateSavedReply(actor: Actor, id: string, input: unknown) {
  const data = savedReplySchema
    .extend({
      version: z.number().int().positive(),
      removeAttachmentIds: z.array(uuid).max(5).default([]),
    })
    .strict()
    .parse(input);
  return transaction(async (tx) => {
    actor = await refreshActor(tx, actor);
    await requireSavedReply(tx, actor, id);
    const changed = await tx.savedReply.updateMany({
      where: { id, version: data.version, deletedAt: null },
      data: { title: data.title, body: data.body, version: { increment: 1 } },
    });
    if (!changed.count) fail('CONFLICT', 409, 'پیام آماده تغییر کرده است؛ آن را دوباره باز کنید.');
    const ids = [...new Set(data.removeAttachmentIds)];
    if (ids.length) {
      if (
        (await tx.attachment.count({ where: { id: { in: ids }, savedReplyId: id } })) !== ids.length
      )
        fail();
      await tx.attachment.updateMany({
        where: { id: { in: ids }, savedReplyId: id },
        data: { archivedAt: new Date() },
      });
    }
    await tx.auditLog.create({
      data: { actorId: actor.id, action: 'SAVED_REPLY_UPDATED', resourceId: id, metadata: {} },
    });
    const reply = await tx.savedReply.findUniqueOrThrow({ where: { id }, select });
    await enqueueRealtime(tx, {
      scope: 'department',
      departmentId: reply.departmentId,
      topics: ['saved-replies'],
    });
    return reply;
  });
}

export async function deleteSavedReply(actor: Actor, id: string, input: unknown) {
  const { version } = z.object({ version: z.number().int().positive() }).strict().parse(input);
  return transaction(async (tx) => {
    actor = await refreshActor(tx, actor);
    await requireSavedReply(tx, actor, id);
    const changed = await tx.savedReply.updateMany({
      where: { id, version, deletedAt: null },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
    if (!changed.count) fail('CONFLICT', 409, 'پیام آماده تغییر کرده است؛ فهرست را تازه کنید.');
    // Keep approved bytes and sent message snapshots intact when removing a template.
    const reply = await tx.savedReply.findUniqueOrThrow({
      where: { id },
      select: { departmentId: true },
    });
    await enqueueRealtime(tx, {
      scope: 'department',
      departmentId: reply.departmentId,
      topics: ['saved-replies'],
    });
    await tx.auditLog.create({
      data: { actorId: actor.id, action: 'SAVED_REPLY_DELETED', resourceId: id, metadata: {} },
    });
    return { ok: true };
  });
}
