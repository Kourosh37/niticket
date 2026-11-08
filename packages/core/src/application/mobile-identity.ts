import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { type Prisma } from '@niticket/database';
import { config } from '../infrastructure/config';
import { transaction } from '../infrastructure/transaction';
import { fail } from '../domain/errors';
import { iranianPhoneSchema } from '../domain/phone';
import { uuid } from '../validation';

const ROOT_KEY = 'root-administrator';
const rootStateSchema = z.object({ userId: uuid, phoneNumber: iranianPhoneSchema }).strict();

export function internalIdentityEmail() {
  return `${randomUUID()}@identity.niticket.invalid`;
}

async function rootState(tx: Prisma.TransactionClient) {
  const row = await tx.systemSetting.findUnique({ where: { key: ROOT_KEY } });
  return row ? rootStateSchema.parse(row.value) : null;
}

async function reconcileRoot(tx: Prisma.TransactionClient, phoneNumber: string, verified: boolean) {
  const state = await rootState(tx);
  // Recognize the root provisioned by older releases without adopting unrelated administrators.
  const legacy = state
    ? null
    : await tx.auditLog.findFirst({
        where: { action: 'ROOT_MOBILE_CONFIGURED' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { resourceId: true },
      });
  const previousId = state?.userId ?? legacy?.resourceId ?? undefined;
  let target = await tx.user.findUnique({ where: { phoneNumber } });
  if (
    state?.phoneNumber === phoneNumber &&
    state.userId === target?.id &&
    target.active &&
    target.isAdmin &&
    target.role === 'ADMIN'
  )
    return { userId: target.id, changed: false };

  if (previousId && previousId !== target?.id) {
    const previous = await tx.user.findUnique({
      where: { id: previousId },
      select: { isAdmin: true, role: true },
    });
    if (previous) {
      await tx.session.deleteMany({ where: { userId: previousId } });
      await tx.account.deleteMany({ where: { userId: previousId, providerId: 'credential' } });
      if (previous.isAdmin || previous.role === 'ADMIN') {
        const staff = await tx.departmentMembership.count({
          where: { userId: previousId, active: true, department: { active: true } },
        });
        await tx.user.update({
          where: { id: previousId },
          data: {
            isAdmin: false,
            role: staff ? 'STAFF' : 'STUDENT',
            accountType: staff ? 'STAFF' : 'STUDENT',
          },
        });
      }
    }
  }

  if (target) {
    await tx.session.deleteMany({ where: { userId: target.id } });
    await tx.account.deleteMany({ where: { userId: target.id, providerId: 'credential' } });
    target = await tx.user.update({
      where: { id: target.id },
      data: {
        active: true,
        isAdmin: true,
        role: 'ADMIN',
        accountType: 'STAFF',
        phone: phoneNumber,
        phoneNumberVerified: verified,
      },
    });
  } else {
    target = await tx.user.create({
      data: {
        name: 'مدیر سامانه',
        email: internalIdentityEmail(),
        phoneNumber,
        phone: phoneNumber,
        phoneNumberVerified: verified,
        isAdmin: true,
        role: 'ADMIN',
        accountType: 'STAFF',
        emailNotifications: false,
      },
    });
  }
  const value = { userId: target.id, phoneNumber };
  await tx.systemSetting.upsert({
    where: { key: ROOT_KEY },
    create: { key: ROOT_KEY, value, updatedBy: target.id },
    update: { value, updatedBy: target.id },
  });
  await tx.auditLog.create({
    data: {
      actorId: target.id,
      action: 'ROOT_MOBILE_CONFIGURED',
      resourceId: target.id,
      metadata: { previousRootId: previousId ?? null },
    },
  });
  return { userId: target.id, changed: true };
}

/** Startup is idempotent; rotating the configured number never renames another person's identity. */
export async function synchronizeRootAdministrator(phoneInput = config().ADMIN_PHONE) {
  if (!phoneInput) throw new Error('ADMIN_PHONE is required to synchronize the administrator.');
  const phoneNumber = iranianPhoneSchema.parse(phoneInput);
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(7149821)`;
    return reconcileRoot(tx, phoneNumber, false);
  });
}

/** Called only after OTP proof. A stale process must never reclaim a root transferred at startup. */
export async function ensureRootIdentity(phoneInput: string) {
  const phoneNumber = iranianPhoneSchema.parse(phoneInput);
  if (!config().ADMIN_PHONE || phoneNumber !== config().ADMIN_PHONE) return;
  await transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(7149821)`;
    const state = await rootState(tx);
    if (!state) {
      await reconcileRoot(tx, phoneNumber, true);
      return;
    }
    if (state.phoneNumber !== phoneNumber)
      fail(
        'UNAVAILABLE',
        503,
        'تنظیمات مدیر تغییر کرده است؛ سرویس را با تنظیمات جدید راه‌اندازی کنید.',
      );
    const user = await tx.user.findUnique({ where: { id: state.userId } });
    if (!user?.active || user.phoneNumber !== phoneNumber || !user.isAdmin || user.role !== 'ADMIN')
      fail('UNAUTHENTICATED', 401, 'ورود به حساب امکان‌پذیر نیست.');
    if (!user.phoneNumberVerified) {
      await tx.user.update({ where: { id: user.id }, data: { phoneNumberVerified: true } });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: 'ROOT_MOBILE_VERIFIED',
          resourceId: user.id,
          metadata: {},
        },
      });
    }
  });
}
