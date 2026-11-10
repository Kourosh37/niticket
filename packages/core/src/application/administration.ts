import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db, Prisma } from '@niticket/database';
import {
  assertAdmin,
  assertManager,
  roleIn,
  ticketScope,
  userRole,
  type Actor,
} from '../domain/authorization';
import { fail } from '../domain/errors';
import {
  departmentSchema,
  memberSchema,
  profileSchema,
  uuid,
  provisionDepartmentSchema,
  responsibleSchema,
} from '../validation';
import { internalIdentityEmail } from './mobile-identity';
import { iranianPhoneSchema, asciiDigits, normalizeIranianPhone } from '../domain/phone';
import { config } from '../infrastructure/config';
import { transaction } from '../infrastructure/transaction';
import { refreshActor, requireFresh } from './context';

async function audit(
  tx: Prisma.TransactionClient,
  actor: Actor,
  action: string,
  resourceId: string,
  metadata: Prisma.InputJsonValue = {},
) {
  await tx.auditLog.create({ data: { actorId: actor.id, action, resourceId, metadata } });
}

export async function departmentChoices(actor: Actor, admin = false) {
  const scope: Prisma.DepartmentWhereInput = admin
    ? actor.isAdmin
      ? {}
      : { memberships: { some: { userId: actor.id, active: true } } }
    : {
        active: true,
        OR: [
          { visible: true },
          { memberships: { some: { userId: actor.id, active: true } } },
          ...(actor.isAdmin ? [{}] : []),
        ],
      };
  return db.department.findMany({
    where: scope,
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    take: 1000,
    select: { id: true, name: true, description: true, acceptingTickets: true },
  });
}

