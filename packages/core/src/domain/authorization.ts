import type { Prisma, Ticket } from '@prisma/client';
import { fail } from './errors';

export type Actor = {
  id: string;
  active: boolean;
  isAdmin: boolean;
  role?: 'STUDENT' | 'STAFF' | 'ADMIN';
  memberships: { departmentId: string; role: 'AGENT' | 'MANAGER'; active: boolean }[];
  sessionId: string;
  sessionCreatedAt: Date;
};

export function userRole(actor: Actor) {
  return actor.isAdmin ? 'ADMIN' : (actor.role ?? (actor.memberships.length ? 'STAFF' : 'STUDENT'));
}

export function assertStudent(actor: Actor) {
  if (!actor.active || userRole(actor) !== 'STUDENT')
    fail('FORBIDDEN', 403, 'ثبت درخواست فقط برای کاربر امکان‌پذیر است.');
}

export function assertParticipant(
  actor: Actor,
  ticket: Pick<Ticket, 'departmentId' | 'creatorId'>,
) {
  if (userRole(actor) === 'ADMIN')
    fail('FORBIDDEN', 403, 'مدیر سامانه فقط امکان مشاهده تاریخچه را دارد.');
  assertRead(actor, ticket);
}

export function canReadInternal(actor: Actor, ticket: Pick<Ticket, 'departmentId' | 'creatorId'>) {
  return actor.active && (userRole(actor) === 'ADMIN' || isStaff(actor, ticket));
}

export function roleIn(actor: Actor, departmentId: string) {
  return actor.active
    ? actor.memberships.find((m) => m.departmentId === departmentId && m.active)?.role
    : undefined;
}

export function isStaff(actor: Actor, ticket: Pick<Ticket, 'departmentId' | 'creatorId'>) {
  return actor.active && userRole(actor) === 'STAFF' && !!roleIn(actor, ticket.departmentId);
}

export function canRead(actor: Actor, ticket: Pick<Ticket, 'departmentId' | 'creatorId'>) {
  return (
    actor.active &&
    (userRole(actor) === 'ADMIN' ||
      (userRole(actor) === 'STUDENT'
        ? ticket.creatorId === actor.id
        : !!roleIn(actor, ticket.departmentId)))
  );
}

export function assertRead(actor: Actor, ticket: Pick<Ticket, 'departmentId' | 'creatorId'>) {
  if (!canRead(actor, ticket)) fail();
}

export function assertStaff(actor: Actor, ticket: Pick<Ticket, 'departmentId' | 'creatorId'>) {
  if (!isStaff(actor, ticket)) fail('FORBIDDEN', 403, 'اجازه انجام این عملیات را ندارید.');
}

export function assertManager(actor: Actor, departmentId: string) {
  if (!actor.active || (!actor.isAdmin && roleIn(actor, departmentId) !== 'MANAGER'))
    fail('FORBIDDEN', 403, 'دسترسی مدیریت این واحد را ندارید.');
}

export function assertAdmin(actor: Actor) {
  if (!actor.active || !actor.isAdmin) fail('FORBIDDEN', 403, 'دسترسی مدیر سامانه لازم است.');
}

export function ticketScope(actor: Actor): Prisma.TicketWhereInput {
  if (!actor.active) return { id: '__denied__' };
  if (actor.isAdmin) return {};
  if (userRole(actor) === 'STAFF')
    return {
      departmentId: { in: actor.memberships.filter((m) => m.active).map((m) => m.departmentId) },
    };
  return { creatorId: actor.id };
}
