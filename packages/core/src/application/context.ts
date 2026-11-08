import { db, type Prisma } from '@niticket/database';
import { getAuth } from '../infrastructure/auth';
import { fail } from '../domain/errors';
import type { Actor } from '../domain/authorization';

export async function actorFromHeaders(headers: Headers): Promise<Actor> {
  const session = await getAuth().api.getSession({ headers, query: { disableRefresh: true } });
  if (!session) fail('UNAUTHENTICATED', 401, 'برای ادامه وارد حساب خود شوید.');
  return loadActor(db, session.user.id, session.session.id, new Date(session.session.createdAt));
}

export async function loadActor(
  client: Prisma.TransactionClient,
  userId: string,
  sessionId: string,
  sessionCreatedAt: Date,
): Promise<Actor> {
  const user = await client.user.findUnique({
    where: { id: userId },
    include: { memberships: { where: { active: true, department: { active: true } } } },
  });
  if (!user?.active || !user.phoneNumber || !user.phoneNumberVerified)
    fail('UNAUTHENTICATED', 401, 'برای ادامه با شماره موبایل وارد شوید.');
  return {
    id: user.id,
    active: user.active,
    isAdmin: user.isAdmin,
    role: user.isAdmin ? 'ADMIN' : user.role,
    memberships: user.memberships,
    sessionId,
    sessionCreatedAt,
  };
}

export async function refreshActor(client: Prisma.TransactionClient, actor: Actor) {
  return loadActor(client, actor.id, actor.sessionId, actor.sessionCreatedAt);
}

export async function requireFresh(actor: Actor) {
  const proof = await db.reauthentication.findUnique({ where: { sessionId: actor.sessionId } });
  if (
    Date.now() - Math.max(actor.sessionCreatedAt.getTime(), proof?.verifiedAt.getTime() ?? 0) >
    300000
  )
    fail('REAUTH_REQUIRED', 403, 'برای ادامه، هویت خود را با کد موبایل یا رمز عبور تأیید کنید.');
}