export async function conversationChoices(actor: Actor, input: unknown = {}) {
  if (userRole(actor) !== 'STUDENT') fail('FORBIDDEN', 403);
  const data = z
    .object({
      q: z.string().trim().max(100).optional(),
      cursor: uuid.optional(),
      departmentId: uuid.optional(),
    })
    .strict()
    .parse(input);
  const where: Prisma.DepartmentWhereInput = {
    active: true,
    ...(data.departmentId ? { id: data.departmentId } : {}),
    AND: [
      { OR: [{ visible: true }, { memberships: { some: { userId: actor.id, active: true } } }] },
      data.q
        ? {
            OR: [
              { name: { contains: data.q, mode: 'insensitive' } },
              { description: { contains: data.q, mode: 'insensitive' } },
            ],
          }
        : {},
    ],
  };
  if (
    data.cursor &&
    !(await db.department.findFirst({
      where: { AND: [where, { id: data.cursor }] },
      select: { id: true },
    }))
  )
    fail();
  const rows = await db.department.findMany({
    where,
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    take: 51,
    ...(data.cursor ? { cursor: { id: data.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      name: true,
      description: true,
      acceptingTickets: true,
      tickets: { where: { creatorId: actor.id }, take: 1, select: { id: true } },
    },
  });
  return {
    items: rows
      .slice(0, 50)
      .map(({ tickets, ...department }) => ({ ...department, canContinue: tickets.length > 0 })),
    nextCursor: rows.length > 50 ? rows[49].id : null,
  };
}

export async function listDepartments(
  actor: Actor,
  admin = false,
  filters: { q?: string; cursor?: string; limit?: number } = {},
) {
  if (filters.cursor) uuid.parse(filters.cursor);
  const scope: Prisma.DepartmentWhereInput = admin
    ? actor.isAdmin
      ? {}
      : { memberships: { some: { userId: actor.id, active: true } } }
    : {
        active: true,
        OR: [
          { visible: true },
          { memberships: { some: { userId: actor.id, active: true } } },
          ...(actor.isAdmin ? [{}] : []),
        ],
      };
  return db.department.findMany({
    where: {
      AND: [
        scope,
        filters.q ? { name: { contains: filters.q.slice(0, 100), mode: 'insensitive' } } : {},
      ],
    },
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    take: Math.max(1, Math.min(1000, filters.limit ?? 1000)),
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      active: true,
      visible: true,
      acceptingTickets: true,
      categories: { where: { active: true }, select: { id: true, name: true }, take: 100 },
      memberships: {
        where: { active: true, user: { role: 'STAFF' } },
        take: 50,
        select: {
          id: true,
          user: {
            select: {
              id: true,
              name: true,
              phoneNumber: admin,
              image: true,
              active: true,
            },
          },
        },
      },
    },
  });
}

export async function saveDepartment(actor: Actor, input: unknown, id?: string) {
  assertAdmin(actor);
  await requireFresh(actor);
  if (!id) return provisionDepartment(actor, input);
  if (id) uuid.parse(id);
  const data = departmentSchema.parse(input);
  return transaction(async (tx) => {
    actor = await refreshActor(tx, actor);
    assertAdmin(actor);
    const department = await tx.department.update({ where: { id }, data });
    await audit(tx, actor, id ? 'DEPARTMENT_UPDATED' : 'DEPARTMENT_CREATED', department.id, {
      active: data.active,
    });
    return { id: department.id };
  });
}

export async function provisionDepartment(actor: Actor, input: unknown) {
  assertAdmin(actor);
  await requireFresh(actor);
  const data = provisionDepartmentSchema.parse(input);
  return transaction(async (tx) => {
    actor = await refreshActor(tx, actor);
    assertAdmin(actor);
    const person = await provisionStaff(tx, data.responsible);
    const department = await tx.department.create({
      data: {
        name: data.name,
        description: data.description,
        slug: `unit-${randomUUID()}`,
        memberships: { create: { userId: person.id, role: 'MANAGER', assignedBy: actor.id } },
      },
    });
    await audit(tx, actor, 'DEPARTMENT_CREATED', department.id, { responsibleUserId: person.id });
    await audit(tx, actor, 'STAFF_PROVISIONED', person.id, { departmentId: department.id });
    return { id: department.id, responsibleUserId: person.id };
  });
}

export async function listMembers(actor: Actor, departmentId: string) {
  uuid.parse(departmentId);
  assertManager(actor, departmentId);
  return db.departmentMembership.findMany({
    where: { departmentId },
    orderBy: { createdAt: 'asc' },
    take: 100,
    select: {
      id: true,
      role: true,
      active: true,
      user: { select: { id: true, name: true, phoneNumber: true, active: true } },
    },
  });
}

export async function saveMember(actor: Actor, departmentId: string, input: unknown) {
  uuid.parse(departmentId);
  assertAdmin(actor);
  await requireFresh(actor);
  const data = memberSchema.parse(input);
  return transaction(async (tx) => {
    actor = await refreshActor(tx, actor);
    assertAdmin(actor);
    const member = await tx.user.findUnique({ where: { id: data.userId } });
    if (!member || member.isAdmin || member.role !== 'STAFF')
      fail('VALIDATION', 400, 'فقط مسئول واحد می‌تواند به واحد تخصیص داده شود.');
    if (data.role === 'MANAGER' && !actor.isAdmin)
      fail('FORBIDDEN', 403, 'فقط مدیر سامانه می‌تواند مدیر واحد تعیین کند.');
    const existing = await tx.departmentMembership.findUnique({
      where: { userId_departmentId: { userId: data.userId, departmentId } },
    });
    if (existing?.role === 'MANAGER' && !actor.isAdmin)
      fail('FORBIDDEN', 403, 'تغییر عضویت مدیر واحد به دسترسی مدیر سامانه نیاز دارد.');
    const membership = await tx.departmentMembership.upsert({
      where: { userId_departmentId: { userId: data.userId, departmentId } },
      create: { ...data, departmentId, assignedBy: actor.id },
      update: {
        role: data.role,
        active: data.active,
        assignedBy: actor.id,
        revokedAt: data.active ? null : new Date(),
      },
    });
    await tx.session.deleteMany({ where: { userId: data.userId } });
    await audit(tx, actor, 'MEMBERSHIP_CHANGED', membership.id, {
      departmentId,
      userId: data.userId,
      role: data.role,
      active: data.active,
    });
    return { id: membership.id };
  });
}

export async function saveCategory(actor: Actor, departmentId: string, input: unknown) {
  uuid.parse(departmentId);
  const data = z
    .object({
      id: uuid.optional(),
      name: z.string().trim().min(2).max(100),
      active: z.boolean().default(true),
    })
    .strict()
    .parse(input);
  return transaction(async (tx) => {
    actor = await refreshActor(tx, actor);
    assertAdmin(actor);
    if (data.id && !(await tx.category.findFirst({ where: { id: data.id, departmentId } }))) fail();
    const c = data.id
      ? await tx.category.update({
          where: { id: data.id },
          data: { name: data.name, active: data.active },
        })
      : await tx.category.create({ data: { departmentId, name: data.name, active: data.active } });
    await audit(tx, actor, 'CATEGORY_CHANGED', c.id);
    return { id: c.id };
  });
}

export async function listUsers(
  actor: Actor,
  q = '',
  cursor?: string,
  direction: 'next' | 'previous' = 'next',
) {
  assertAdmin(actor);
  if (cursor) uuid.parse(cursor);
  z.enum(['next', 'previous']).parse(direction);
  q = q.trim().slice(0, 100);
  const digits = asciiDigits(q).replace(/[\s()-]/g, '');
  const phone = normalizeIranianPhone(q);
  const fullPhone = /^\+989\d{9}$/.test(phone);
  const numeric = /^\+?\d+$/.test(digits);
  const phonePart = digits.startsWith('09') ? digits.slice(1) : digits.replace(/^\+/, '');
  const where: Prisma.UserWhereInput = !q
    ? {}
    : fullPhone
      ? {
          OR: [
            { phoneNumber: phone },
            { phone: { in: [phone, phone.replace('+98', '0'), phone.slice(3)] } },
          ],
        }
      : numeric
        ? {
            OR: [
              { phoneNumber: { contains: phonePart } },
              { phone: { contains: digits } },
              { studentNumber: { contains: digits } },
            ],
          }
        : { name: { contains: q, mode: 'insensitive' } };
  if (
    cursor &&
    !(await db.user.findFirst({ where: { AND: [where, { id: cursor }] }, select: { id: true } }))
  )
    fail();
  const backward = direction === 'previous' && !!cursor;
  const rows = await db.user.findMany({
    where,
    orderBy: { id: backward ? 'desc' : 'asc' },
    take: 31,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      name: true,
      active: true,
      isAdmin: true,
      role: true,
      phoneNumber: true,
      phone: true,
      phoneNumberVerified: true,
      image: true,
      lastLoginAt: true,
    },
  });
  const items = rows.slice(0, 30);
  if (backward) items.reverse();
  return {
    items,
    nextCursor: (backward ? !!cursor : rows.length > 30) ? (items.at(-1)?.id ?? null) : null,
    previousCursor: (backward ? rows.length > 30 : !!cursor) ? (items[0]?.id ?? null) : null,
  };
}

