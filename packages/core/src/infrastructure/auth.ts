import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { phoneNumber } from 'better-auth/plugins';
import { APIError } from 'better-auth/api';
import { hash, verify, Algorithm } from '@node-rs/argon2';
import { randomUUID } from 'node:crypto';
import { db } from '@niticket/database';
import { config } from './config';
import { log } from './log';
import { consumeOtp } from '../application/otp';
import { ensureRootIdentity, internalIdentityEmail } from '../application/mobile-identity';
import { AppError } from '../domain/errors';

export function hashPassword(password: string) {
  return hash(password, {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

let instance: ReturnType<typeof createAuth> | undefined;
let dummyHash: Promise<string> | undefined;

export async function verifyDummyPassword(password: string) {
  const digest = await (dummyHash ??= hashPassword(randomUUID()));
  await verify(digest, password);
}

export function getAuth() {
  return (instance ??= createAuth());
}

function createAuth() {
  const c = config();
  return betterAuth({
    appName: 'نیتیکت',
    baseURL: c.BETTER_AUTH_URL,
    secret: c.BETTER_AUTH_SECRET,
    trustedOrigins: [c.APP_ORIGIN],
    database: prismaAdapter(db, { provider: 'postgresql' }),
    plugins: [
      phoneNumber({
        phoneNumberValidator: (value) => /^\+989\d{9}$/.test(value),
        requireVerification: false,
        // Public OTP requests are handled by the shared, hashed Redis challenge service.
        sendOTP: async () => {
          throw new Error('USE_MOBILE_OTP_SERVICE');
        },
        verifyOTP: async ({ phoneNumber, code }) => {
          try {
            await consumeOtp(phoneNumber, code);
            await ensureRootIdentity(phoneNumber);
            return true;
          } catch (error) {
            if (error instanceof AppError && error.status === 400) return false;
            if (error instanceof AppError)
              throw new APIError(error.status === 401 ? 'UNAUTHORIZED' : 'SERVICE_UNAVAILABLE', {
                message: error.message,
              });
            throw error;
          }
        },
        signUpOnVerification: { getTempEmail: internalIdentityEmail, getTempName: () => 'کاربر' },
      }),
    ],
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      password: { hash: hashPassword, verify: ({ hash, password }) => verify(hash, password) },
      revokeSessionsOnPasswordReset: true,
    },
    session: {
      expiresIn: c.SESSION_DAYS * 86400,
      updateAge: 86400,
      freshAge: 300,
      cookieCache: { enabled: false },
    },
    advanced: {
      database: { generateId: () => randomUUID() },
      useSecureCookies: c.APP_ORIGIN.startsWith('https://'),
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
    },
    // Shared IP/phone limits are enforced before the public handler in Redis.
    rateLimit: { enabled: false },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await db.auditLog.create({
              data: {
                actorId: user.id,
                action: 'MOBILE_ACCOUNT_CREATED',
                resourceId: user.id,
                metadata: {},
              },
            });
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const user = await db.user.findUnique({
              where: { id: session.userId },
              select: { active: true, phoneNumberVerified: true, phoneNumber: true },
            });
            if (!user?.active || !user.phoneNumber || !user.phoneNumberVerified)
              throw new APIError('UNAUTHORIZED', { message: 'ورود به حساب امکان‌پذیر نیست.' });
            return { data: session };
          },
          after: async (session) => {
            await db.$transaction([
              db.user.update({ where: { id: session.userId }, data: { lastLoginAt: new Date() } }),
              db.auditLog.create({
                data: { actorId: session.userId, action: 'AUTH_LOGIN', metadata: {} },
              }),
            ]);
          },
        },
      },
    },
    logger: {
      level: 'error',
      log: (level) =>
        log[level === 'warn' ? 'warn' : 'error'](
          { operation: 'auth', category: level },
          'Authentication library event',
        ),
    },
  });
}
