import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError } from 'better-auth/api';
import { hash, verify, Algorithm } from '@node-rs/argon2';
import { randomUUID } from 'node:crypto';
import { db } from '@niticket/database';
import { config } from './config';
import { mailer } from './mail';
import { log } from './log';
import { username } from 'better-auth/plugins';
import { asciiDigits } from '../validation';

export function hashPassword(password: string) {
  return hash(password, {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

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
      username({
        minUsernameLength: 3,
        maxUsernameLength: 40,
        usernameNormalization: (value) => asciiDigits(value.trim().toLowerCase()),
        usernameValidator: (value) =>
          /^[a-z0-9][a-z0-9._-]{2,39}$/.test(asciiDigits(value.toLowerCase())),
      }),
    ],
    emailVerification: {
      expiresIn: 3600,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        await mailer().sendMail({
          from: c.SMTP_FROM,
          to: user.email,
          subject: 'تأیید ایمیل دانشجویی نیتیکت',
          text: `برای تکمیل ثبت‌نام دانشجویی، پیوند زیر را باز کنید. این پیوند یک ساعت معتبر است.\n${url}\nاگر ثبت‌نام نکرده‌اید، این پیام را نادیده بگیرید.`,
        });
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      password: { hash: hashPassword, verify: ({ hash, password }) => verify(hash, password) },
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await mailer().sendMail({
          from: c.SMTP_FROM,
          to: user.email,
          subject: 'بازیابی رمز عبور نیتیکت',
          text: `برای بازیابی رمز عبور از این پیوند استفاده کنید:\n${url}\nاگر این درخواست را ثبت نکرده‌اید، این پیام را نادیده بگیرید.`,
        });
      },
    },
    session: { expiresIn: 28800, updateAge: 1800, freshAge: 300, cookieCache: { enabled: false } },
    advanced: {
      database: { generateId: () => randomUUID() },
      useSecureCookies: c.APP_ORIGIN.startsWith('https://'),
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
    },
    rateLimit: {
      enabled: true,
      storage: 'memory',
      window: 60,
      max: 30,
      customRules: {
        '/sign-in/email': { window: 60, max: 10 },
        '/sign-in/username': { window: 60, max: 10 },
      },
    },
    databaseHooks: {
      account: {
        update: {
          after: async (account) => {
            if (account.providerId === 'credential')
              await db.auditLog.create({
                data: {
                  actorId: account.userId,
                  action: 'PASSWORD_CHANGED',
                  resourceId: account.userId,
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
              select: { active: true, emailVerified: true, role: true },
            });
            if (!user?.active)
              throw new APIError('UNAUTHORIZED', { message: 'ورود به حساب امکان‌پذیر نیست.' });
            if (!user.emailVerified)
              throw new APIError('FORBIDDEN', {
                message: 'ابتدا ایمیل دانشجویی خود را تأیید کنید.',
              });
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
