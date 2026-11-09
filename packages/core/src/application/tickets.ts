import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db, Prisma } from '@niticket/database';
import type { Ticket } from '@prisma/client';
import {
  assertRead,
  assertStaff,
  assertManager,
  isStaff,
  ticketScope,
  roleIn,
  type Actor,
  assertStudent,
  assertParticipant,
  canReadInternal,
  userRole,
} from '../domain/authorization';
import { fail } from '../domain/errors';
import { assertTransition, canReopen } from '../domain/workflow';
import {
  createTicketSchema,
  listSchema,
  messageSchema,
  statusSchema,
  assignSchema,
  transferSchema,
  priorities,
  versionSchema,
  uuid,
  conversationSchema,
} from '../validation';
import { transaction } from '../infrastructure/transaction';
import { settings } from './settings';
import { refreshActor } from './context';
import {
  ticketSummarySelect as ticketSelect,
  ticketRepository,
} from '../infrastructure/ticket-repository';

export type TicketSummary = Prisma.TicketGetPayload<{ select: typeof ticketSelect }>;

export function ticketNumber(ticket: { number: number; createdAt: Date | string }) {
  return `NIT-${new Date(ticket.createdAt).getUTCFullYear()}-${String(ticket.number).padStart(6, '0')}`;
}

async function event(
  tx: Prisma.TransactionClient,
  actor: Actor,
  ticket: Ticket,
  type: string,
  metadata: Prisma.InputJsonValue = {},
  internal = false,
) {
  await tx.activity.create({
    data: {
      ticketId: ticket.id,
      actorId: actor.id,
      type,
      metadata,
      visibility: internal ? 'INTERNAL' : 'PUBLIC',
    },
  });
  await tx.auditLog.create({
    data: { actorId: actor.id, action: type, resourceId: ticket.id, metadata },
  });
  if (!internal)
    await tx.outboxEvent.create({
      data: {
        type: 'TICKET_NOTIFICATION',
        payload: { ticketId: ticket.id, actorId: actor.id, type },
      },
    });
}

async function getLocked(tx: Prisma.TransactionClient, actor: Actor, id: string, version: number) {
  const current = await refreshActor(tx, actor);
  const ticket = await ticketRepository.findForChange(tx, id);
  if (!ticket) fail();
  assertRead(current, ticket);
  assertParticipant(current, ticket);
  if (ticket.version !== version)
    fail('CONFLICT', 409, 'این درخواست تغییر کرده است. صفحه را تازه کنید.');
  return { actor: current, ticket };
}

async function update(
  tx: Prisma.TransactionClient,
  ticket: Ticket,
  data: Prisma.TicketUncheckedUpdateManyInput,
) {
  const result = await ticketRepository.updateAtVersion(tx, ticket.id, ticket.version, data);
  if (result.count !== 1) fail('CONFLICT', 409, 'این درخواست هم‌زمان تغییر کرده است.');
}