async function provisionStaff(
  tx: Prisma.TransactionClient,
  data: z.infer<typeof responsibleSchema>,
) {
  const existing = await tx.user.findUnique({ where: { phoneNumber: data.phoneNumber } });
  if (data.phoneNumber === config().ADMIN_PHONE || existing?.isAdmin || existing?.role === 'ADMIN')
    fail('VALIDATION', 400, 'حساب مدیر سامانه نمی‌تواند مسئول واحد باشد.');
  if (existing) {
    if (!existing.active) fail('VALIDATION', 400, 'ابتدا حساب مسئول را فعال کنید.');
    await tx.session.deleteMany({ where: { userId: existing.id } });
    return tx.user.update({
      where: { id: existing.id },
      data: { name: data.name, role: 'STAFF', accountType: 'STAFF' },
    });
  }
  return tx.user.create({
    data: {
      name: data.name,
      email: internalIdentityEmail(),
      phoneNumber: data.phoneNumber,
      role: 'STAFF',
      accountType: 'STAFF',
      emailNotifications: false,
    },
  });
}

export async function createUser(actor: Actor, input: unknown) {
  assertAdmin(actor);
  await requireFresh(actor);
  const data = responsibleSchema.parse(input);
  return transaction(async (tx) => {
    actor = await refreshActor(tx, actor);
    assertAdmin(actor);
    const person = await provisionStaff(tx, data);
    await audit(tx, actor, 'STAFF_PROVISIONED', person.id);
    return { id: person.id };
  });
}

