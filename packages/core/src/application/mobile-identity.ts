import { randomUUID } from 'node:crypto';
import { config } from '../infrastructure/config';
import { transaction } from '../infrastructure/transaction';
import { fail } from '../domain/errors';
import { iranianPhoneSchema } from '../domain/phone';

export function internalIdentityEmail() {
  return `${randomUUID()}@identity.niticket.invalid`;
}

/** Called only after successful OTP consumption, never when requesting a code. */
export async function ensureRootIdentity(phoneInput: string) {
  const phoneNumber = iranianPhoneSchema.parse(phoneInput);
  if (!config().ADMIN_PHONE || phoneNumber !== config().ADMIN_PHONE) return;
  await transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(7149821)`;
    let user = await tx.user.findUnique({ where: { phoneNumber } });
    if (!user)
      user = await tx.user.findFirst({
        where: { isAdmin: true, phoneNumber: null },
        orderBy: { createdAt: 'asc' },
      });
    if (user && !user.active) fail('UNAUTHENTICATED', 401, 'ورود به حساب امکان‌پذیر نیست.');
    if (user?.phoneNumber === phoneNumber && user.isAdmin && user.role === 'ADMIN') return;
    const account = user
      ? await tx.user.update({
          where: { id: user.id },
          data: {
            phoneNumber,
            phone: phoneNumber,
            phoneNumberVerified: true,
            isAdmin: true,
            role: 'ADMIN',
            accountType: 'STAFF',
          },
        })
      : await tx.user.create({
          data: {
            name: 'مدیر سامانه',
            email: internalIdentityEmail(),
            phoneNumber,
            phone: phoneNumber,
            phoneNumberVerified: true,
            isAdmin: true,
            role: 'ADMIN',
            accountType: 'STAFF',
            emailNotifications: false,
          },
        });
    await tx.session.deleteMany({ where: { userId: account.id } });
    if (user && user.phoneNumber !== phoneNumber)
      await tx.account.deleteMany({ where: { userId: account.id, providerId: 'credential' } });
    await tx.auditLog.create({
      data: {
        actorId: account.id,
        action: 'ROOT_MOBILE_CONFIGURED',
        resourceId: account.id,
        metadata: {},
      },
    });
  });
}
