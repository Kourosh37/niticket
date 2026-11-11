import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { savedReplySchema, assertSavedReplyStaff } from '@niticket/core/application/saved-replies';
import { messageSchema, uploadSchema } from '@niticket/core/validation';
import type { Actor } from '@niticket/core/domain/authorization';

it('validates saved replies and accepts either a normal message or a saved reply reference without mass assignment', () => {
  expect(savedReplySchema.parse({ title: ' راهنما ', body: ' متن ' })).toEqual({
    title: 'راهنما',
    body: 'متن',
  });
  expect(savedReplySchema.safeParse({ title: ' ' }).success).toBe(false);
  expect(savedReplySchema.safeParse({ title: 'x', departmentId: randomUUID() }).success).toBe(
    false,
  );
  expect(messageSchema.safeParse({ version: 1, body: '' }).success).toBe(false);
  expect(messageSchema.safeParse({ version: 1, savedReplyId: randomUUID() }).success).toBe(true);
  expect(
    messageSchema.safeParse({ version: 1, body: 'forged', savedReplyId: randomUUID() }).success,
  ).toBe(false);
  expect(messageSchema.safeParse({ version: 1, body: 'normal' }).success).toBe(true);
  expect(
    messageSchema.safeParse({ version: 1, body: 'normal', savedReplyVersion: 2 }).success,
  ).toBe(false);
  for (const mime of ['video/mp4', 'video/webm'])
    expect(
      uploadSchema.safeParse({ ticketId: randomUUID(), filename: 'video', mime, size: 1024 })
        .success,
    ).toBe(true);
});

it('requires an active staff role and an active membership in the template unit', () => {
  const actor: Actor = {
    id: 'staff',
    role: 'STAFF',
    active: true,
    isAdmin: false,
    sessionId: 'session',
    sessionCreatedAt: new Date(),
    memberships: [{ departmentId: 'unit', role: 'AGENT', active: true }],
  };
  expect(() => assertSavedReplyStaff(actor, 'unit')).not.toThrow();
  for (const invalid of [
    { ...actor, active: false },
    { ...actor, role: 'STUDENT' as const },
    { ...actor, isAdmin: true },
    { ...actor, memberships: [] },
  ])
    expect(() => assertSavedReplyStaff(invalid, 'unit')).toThrow();
  expect(() => assertSavedReplyStaff(actor, 'other')).toThrow();
});