export async function createTicket(actor: Actor, input: unknown, key: string) {
  assertStudent(actor);
  const data = createTicketSchema.parse(input);
  uuid.parse(key);
  const fingerprint = createHash('sha256').update(JSON.stringify(data)).digest('hex');
  const policy = await settings();
  return transaction(async (tx) => {
    actor = await refreshActor(tx, actor);
    assertStudent(actor);
    const existing = await tx.idempotency.findUnique({
      where: { actorId_key: { actorId: actor.id, key } },
    });
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        fail('IDEMPOTENCY_CONFLICT', 409, 'کلید تکراری برای داده‌های متفاوت استفاده شده است.');
      return { id: existing.resourceId };
    }
    const department = await tx.department.findUnique({ where: { id: data.departmentId } });
    if (
      !department?.active ||
      !department.acceptingTickets ||
      (!department.visible && !actor.isAdmin && !roleIn(actor, department.id))
    )
      fail('VALIDATION', 400, 'واحد انتخاب‌شده درخواست جدید نمی‌پذیرد.');
    if (
      data.priority === 'URGENT' &&
      !policy.allowUserUrgent &&
      !actor.isAdmin &&
      !roleIn(actor, department.id)
    )
      fail('FORBIDDEN', 403, 'انتخاب اولویت فوری برای شما مجاز نیست.');
    if (
      data.categoryId &&
      !(await tx.category.findFirst({
        where: { id: data.categoryId, departmentId: department.id, active: true },
      }))
    )
      fail('VALIDATION', 400, 'دسته‌بندی معتبر نیست.');
    const ticket = await tx.ticket.create({
      data: {
        creatorId: actor.id,
        departmentId: department.id,
        categoryId: data.categoryId,
        subject: data.subject,
        priority: data.priority,
        messages: { create: { senderId: actor.id, body: data.body } },
      },
    });
    await event(tx, actor, ticket, 'TICKET_CREATED');
    await tx.idempotency.create({
      data: { actorId: actor.id, key, fingerprint, resourceId: ticket.id },
    });
    return { id: ticket.id };
  });
}

