import type { TicketStatus } from '@prisma/client';
import { fail } from './errors';

export const transitions: Record<TicketStatus, readonly TicketStatus[]> = {
  OPEN: ['IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED'],
  IN_PROGRESS: ['WAITING_FOR_USER', 'WAITING_FOR_DEPARTMENT', 'RESOLVED'],
  WAITING_FOR_USER: ['IN_PROGRESS', 'RESOLVED'],
  WAITING_FOR_DEPARTMENT: ['IN_PROGRESS', 'RESOLVED'],
  RESOLVED: ['CLOSED', 'REOPENED'],
  CLOSED: [],
  REOPENED: ['IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED'],
};

export function assertTransition(from: TicketStatus, to: TicketStatus) {
  if (!transitions[from].includes(to))
    fail('INVALID_TRANSITION', 409, 'این تغییر وضعیت مجاز نیست.');
}

export function canReopen(resolvedAt: Date | null, days: number, now = new Date()) {
  return (
    !!resolvedAt && now.getTime() - resolvedAt.getTime() <= days * 86400000 && now >= resolvedAt
  );
}
