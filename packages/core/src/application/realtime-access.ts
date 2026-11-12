import { db } from '@niticket/database';
import { canRead, canReadInternal, roleIn, userRole, type Actor } from '../domain/authorization';
import type { RealtimeChange, RealtimeUpdate } from '../domain/realtime';
import { fail } from '../domain/errors';
import { loadActor } from './context';

export function mayReceiveChange(actor: Actor, change: RealtimeChange) {
  if (!actor.active) return false;
  if (change.scope === 'everyone') return true;
  if (change.scope === 'user') return change.userId === actor.id;
  if (change.scope === 'department')
    return actor.isAdmin || (userRole(actor) === 'STAFF' && !!roleIn(actor, change.departmentId));
  return canRead(actor, change) && (!change.internal || userRole(actor) !== 'STUDENT');
}

export async function refreshStreamActor(actor: Actor) {
  const session = await db.session.findFirst({
    where: { id: actor.sessionId, userId: actor.id, expiresAt: { gt: new Date() } },
    select: { expiresAt: true },
  });
  if (!session) fail('UNAUTHENTICATED', 401);
  const current = await loadActor(db, actor.id, actor.sessionId, actor.sessionCreatedAt);
  return { actor: current, expiresAt: session.expiresAt };
}

export async function authorizedUpdate(
  actor: Actor,
  changes: RealtimeChange[],
): Promise<RealtimeUpdate> {
  const ids = [
    ...new Set(changes.flatMap((change) => (change.scope === 'ticket' ? [change.ticketId] : []))),
  ];
  const tickets = ids.length
    ? await db.ticket.findMany({
        where: { id: { in: ids } },
        select: { id: true, creatorId: true, departmentId: true },
      })
    : [];
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  const topics = new Set<RealtimeUpdate['topics'][number]>(),
    ticketIds = new Set<string>();
  for (const change of changes) {
    if (!mayReceiveChange(actor, change)) continue;
    if (change.scope === 'ticket') {
      const ticket = byId.get(change.ticketId);
      if (
        !ticket ||
        !canRead(actor, ticket) ||
        (change.internal && !canReadInternal(actor, ticket))
      )
        continue;
      ticketIds.add(ticket.id);
    }
    change.topics.forEach((topic) => topics.add(topic));
  }
  return { topics: [...topics], ticketIds: [...ticketIds] };
}