export async function openConversation(actor: Actor, input: unknown) {
  assertStudent(actor);
  const { departmentId } = conversationSchema.parse(input);
  return transaction(async (tx) => {
    actor = await refreshActor(tx, actor);
    assertStudent(actor);
    // Serializable isolation prevents simultaneous opens from creating duplicate chats.
    const existing = await tx.ticket.findFirst({
      where: { creatorId: actor.id, departmentId },
      orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    if (existing) return existing;
    const department = await tx.department.findUnique({ where: { id: departmentId } });
    if (!department?.active || !department.visible || !department.acceptingTickets)
      fail('VALIDATION', 400, 'این واحد در حال حاضر گفتگوی جدید نمی‌پذیرد.');
    const ticket = await tx.ticket.create({
      data: { creatorId: actor.id, departmentId, subject: `گفتگو با ${department.name}` },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'CONVERSATION_OPENED',
        resourceId: ticket.id,
        metadata: { departmentId },
      },
    });
    // Opening a chat alone does not notify the unit; the first message does.
    return ticket;
  });
}

export async function listTickets(actor: Actor, input: unknown) {
  const q = listSchema.parse(input);
  const where: Prisma.TicketWhereInput = {
    AND: [
      ticketScope(actor),
      userRole(actor) === 'STAFF' ? { messages: { some: { visibility: 'PUBLIC' } } } : {},
      q.scope === 'mine'
        ? { creatorId: actor.id }
        : q.scope === 'assigned'
          ? { assigneeId: actor.id }
          : q.scope === 'unassigned'
            ? { assigneeId: null }
            : {},
      q.departmentId ? { departmentId: q.departmentId } : {},
      q.status ? { status: q.status } : {},
      q.view === 'action'
        ? {
            status: {
              in:
                userRole(actor) === 'STAFF'
                  ? ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_DEPARTMENT', 'REOPENED']
                  : ['WAITING_FOR_USER', 'RESOLVED', 'CLOSED'],
            },
          }
        : q.view === 'done' || q.view === 'answered'
          ? { status: { in: ['WAITING_FOR_USER', 'RESOLVED', 'CLOSED'] } }
          : {},
      q.q
        ? {
            OR: [
              { subject: { contains: q.q, mode: 'insensitive' } },
              { department: { name: { contains: q.q, mode: 'insensitive' } } },
              { creator: { name: { contains: q.q, mode: 'insensitive' } } },
              {
                messages: {
                  some: { visibility: 'PUBLIC', body: { contains: q.q, mode: 'insensitive' } },
                },
              },
            ],
          }
        : {},
    ],
  };
  // Validate cursors within the same scope; do not use inaccessible resources as anchors.
  if (
    q.cursor &&
    !(await db.ticket.findFirst({
      where: { AND: [where, { id: q.cursor }] },
      select: { id: true },
    }))
  )
    fail();
  const rows = await ticketRepository.list(where, q.limit, q.cursor);
  return {
    items: rows.slice(0, q.limit),
    nextCursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
  };
}

export const messageSelect = {
  id: true,
  body: true,
  visibility: true,
  createdAt: true,
  readAt: true,
  sender: { select: { id: true, name: true, image: true } },
  attachments: {
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
} satisfies Prisma.MessageSelect;

async function readMessagePage(
  id: string,
  messageCursor: string | undefined,
  internal: boolean,
  direction: 'older' | 'newer' = 'older',
) {
  const messageWhere: Prisma.MessageWhereInput = {
    ticketId: id,
    ...(!internal ? { visibility: 'PUBLIC' } : {}),
  };
  if (
    messageCursor &&
    !(await db.message.findFirst({
      where: { ...messageWhere, id: messageCursor },
      select: { id: true },
    }))
  )
    fail();
  const messages = await db.message.findMany({
    where: messageWhere,
    orderBy: [
      { createdAt: direction === 'newer' ? 'asc' : 'desc' },
      { id: direction === 'newer' ? 'asc' : 'desc' },
    ],
    take: 51,
    ...(messageCursor ? { cursor: { id: messageCursor }, skip: 1 } : {}),
    select: messageSelect,
  });
  return {
    items: direction === 'newer' ? messages.slice(0, 50) : messages.slice(0, 50).reverse(),
    nextCursor: messages.length > 50 ? messages[49].id : null,
  };
}

async function readHistoryPage(id: string, activityCursor: string | undefined, internal: boolean) {
  const activityWhere: Prisma.ActivityWhereInput = {
    ticketId: id,
    ...(!internal ? { visibility: 'PUBLIC' } : {}),
  };
  if (
    activityCursor &&
    !(await db.activity.findFirst({
      where: { ...activityWhere, id: activityCursor },
      select: { id: true },
    }))
  )
    fail();
  const activities = await db.activity.findMany({
    where: activityWhere,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 51,
    ...(activityCursor ? { cursor: { id: activityCursor }, skip: 1 } : {}),
    select: {
      id: true,
      type: true,
      createdAt: true,
      metadata: true,
      notes: {
        where: internal ? {} : { id: '__denied__' },
        take: 20,
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          body: true,
          createdAt: true,
          author: { select: { id: true, name: true, image: true } },
          attachments: {
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
        },
      },
    },
  });
  return {
    items: activities.slice(0, 50),
    nextCursor: activities.length > 50 ? activities[49].id : null,
  };
}

async function authorizeConversation(actor: Actor, id: string) {
  uuid.parse(id);
  const ticket = await db.ticket.findUnique({
    where: { id },
    select: { departmentId: true, creatorId: true },
  });
  if (!ticket) fail();
  assertRead(actor, ticket);
  return canReadInternal(actor, ticket);
}

export async function getMessagePage(
  actor: Actor,
  id: string,
  cursor?: string,
  direction: 'older' | 'newer' = 'older',
) {
  z.enum(['older', 'newer']).parse(direction);
  if (direction === 'newer' && !cursor) fail('VALIDATION', 400);
  if (cursor) uuid.parse(cursor);
  return readMessagePage(id, cursor, await authorizeConversation(actor, id), direction);
}

export async function getHistoryPage(actor: Actor, id: string, cursor?: string) {
  if (cursor) uuid.parse(cursor);
  return readHistoryPage(id, cursor, await authorizeConversation(actor, id));
}

export async function getMessageContext(actor: Actor, id: string, messageId: string) {
  uuid.parse(messageId);
  const internal = await authorizeConversation(actor, id);
  const scope: Prisma.MessageWhereInput = {
    ticketId: id,
    ...(!internal ? { visibility: 'PUBLIC' as const } : {}),
  };
  const anchor = await db.message.findFirst({
    where: { ...scope, id: messageId },
    select: messageSelect,
  });
  if (!anchor) fail();
  const [before, after] = await Promise.all([
    db.message.findMany({
      where: {
        AND: [
          scope,
          {
            OR: [
              { createdAt: { lt: anchor.createdAt } },
              { createdAt: anchor.createdAt, id: { lt: anchor.id } },
            ],
          },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 26,
      select: messageSelect,
    }),
    db.message.findMany({
      where: {
        AND: [
          scope,
          {
            OR: [
              { createdAt: { gt: anchor.createdAt } },
              { createdAt: anchor.createdAt, id: { gt: anchor.id } },
            ],
          },
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 25,
      select: messageSelect,
    }),
  ]);
  const items = [...before.slice(0, 25).reverse(), anchor, ...after.slice(0, 24)];
  return {
    items,
    olderCursor: before.length > 25 ? items[0].id : null,
    newerCursor: after.length > 24 ? items.at(-1)!.id : null,
    focusId: anchor.id,
  };
}

export async function getTicket(
  actor: Actor,
  id: string,
  messageCursor?: string,
  activityCursor?: string,
  includeHistory = true,
  focusMessageId?: string,
) {
  uuid.parse(id);
  if (messageCursor) uuid.parse(messageCursor);
  if (activityCursor) uuid.parse(activityCursor);
  const ticket = await ticketRepository.detail(id);
  if (!ticket) fail();
  assertRead(actor, ticket);
  const staff = isStaff(actor, ticket);
  const internal = canReadInternal(actor, ticket);
  const [messagePage, historyPage, attachments, responsible] = await Promise.all([
    focusMessageId
      ? getMessageContext(actor, id, focusMessageId).then((context) => ({
          items: context.items,
          nextCursor: context.olderCursor,
          focusId: context.focusId,
          newerCursor: context.newerCursor,
        }))
      : readMessagePage(id, messageCursor, internal).then((page) => ({
          ...page,
          focusId: null,
          newerCursor: null,
        })),
    includeHistory
      ? readHistoryPage(id, activityCursor, internal)
      : Promise.resolve({ items: [], nextCursor: null }),
    db.attachment.findMany({
      where: { ticketId: id, messageId: null, noteId: null },
      take: 50,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        filename: true,
        detectedMime: true,
        size: true,
        scanStatus: true,
        durationSeconds: true,
        waveform: true,
      },
    }),
    db.departmentMembership
      .findFirst({
        where: {
          departmentId: ticket.departmentId,
          active: true,
          user: { active: true, role: 'STAFF' },
        },
        orderBy: [{ role: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: { user: { select: { id: true, name: true, image: true } } },
      })
      .then((membership) => membership?.user ?? null),
  ]);
  return {
    ticket,
    responsible,
    messages: messagePage.items,
    nextMessageCursor: messagePage.nextCursor,
    messageFocus: messagePage.focusId
      ? { focusId: messagePage.focusId, newerCursor: messagePage.newerCursor }
      : null,
    activities: historyPage.items,
    nextActivityCursor: historyPage.nextCursor,
    attachments,
    permissions: {
      staff,
      manage: false,
      readOnly: userRole(actor) === 'ADMIN',
      reopen: false,
      reply: userRole(actor) !== 'ADMIN',
    },
  };
}

export async function addMessage(actor: Actor, id: string, input: unknown) {
  uuid.parse(id);
  const data = messageSchema.parse(input);
  return transaction(async (tx) => {
    if (data.clientId) {
      actor = await refreshActor(tx, actor);
      const existing = await tx.message.findUnique({
        where: { id: data.clientId },
        include: { ticket: true },
      });
      if (existing) {
        assertParticipant(actor, existing.ticket);
        if (existing.ticketId !== id || existing.senderId !== actor.id) fail();
        if (existing.body !== data.body || existing.visibility !== data.visibility)
          fail('IDEMPOTENCY_CONFLICT', 409, 'شناسه پیام برای محتوای دیگری استفاده شده است.');
        return { id: existing.id, version: existing.ticket.version };
      }
    }
    const loaded = await getLocked(tx, actor, id, data.version);
    actor = loaded.actor;
    const ticket = loaded.ticket;
    assertParticipant(actor, ticket);
    const internal = data.visibility === 'INTERNAL';
    if (internal) assertStaff(actor, ticket);
    const staff = isStaff(actor, ticket);
    const firstPublicMessage =
      !internal &&
      !(await tx.message.findFirst({
        where: { ticketId: id, visibility: 'PUBLIC' },
        select: { id: true },
      }));
    const message = await tx.message.create({
      data: {
        ...(data.clientId ? { id: data.clientId } : {}),
        ticketId: id,
        senderId: actor.id,
        body: data.body,
        visibility: data.visibility,
      },
    });
    await update(tx, ticket, {
      ...(!internal && staff && !ticket.firstResponseAt ? { firstResponseAt: new Date() } : {}),
      ...(!internal
        ? { status: staff ? 'WAITING_FOR_USER' : 'OPEN', resolvedAt: null, closedAt: null }
        : {}),
    });
    if (staff && !internal)
      await tx.notification.updateMany({
        where: { userId: actor.id, ticketId: id, readAt: null },
        data: { readAt: new Date() },
      });
    await event(
      tx,
      actor,
      ticket,
      internal ? 'INTERNAL_NOTE' : firstPublicMessage ? 'TICKET_CREATED' : 'PUBLIC_REPLY',
      {},
      internal,
    );
    return { id: message.id, version: ticket.version + 1 };
  });
}

export async function changeStatus(actor: Actor, id: string, input: unknown) {
  uuid.parse(id);
  const data = statusSchema.parse(input);
  if (['RESOLVED', 'CLOSED', 'REOPENED'].includes(data.status))
    fail('CONTINUOUS_CONVERSATION', 409, 'گفتگوها همیشه قابل ادامه هستند و بسته نمی‌شوند.');
  const policy = await settings();
  return transaction(async (tx) => {
    const loaded = await getLocked(tx, actor, id, data.version);
    actor = loaded.actor;
    const ticket = loaded.ticket;
    assertParticipant(actor, ticket);
    assertTransition(ticket.status, data.status);
    if (!isStaff(actor, ticket)) {
      if (
        ticket.creatorId !== actor.id ||
        data.status !== 'REOPENED' ||
        !canReopen(ticket.resolvedAt, policy.reopenDays)
      )
        fail('FORBIDDEN', 403, 'مهلت یا مجوز بازگشایی درخواست وجود ندارد.');
    }
    await update(tx, ticket, {
      status: data.status,
      ...(data.status === 'RESOLVED' ? { resolvedAt: new Date() } : {}),
      ...(data.status === 'CLOSED' ? { closedAt: new Date() } : {}),
      ...(data.status === 'REOPENED' ? { reopenCount: { increment: 1 }, resolvedAt: null } : {}),
    });
    await event(tx, actor, ticket, 'STATUS_CHANGED', { from: ticket.status, to: data.status });
    return { version: ticket.version + 1 };
  });
}

export async function assignTicket(actor: Actor, id: string, input: unknown) {
  uuid.parse(id);
  const data = assignSchema.parse(input);
  return transaction(async (tx) => {
    const loaded = await getLocked(tx, actor, id, data.version);
    actor = loaded.actor;
    const ticket = loaded.ticket;
    assertManager(actor, ticket.departmentId);
    if (
      data.assigneeId &&
      !(await tx.departmentMembership.findFirst({
        where: {
          userId: data.assigneeId,
          departmentId: ticket.departmentId,
          active: true,
          user: { active: true },
          department: { active: true },
        },
      }))
    )
      fail('VALIDATION', 400, 'کارشناس باید عضو فعال واحد باشد.');
    await update(tx, ticket, { assigneeId: data.assigneeId });
    await event(tx, actor, ticket, 'ASSIGNED', { from: ticket.assigneeId, to: data.assigneeId });
    return { version: ticket.version + 1 };
  });
}

export async function transferTicket(actor: Actor, id: string, input: unknown) {
  uuid.parse(id);
  const data = transferSchema.parse(input);
  return transaction(async (tx) => {
    const loaded = await getLocked(tx, actor, id, data.version);
    actor = loaded.actor;
    const ticket = loaded.ticket;
    assertManager(actor, ticket.departmentId);
    if (
      data.departmentId === ticket.departmentId ||
      !(await tx.department.findFirst({ where: { id: data.departmentId, active: true } }))
    )
      fail('VALIDATION', 400, 'واحد مقصد معتبر نیست.');
    await update(tx, ticket, {
      departmentId: data.departmentId,
      assigneeId: null,
      categoryId: null,
    });
    await event(tx, actor, ticket, 'TRANSFERRED', {
      from: ticket.departmentId,
      to: data.departmentId,
      reason: data.reason,
    });
    return { version: ticket.version + 1 };
  });
}

export async function changePriority(actor: Actor, id: string, input: unknown) {
  uuid.parse(id);
  const data = versionSchema.extend({ priority: priorities }).strict().parse(input);
  return transaction(async (tx) => {
    const loaded = await getLocked(tx, actor, id, data.version);
    actor = loaded.actor;
    const ticket = loaded.ticket;
    assertStaff(actor, ticket);
    await update(tx, ticket, { priority: data.priority });
    await event(tx, actor, ticket, 'PRIORITY_CHANGED', {
      from: ticket.priority,
      to: data.priority,
    });
    return { version: ticket.version + 1 };
  });
}

export async function addActivityNote(
  actor: Actor,
  ticketId: string,
  activityId: string,
  input: unknown,
) {
  uuid.parse(ticketId);
  uuid.parse(activityId);
  const data = z
    .object({ body: z.string().trim().max(4000).default('') })
    .strict()
    .parse(input);
  return transaction(async (tx) => {
    actor = await refreshActor(tx, actor);
    const ticket = await tx.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    assertStaff(actor, ticket);
    const activity = await tx.activity.findFirst({ where: { id: activityId, ticketId } });
    if (!activity) fail();
    if ((await tx.activityNote.count({ where: { activityId } })) >= 20)
      fail('VALIDATION', 400, 'تعداد یادداشت‌های این رویداد به حد مجاز رسیده است.');
    const note = await tx.activityNote.create({
      data: { activityId, authorId: actor.id, body: data.body },
    });
    await tx.ticket.update({ where: { id: ticketId }, data: { updatedAt: new Date() } });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'HISTORY_NOTE_CREATED',
        resourceId: note.id,
        metadata: { ticketId, activityId },
      },
    });
    return { id: note.id };
  });
}

// Authorization is checked on every poll; no cross-request actor cache is used.
export async function syncTicket(actor: Actor, id: string, since?: string) {
  uuid.parse(id);
  const ticket = await db.ticket.findFirst({
    where: { AND: [{ id }, ticketScope(actor)] },
    select: { version: true, updatedAt: true },
  });
  if (!ticket) fail();
  const revision = `${ticket.version}:${ticket.updatedAt.toISOString()}`;
  if (since === revision) return { revision, detail: null };
  const detail = await getTicket(actor, id, undefined, undefined, false);
  // Use the detail's revision to avoid losing an update racing the first read.
  return { revision: `${detail.ticket.version}:${detail.ticket.updatedAt.toISOString()}`, detail };
}

export async function inboxRevision(actor: Actor) {
  const result = await db.ticket.aggregate({
    where: ticketScope(actor),
    _count: { id: true },
    _max: { updatedAt: true },
  });
  return { revision: `${result._count.id}:${result._max.updatedAt?.toISOString() ?? ''}` };
}
