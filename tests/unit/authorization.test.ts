import { describe, it, expect } from 'vitest';
import {
  canRead,
  isStaff,
  assertManager,
  ticketScope,
  type Actor,
} from '@niticket/core/domain/authorization';
import { assertTransition, canReopen } from '@niticket/core/domain/workflow';

const actor: Actor = {
  id: 'user',
  active: true,
  isAdmin: false,
  memberships: [],
  sessionId: 's',
  sessionCreatedAt: new Date(),
};
describe('resource authorization release gates', () => {
  it('denies another requester and unrelated department', () => {
    expect(canRead(actor, { creatorId: 'other', departmentId: 'd' })).toBe(false);
  });
  it('permits ownership without internal access', () => {
    const t = { creatorId: 'user', departmentId: 'd' };
    expect(canRead(actor, t)).toBe(true);
    expect(isStaff({ ...actor, isAdmin: true }, t)).toBe(false);
  });
  it('isolates agent departments and removes revoked memberships', () => {
    const agent = {
      ...actor,
      memberships: [{ departmentId: 'd', role: 'AGENT' as const, active: true }],
    };
    expect(canRead(agent, { creatorId: 'other', departmentId: 'd' })).toBe(true);
    expect(canRead(agent, { creatorId: 'other', departmentId: 'new' })).toBe(false);
    expect(
      canRead(
        { ...agent, memberships: [{ ...agent.memberships[0], active: false }] },
        { creatorId: 'other', departmentId: 'd' },
      ),
    ).toBe(false);
    expect(() => assertManager(agent, 'd')).toThrow();
  });
  it('never grants disabled administrators visibility', () => {
    expect(
      canRead({ ...actor, isAdmin: true, active: false }, { creatorId: 'user', departmentId: 'd' }),
    ).toBe(false);
    expect(ticketScope({ ...actor, active: false })).toEqual({ id: '__denied__' });
  });
  it('does not retain access after a department transfer', () => {
    const a = {
      ...actor,
      memberships: [{ departmentId: 'old', role: 'MANAGER' as const, active: true }],
    };
    expect(canRead(a, { creatorId: 'other', departmentId: 'new' })).toBe(false);
  });
  it('enforces explicit transitions and terminal closure', () => {
    expect(() => assertTransition('OPEN', 'IN_PROGRESS')).not.toThrow();
    expect(() => assertTransition('CLOSED', 'REOPENED')).toThrow();
    expect(() => assertTransition('OPEN', 'CLOSED')).toThrow();
  });
  it('bounds reopening by resolved timestamp', () => {
    expect(canReopen(new Date('2026-01-01'), 7, new Date('2026-01-07'))).toBe(true);
    expect(canReopen(new Date('2026-01-01'), 7, new Date('2026-01-09'))).toBe(false);
    expect(canReopen(null, 7)).toBe(false);
  });
});
