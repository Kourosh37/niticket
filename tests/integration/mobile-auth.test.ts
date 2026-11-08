import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { db } from '@niticket/database';
import { issueOtp, consumeOtp } from '@niticket/core/application/otp';
import * as sms from '@niticket/core/infrastructure/sms';
import { config } from '@niticket/core/infrastructure/config';
import { redis } from '@niticket/core/infrastructure/redis';
import { actorFromHeaders } from '@niticket/core/application/context';
import {
  setPassword,
  reauthenticate,
  sendReauthenticationCode,
} from '@niticket/core/application/credentials';
import { getProfile } from '@niticket/core/application/administration';
import { POST, GET } from '../../apps/web/src/app/api/auth/[...all]/route';
import { fixtures } from '../helpers/fixtures';
import { synchronizeRootAdministrator } from '@niticket/core/application/mobile-identity';

beforeAll(async () => {
  if (config().ADMIN_PHONE) await synchronizeRootAdministrator();
});

const codes = new Map<string, string>();
vi.spyOn(sms, 'sendOtpSms').mockImplementation(async (phone, code) => {
  codes.set(phone, code);
});
const phone = () => `+989${randomInt(100000000, 999999999)}`;

function call(path: string, body?: object, cookie = '', origin = config().APP_ORIGIN) {
  const request = new Request(`${config().BETTER_AUTH_URL}/api/auth/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'content-type': 'application/json',
      origin,
      cookie,
      'x-real-ip': `198.51.100.${randomInt(1, 254)}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return body ? POST(request) : GET(request);
}

function cookieOf(response: Response) {
  return response.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; ');
}

afterAll(async () => {
  vi.restoreAllMocks();
  await db.$disconnect();
  await redis().quit();
});

it('uses hashed, expiring, atomic and single-use challenges and enforces resend cooldown', async () => {
  const number = phone();
  const before = new Set(await redis().keys('otp:*'));
  await issueOtp(number);
  const key = (await redis().keys('otp:*')).find((k) => !before.has(k) && !k.endsWith(':resend'))!;
  const code = codes.get(number)!;
  expect(await redis().hget(key, 'digest')).toMatch(/^[a-f0-9]{64}$/);
  expect(await redis().hget(key, 'digest')).not.toBe(code);
  expect(await redis().ttl(key)).toBeGreaterThan(290);
  await expect(issueOtp(number.replace('+98', '0'))).rejects.toMatchObject({
    code: 'OTP_COOLDOWN',
  });
  const results = await Promise.allSettled(
    Array.from({ length: 4 }, () => consumeOtp(number, code)),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  await expect(consumeOtp(number, code)).rejects.toMatchObject({ code: 'INVALID_OTP' });
});

it('locks a challenge after five incorrect guesses and binds step-up codes to the session and purpose', async () => {
  const number = phone();
  await issueOtp(number);
  const code = codes.get(number)!,
    wrong = code === '000000' ? '000001' : '000000';
  for (let i = 0; i < 5; i++) await expect(consumeOtp(number, wrong)).rejects.toThrow();
  await expect(consumeOtp(number, code)).rejects.toThrow();
  await issueOtp(number, 'reauth', 'session-a');
  const stepup = codes.get(number)!;
  await expect(consumeOtp(number, stepup)).rejects.toThrow();
  await expect(consumeOtp(number, stepup, 'reauth', 'session-b')).rejects.toThrow();
  await expect(consumeOtp(number, stepup, 'reauth', 'session-a')).resolves.toBe(number);
});

it('rejects expired challenges and limits sends across different sessions and purposes', async () => {
  const number = phone();
  const before = new Set(await redis().keys('otp:*'));
  await issueOtp(number);
  const code = codes.get(number)!;
  const key = (await redis().keys('otp:*')).find((k) => !before.has(k) && !k.endsWith(':resend'))!;
  await redis().expire(key, 0);
  await expect(consumeOtp(number, code)).rejects.toThrow();
  for (let i = 0; i < 4; i++) await issueOtp(number, 'reauth', `bound-${i}`);
  await expect(issueOtp(number, 'reauth', 'bound-5')).rejects.toMatchObject({
    code: 'RATE_LIMITED',
  });
});

it('grants the configured root role only after its OTP and keeps provisioning idempotent', async () => {
  const number = config().ADMIN_PHONE;
  if (!number) return; // CI may omit a deployment administrator number.
  expect((await call('phone-number/send-otp', { phoneNumber: number })).status).toBe(200);
  const before = await db.auditLog.count({ where: { action: 'ROOT_MOBILE_CONFIGURED' } });
  expect(
    (await call('phone-number/verify', { phoneNumber: number, code: codes.get(number) })).status,
  ).toBe(200);
  const root = await db.user.findUniqueOrThrow({ where: { phoneNumber: number } });
  expect(root).toMatchObject({ isAdmin: true, role: 'ADMIN', phoneNumberVerified: true });
  const { ensureRootIdentity } = await import('@niticket/core/application/mobile-identity');
  await ensureRootIdentity(number);
  expect(await db.user.count({ where: { phoneNumber: number, isAdmin: true } })).toBe(1);
  expect(
    await db.auditLog.count({ where: { action: 'ROOT_MOBILE_CONFIGURED' } }),
  ).toBeLessThanOrEqual(before + 1);
});

it('creates a phone-only account after OTP, returns private persistent cookies and rejects replay and mass assignment', async () => {
  const number = phone();
  expect((await call('phone-number/send-otp', { phoneNumber: number })).status).toBe(200);
  expect(await db.user.findUnique({ where: { phoneNumber: number } })).toBeNull();
  const code = codes.get(number)!;
  expect(
    (await call('phone-number/verify', { phoneNumber: number, code, isAdmin: true })).status,
  ).toBe(400);
  const verified = await call('phone-number/verify', { phoneNumber: number, code });
  expect(verified.status).toBe(200);
  const data = await verified.json();
  expect(data.user.phoneNumber).toBe(number);
  expect(JSON.stringify(data)).not.toContain('email');
  expect(data.token).toBeUndefined();
  expect(verified.headers.get('set-cookie')).toMatch(/HttpOnly/i);
  expect(verified.headers.get('set-cookie')).toMatch(/Max-Age=2592000/i);
  const cookie = cookieOf(verified),
    actor = await actorFromHeaders(new Headers({ cookie }));
  expect(actor).toMatchObject({ isAdmin: false, role: 'STUDENT' });
  expect((await getProfile(actor)).hasPassword).toBe(false);
  expect((await call('phone-number/verify', { phoneNumber: number, code })).ok).toBe(false);
  const profile = await call('get-session', undefined, cookie);
  expect(profile.status).toBe(200);
  expect(JSON.stringify(await profile.json())).not.toContain('email');
  await setPassword(actor, { newPassword: 'A very long password 123!' });
  expect((await getProfile(actor)).hasPassword).toBe(true);
  expect(
    (
      await call('sign-in/phone-number', {
        phoneNumber: number.replace('+98', '0'),
        password: 'A very long password 123!',
      })
    ).status,
  ).toBe(200);
});

it('blocks email auth, cross-origin requests, inactive accounts and unknown password identities', async () => {
  expect(
    (await call('sign-in/email', { email: 'user@example.test', password: 'anything' })).status,
  ).toBe(404);
  expect(
    (await call('phone-number/send-otp', { phoneNumber: phone() }, '', 'https://evil.example'))
      .status,
  ).toBe(403);
  expect(
    (await call('sign-in/phone-number', { phoneNumber: phone(), password: 'incorrect' })).status,
  ).toBe(401);
  const f = await fixtures();
  await db.user.update({ where: { id: f.student.id }, data: { active: false } });
  expect(
    (
      await call('sign-in/phone-number', {
        phoneNumber: f.student.phoneNumber,
        password: f.password,
      })
    ).status,
  ).toBe(401);
  await issueOtp(f.student.phoneNumber!);
  expect(
    (
      await call('phone-number/verify', {
        phoneNumber: f.student.phoneNumber,
        code: codes.get(f.student.phoneNumber!),
      })
    ).ok,
  ).toBe(false);
  expect(await db.session.count({ where: { userId: f.student.id } })).toBe(0);
});

it('returns identical failures for existing and unknown password accounts and shares limits across phone formats', async () => {
  const f = await fixtures(),
    number = phone();
  const unknown = await call('sign-in/phone-number', {
    phoneNumber: number,
    password: 'incorrect-password',
  });
  const existing = await call('sign-in/phone-number', {
    phoneNumber: f.student.phoneNumber,
    password: 'incorrect-password',
  });
  expect(existing.status).toBe(unknown.status);
  expect(await existing.json()).toEqual(await unknown.json());
  for (let i = 1; i < 10; i++)
    expect(
      (
        await call('sign-in/phone-number', {
          phoneNumber: i % 2 ? number.replace('+98', '0') : number,
          password: 'incorrect-password',
        })
      ).status,
    ).toBe(401);
  expect(
    (await call('sign-in/phone-number', { phoneNumber: number, password: 'incorrect-password' }))
      .status,
  ).toBe(429);
});

it('fails closed on challenge storage outages and permits retry after a failed SMS transport', async () => {
  const number = phone();
  const evaluation = vi
    .spyOn(redis(), 'eval')
    .mockRejectedValueOnce(new Error('Redis unavailable'));
  await expect(issueOtp(number)).rejects.toMatchObject({ code: 'UNAVAILABLE', status: 503 });
  evaluation.mockRestore();
  vi.mocked(sms.sendOtpSms).mockRejectedValueOnce(new Error('Panel unavailable'));
  await expect(issueOtp(number)).rejects.toMatchObject({ code: 'SMS_UNAVAILABLE', status: 503 });
  await expect(issueOtp(number)).resolves.toMatchObject({ expiresIn: 300 });
  await expect(consumeOtp(number, codes.get(number)!)).resolves.toBe(number);
});

it('requires fresh proof for password changes, supports OTP-only step-up and revokes other sessions', async () => {
  const f = await fixtures();
  const login = () =>
    call('sign-in/phone-number', { phoneNumber: f.student.phoneNumber, password: f.password });
  const a = cookieOf(await login()),
    b = cookieOf(await login());
  const actor = await actorFromHeaders(new Headers({ cookie: a }));
  await db.session.update({
    where: { id: actor.sessionId },
    data: { createdAt: new Date(Date.now() - 600000) },
  });
  actor.sessionCreatedAt = new Date(Date.now() - 600000);
  await expect(
    setPassword(actor, { newPassword: 'New password for mobile 123' }),
  ).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
  await sendReauthenticationCode(actor);
  await reauthenticate(actor, { code: codes.get(f.student.phoneNumber!) });
  await setPassword(actor, { newPassword: 'New password for mobile 123' });
  await expect(actorFromHeaders(new Headers({ cookie: b }))).rejects.toThrow();
  await expect(actorFromHeaders(new Headers({ cookie: a }))).resolves.toMatchObject({
    id: f.student.id,
  });
  expect(
    await db.auditLog.count({ where: { actorId: f.student.id, action: 'PASSWORD_SET' } }),
  ).toBe(1);
});

it('refreshes the persistent browser cookie after a day without extending a server-only read', async () => {
  const f = await fixtures();
  const logged = await call('sign-in/phone-number', {
    phoneNumber: f.student.phoneNumber,
    password: f.password,
  });
  const cookie = cookieOf(logged),
    actor = await actorFromHeaders(new Headers({ cookie }));
  const oldExpiry = new Date(Date.now() + 28 * 86400000);
  await db.session.update({
    where: { id: actor.sessionId },
    data: { expiresAt: oldExpiry, updatedAt: new Date(Date.now() - 2 * 86400000) },
  });
  await actorFromHeaders(new Headers({ cookie }));
  expect(
    (await db.session.findUniqueOrThrow({ where: { id: actor.sessionId } })).expiresAt,
  ).toEqual(oldExpiry);
  const refreshed = await call('get-session', undefined, cookie);
  expect(refreshed.headers.get('set-cookie')).toMatch(/Max-Age=2592000/i);
  expect(
    (await db.session.findUniqueOrThrow({ where: { id: actor.sessionId } })).expiresAt.getTime(),
  ).toBeGreaterThan(Date.now() + 29 * 86400000);
});
