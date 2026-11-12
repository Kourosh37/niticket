import { db, Prisma } from '@niticket/database';
import type { Actor } from '../domain/authorization';
import { fail } from '../domain/errors';
import { sessionDevice } from '../domain/session-device';
import { transaction } from '../infrastructure/transaction';
import { uuid } from '../validation';
import { refreshActor } from './context';

const sessionSelect = {
  id: true,
  userAgent: true,
  createdAt: true,
  lastSeenAt: true,
  expiresAt: true,
} satisfies Prisma.SessionSelect;
const describe = (row: Prisma.SessionGetPayload<{ select: typeof sessionSelect }>) => ({
  id: row.id,
  device: sessionDevice(row.userAgent),
  loginAt: row.createdAt,
  lastSeenAt: row.lastSeenAt,
  expiresAt: row.expiresAt,
});

export async function listSessions(actor: Actor, cursor?: string) {
  if (cursor) uuid.parse(cursor);
  const where = { userId: actor.id, id: { not: actor.sessionId }, expiresAt: { gt: new Date() } };
  if (
    cursor &&
    !(await db.session.findFirst({ where: { AND: [where, { id: cursor }] }, select: { id: true } }))
  )
    fail();
  const [current, rows] = await Promise.all([
    db.session.findFirst({
      where: { id: actor.sessionId, userId: actor.id, expiresAt: { gt: new Date() } },
      select: sessionSelect,
    }),
    db.session.findMany({
      where,
      select: sessionSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 21,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }),
  ]);
  if (!current) fail('UNAUTHENTICATED', 401, 'برای ادامه وارد حساب خود شوید.');
  return {
    current: describe(current),
    items: rows.slice(0, 20).map(describe),
    nextCursor: rows.length > 20 ? rows[19].id : null,
  };
}

export async function revokeSessions(actor: Actor, sessionId?: string) {
  if (sessionId) uuid.parse(sessionId);
  if (sessionId === actor.sessionId)
    fail('VALIDATION', 400, 'برای خروج از این دستگاه، از گزینهٔ خروج استفاده کنید.');
  // Revoking access to the caller's own devices is available throughout a valid login.
  return transaction(async (tx) => {
    await refreshActor(tx, actor);
    if (
      !(await tx.session.findFirst({
        where: { id: actor.sessionId, userId: actor.id, expiresAt: { gt: new Date() } },
        select: { id: true },
      }))
    )
      fail('UNAUTHENTICATED', 401);
    const result = await tx.session.deleteMany({
      where: { userId: actor.id, id: sessionId ?? { not: actor.sessionId } },
    });
    if (sessionId && !result.count) fail();
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: sessionId ? 'SESSION_REVOKED' : 'OTHER_SESSIONS_REVOKED',
        resourceId: sessionId ?? actor.id,
        metadata: { count: result.count },
      },
    });
    return { revoked: result.count };
  });
}