export async function updateUser(actor: Actor, id: string, input: unknown) {
  assertAdmin(actor);
  await requireFresh(actor);
  uuid.parse(id);
  const data = z
    .object({
      active: z.boolean().optional(),
      name: z.string().trim().min(2).max(100).optional(),
      phoneNumber: iranianPhoneSchema.optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0)
    .parse(input);
  return transaction(async (tx) => {
    actor = await refreshActor(tx, actor);
    assertAdmin(actor);
    const target = await tx.user.findUniqueOrThrow({ where: { id } });
    const changedPhone = !!data.phoneNumber && data.phoneNumber !== target.phoneNumber;
    if (id === actor.id && (data.active === false || changedPhone))
      fail('VALIDATION', 400, 'تغییر شماره یا غیرفعال‌سازی حساب خودتان مجاز نیست.');
    if (target.phoneNumber === config().ADMIN_PHONE && (changedPhone || data.active === false))
      fail('FORBIDDEN', 403, 'شماره و دسترسی مدیر اصلی از تنظیمات سرور مدیریت می‌شود.');
    await tx.user.update({
      where: { id },
      data: { ...data, ...(changedPhone ? { phoneNumberVerified: false } : {}) },
    });
    // A password on the old phone must not grant access to the new identity.
    if (changedPhone)
      await tx.account.deleteMany({ where: { userId: id, providerId: 'credential' } });
    await tx.session.deleteMany({ where: { userId: id } });
    await audit(tx, actor, 'USER_ACCESS_CHANGED', id, { fields: Object.keys(data) });
    return { id };
  });
}

export async function getProfile(actor: Actor) {
  const user = await db.user.findUniqueOrThrow({
    where: { id: actor.id },
    select: {
      id: true,
      name: true,
      phoneNumber: true,
      role: true,
      image: true,
      accounts: { where: { providerId: 'credential' }, select: { password: true }, take: 1 },
    },
  });
  const { accounts, ...profile } = user;
  return { ...profile, hasPassword: !!accounts[0]?.password };
}

export async function updateProfile(actor: Actor, input: unknown) {
  const data = profileSchema.parse(input);
  await db.user.update({ where: { id: actor.id }, data });
  return getProfile(actor);
}

export async function notifications(actor: Actor, cursor?: string) {
  if (cursor) uuid.parse(cursor);
  if (
    cursor &&
    !(await db.notification.findFirst({
      where: { id: cursor, userId: actor.id },
      select: { id: true },
    }))
  )
    fail();
  const rows = await db.notification.findMany({
    where: { userId: actor.id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 31,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      title: true,
      ticketId: true,
      messageId: true,
      readAt: true,
      createdAt: true,
    },
  });
  return {
    items: rows.slice(0, 30),
    nextCursor: rows.length > 30 ? rows[29].id : null,
    unreadCount: await db.notification.count({ where: { userId: actor.id, readAt: null } }),
  };
}

export async function readNotification(actor: Actor, input: unknown) {
  const { id } = z.object({ id: uuid.optional() }).strict().parse(input);
  if (userRole(actor) === 'STAFF')
    fail('REPLY_REQUIRED', 403, 'اعلان‌های مسئول واحد پس از ارسال پاسخ عمومی خوانده می‌شوند.');
  await db.notification.updateMany({
    where: { userId: actor.id, readAt: null, ...(id ? { id } : {}) },
    data: { readAt: new Date() },
  });
  return { ok: true };
}

export async function reports(actor: Actor, input: unknown = {}) {
  const data = z
    .object({
      departmentId: uuid.optional(),
      from: z.iso.datetime().optional(),
      to: z.iso.datetime().optional(),
    })
    .parse(input);
  if (data.departmentId && !actor.isAdmin && !roleIn(actor, data.departmentId))
    fail('FORBIDDEN', 403, 'دسترسی گزارش این واحد را ندارید.');
  const where: Prisma.TicketWhereInput = {
    AND: [
      ticketScope(actor),
      data.departmentId ? { departmentId: data.departmentId } : {},
      {
        createdAt: {
          ...(data.from ? { gte: new Date(data.from) } : {}),
          ...(data.to ? { lte: new Date(data.to) } : {}),
        },
      },
    ],
  };
  const [byStatus, byPriority, byDepartment, byAgent, total, unread, users, departments] =
    await Promise.all([
      db.ticket.groupBy({ by: ['status'], where, _count: true }),
      db.ticket.groupBy({ by: ['priority'], where, _count: true }),
      db.ticket.groupBy({ by: ['departmentId'], where, _count: true }),
      db.ticket.groupBy({ by: ['assigneeId'], where, _count: true }),
      db.ticket.count({ where }),
      db.notification.count({ where: { userId: actor.id, readAt: null } }),
      actor.isAdmin ? db.user.count() : Promise.resolve(null),
      actor.isAdmin ? db.department.count({ where: { active: true } }) : Promise.resolve(null),
    ]);
  const departmentIds = actor.memberships.filter((m) => m.active).map((m) => m.departmentId);
  const scopeSql = actor.isAdmin
    ? Prisma.sql`TRUE`
    : userRole(actor) === 'STAFF'
      ? departmentIds.length
        ? Prisma.sql`"departmentId" IN (${Prisma.join(departmentIds)})`
        : Prisma.sql`FALSE`
      : Prisma.sql`"creatorId"=${actor.id}`;
  const timing = await db.$queryRaw<
    {
      firstResponseSeconds: number | null;
      resolutionSeconds: number | null;
      overdue: number;
      pendingReplies: number;
      answeredReplies: number;
    }[]
  >(Prisma.sql`
    SELECT AVG(EXTRACT(EPOCH FROM ("firstResponseAt"-"createdAt")))::double precision AS "firstResponseSeconds",
      AVG(EXTRACT(EPOCH FROM ("resolvedAt"-"createdAt")))::double precision AS "resolutionSeconds",
      COUNT(*) FILTER (WHERE "dueAt"<NOW() AND status NOT IN ('RESOLVED','CLOSED'))::int AS overdue,
      COUNT(*) FILTER (WHERE latest."senderId"=t."creatorId")::int AS "pendingReplies",
      COUNT(*) FILTER (WHERE latest."senderId"<>t."creatorId")::int AS "answeredReplies"
    FROM "Ticket" t
    LEFT JOIN LATERAL (
      SELECT m."senderId" FROM "Message" m
      WHERE m."ticketId"=t.id AND m.visibility='PUBLIC'
      ORDER BY m."createdAt" DESC,m.id DESC LIMIT 1
    ) latest ON TRUE
    WHERE ${scopeSql}
      ${data.departmentId ? Prisma.sql`AND "departmentId"=${data.departmentId}` : Prisma.empty}
      ${data.from ? Prisma.sql`AND "createdAt">=${new Date(data.from)}` : Prisma.empty}
      ${data.to ? Prisma.sql`AND "createdAt"<=${new Date(data.to)}` : Prisma.empty}`);
  const byCategory = await db.ticket.groupBy({ by: ['categoryId'], where, _count: true });
  const agents = await db.user.findMany({
    where: { id: { in: byAgent.map((g) => g.assigneeId).filter((id): id is string => !!id) } },
    select: { id: true, name: true },
    take: 100,
  });
  const categories = await db.category.findMany({
    where: { id: { in: byCategory.map((g) => g.categoryId).filter((id): id is string => !!id) } },
    select: { id: true, name: true },
    take: 100,
  });
  return {
    total,
    pendingReplies: timing[0].pendingReplies,
    answeredReplies: timing[0].answeredReplies,
    byStatus,
    byPriority,
    byDepartment,
    byAgent,
    byCategory,
    agents,
    categories,
    unread,
    users,
    departments,
    timing: timing[0],
  };
}

export async function auditLogs(actor: Actor, cursor?: string) {
  assertAdmin(actor);
  if (cursor) uuid.parse(cursor);
  const rows = await db.auditLog.findMany({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 51,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  return { items: rows.slice(0, 50), nextCursor: rows.length > 50 ? rows[49].id : null };
}
