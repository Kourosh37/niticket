import { afterAll, expect, it } from 'vitest';
import { randomUUID, randomInt } from 'node:crypto';
import { db } from '@niticket/database';
import {
  synchronizeRootAdministrator,
  ensureRootIdentity,
} from '@niticket/core/application/mobile-identity';
import { config } from '@niticket/core/infrastructure/config';
import { hashPassword } from '@niticket/core/infrastructure/auth';
import { fixtures } from '../helpers/fixtures';

const phone = () => `+989${randomInt(100000000, 999999999)}`;
afterAll(async () => {
  if (config().ADMIN_PHONE) await synchronizeRootAdministrator();
  await db.$disconnect();
});

it('provisions an OTP-only root once, normalizes the configured phone and preserves sessions on unchanged startup', async () => {
  const number = phone();
  const first = await synchronizeRootAdministrator(number.replace('+98', '0'));
  const root = await db.user.findUniqueOrThrow({ where: { id: first.userId } });
  expect(root).toMatchObject({
    phoneNumber: number,
    isAdmin: true,
    role: 'ADMIN',
    phoneNumberVerified: false,
  });
  expect(await db.account.count({ where: { userId: root.id } })).toBe(0);
  await db.user.update({ where: { id: root.id }, data: { phoneNumberVerified: true } });
  const session = await db.session.create({
    data: { userId: root.id, token: randomUUID(), expiresAt: new Date(Date.now() + 86400000) },
  });
  const account = await db.account.create({
    data: {
      userId: root.id,
      accountId: root.id,
      providerId: 'credential',
      password: await hashPassword(randomUUID()),
    },
  });
  const results = await Promise.all(
    Array.from({ length: 3 }, () => synchronizeRootAdministrator(number)),
  );
  expect(results.every((result) => !result.changed && result.userId === root.id)).toBe(true);
  expect(await db.session.findUnique({ where: { id: session.id } })).not.toBeNull();
  expect(await db.account.findUnique({ where: { id: account.id } })).not.toBeNull();
  expect((await db.user.findUniqueOrThrow({ where: { id: root.id } })).phoneNumberVerified).toBe(
    true,
  );
  expect(
    await db.auditLog.count({ where: { action: 'ROOT_MOBILE_CONFIGURED', resourceId: root.id } }),
  ).toBe(1);
});

it('transfers root authority to an existing identity, revokes both old session sets and keeps ordinary data', async () => {
  const f = await fixtures(),
    old = await synchronizeRootAdministrator(phone());
  const ticket = await db.ticket.create({
    data: {
      creatorId: f.student.id,
      departmentId: f.department.id,
      subject: 'preserve identity on root transfer',
    },
  });
  await db.session.createMany({
    data: [old.userId, f.student.id].map((userId) => ({
      userId,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 86400000),
    })),
  });
  const next = await synchronizeRootAdministrator(f.student.phoneNumber!);
  expect(next).toEqual({ userId: f.student.id, changed: true });
  expect(await db.session.count({ where: { userId: { in: [old.userId, f.student.id] } } })).toBe(0);
  expect(
    await db.account.count({ where: { userId: f.student.id, providerId: 'credential' } }),
  ).toBe(0);
  expect(await db.user.findUniqueOrThrow({ where: { id: old.userId } })).toMatchObject({
    isAdmin: false,
    role: 'STUDENT',
  });
  expect(await db.user.findUniqueOrThrow({ where: { id: f.student.id } })).toMatchObject({
    isAdmin: true,
    role: 'ADMIN',
    phoneNumberVerified: false,
  });
  expect((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).creatorId).toBe(
    f.student.id,
  );
  await synchronizeRootAdministrator(f.agent.phoneNumber!);
  await synchronizeRootAdministrator(phone());
  expect(await db.user.findUniqueOrThrow({ where: { id: f.agent.id } })).toMatchObject({
    isAdmin: false,
    role: 'STAFF',
    phoneNumber: f.agent.phoneNumber,
  });
});

it('requires OTP proof for the startup root and prevents a stale process from reclaiming an old configured number', async () => {
  const configured = config().ADMIN_PHONE;
  if (!configured) return;
  const current = await synchronizeRootAdministrator();
  await ensureRootIdentity(configured);
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: current.userId } })).phoneNumberVerified,
  ).toBe(true);
  const replacement = await synchronizeRootAdministrator(phone());
  await expect(ensureRootIdentity(configured)).rejects.toMatchObject({
    code: 'UNAVAILABLE',
    status: 503,
  });
  expect((await db.user.findUniqueOrThrow({ where: { id: current.userId } })).isAdmin).toBe(false);
  expect((await db.user.findUniqueOrThrow({ where: { id: replacement.userId } })).isAdmin).toBe(
    true,
  );
  await expect(synchronizeRootAdministrator('')).rejects.toThrow('ADMIN_PHONE');
});
