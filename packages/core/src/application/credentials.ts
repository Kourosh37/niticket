import { randomUUID } from 'node:crypto';
import { verify } from '@node-rs/argon2';
import { z } from 'zod';
import { db } from '@niticket/database';
import type { Actor } from '../domain/authorization';
import { fail } from '../domain/errors';
import { otpCodeSchema, passwordSchema } from '../domain/phone';
import { hashPassword, verifyDummyPassword } from '../infrastructure/auth';
import { rateLimit } from '../infrastructure/redis';
import { transaction } from '../infrastructure/transaction';
import { enqueueRealtime } from '../infrastructure/realtime';
import { refreshActor, requireFresh } from './context';
import { consumeOtp, issueOtp } from './otp';

export async function sendReauthenticationCode(actor: Actor) {
  const user = await db.user.findUniqueOrThrow({
    where: { id: actor.id },
    select: { phoneNumber: true },
  });
  if (!user.phoneNumber) fail('UNAUTHENTICATED', 401);
  return issueOtp(user.phoneNumber, 'reauth', actor.sessionId);
}

export async function reauthenticate(actor: Actor, input: unknown) {
  const data = z
    .union([
      z.object({ password: z.string().min(1).max(128) }).strict(),
      z.object({ code: otpCodeSchema }).strict(),
    ])
    .parse(input);
  if (!(await rateLimit(`reauth:${actor.sessionId}`, 10, 300)))
    fail('RATE_LIMITED', 429, 'کمی بعد دوباره تلاش کنید.');
  if ('code' in data) {
    const user = await db.user.findUniqueOrThrow({
      where: { id: actor.id },
      select: { phoneNumber: true },
    });
    if (!user.phoneNumber) fail('UNAUTHENTICATED', 401);
    await consumeOtp(user.phoneNumber, data.code, 'reauth', actor.sessionId);
  } else {
    const account = await db.account.findFirst({
      where: { userId: actor.id, providerId: 'credential' },
    });
    if (!account?.password) {
      await verifyDummyPassword(data.password);
      fail('INVALID_PASSWORD', 400, 'رمز عبور معتبر نیست.');
    }
    if (!(await verify(account.password, data.password)))
      fail('INVALID_PASSWORD', 400, 'رمز عبور معتبر نیست.');
  }
  return transaction(async (tx) => {
    await refreshActor(tx, actor);
    if (
      !(await tx.session.findFirst({
        where: { id: actor.sessionId, userId: actor.id, expiresAt: { gt: new Date() } },
      }))
    )
      fail('UNAUTHENTICATED', 401);
    await tx.reauthentication.upsert({
      where: { sessionId: actor.sessionId },
      create: { sessionId: actor.sessionId, verifiedAt: new Date() },
      update: { verifiedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'REAUTHENTICATED',
        metadata: { method: 'code' in data ? 'otp' : 'password' },
      },
    });
    return { ok: true };
  });
}

export async function setPassword(actor: Actor, input: unknown) {
  const { newPassword } = z.object({ newPassword: passwordSchema }).strict().parse(input);
  await requireFresh(actor);
  if (!(await rateLimit(`password-set:${actor.id}`, 5, 300)))
    fail('RATE_LIMITED', 429, 'کمی بعد دوباره تلاش کنید.');
  const password = await hashPassword(newPassword);
  return transaction(async (tx) => {
    await refreshActor(tx, actor);
    if (
      !(await tx.session.findFirst({
        where: { id: actor.sessionId, userId: actor.id, expiresAt: { gt: new Date() } },
      }))
    )
      fail('UNAUTHENTICATED', 401);
    const account = await tx.account.findFirst({
      where: { userId: actor.id, providerId: 'credential' },
    });
    if (account) await tx.account.update({ where: { id: account.id }, data: { password } });
    else
      await tx.account.create({
        data: {
          id: randomUUID(),
          userId: actor.id,
          providerId: 'credential',
          accountId: actor.id,
          password,
        },
      });
    await tx.session.deleteMany({ where: { userId: actor.id, id: { not: actor.sessionId } } });
    await enqueueRealtime(tx, { scope: 'user', userId: actor.id, topics: ['access'] });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'PASSWORD_SET',
        resourceId: actor.id,
        metadata: { otherSessionsRevoked: true },
      },
    });
    return { ok: true };
  });
}
