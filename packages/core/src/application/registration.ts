import { randomUUID } from 'node:crypto';
import { db } from '@niticket/database';
import { registrationSchema } from '../validation';
import { getAuth, hashPassword } from '../infrastructure/auth';
import { settings } from './settings';
import { fail } from '../domain/errors';
import { transaction } from '../infrastructure/transaction';

export async function registerStudent(input: unknown) {
  const data = registrationSchema.parse(input);
  const policy = await settings();
  const domain = data.email.split('@')[1];
  if (!policy.studentEmailDomains.includes(domain))
    fail(
      'VALIDATION',
      400,
      `ثبت‌نام فقط با ایمیل دانشجویی ${policy.studentEmailDomains.join('، ')} مجاز است.`,
    );
  const password = await hashPassword(data.password);
  await transaction(async (tx) => {
    const exists = await tx.user.findFirst({
      where: {
        OR: [
          { email: data.email },
          { studentNumber: data.studentNumber },
          { username: data.studentNumber },
        ],
      },
      select: { email: true, role: true },
    });
    if (exists) return;
    const id = randomUUID();
    await tx.user.create({
      data: {
        id,
        name: data.name,
        email: data.email,
        studentNumber: data.studentNumber,
        username: data.studentNumber,
        displayUsername: data.studentNumber,
        role: 'STUDENT',
        accountType: 'STUDENT',
        emailVerified: false,
        accounts: { create: { accountId: id, providerId: 'credential', password } },
      },
    });
    await tx.auditLog.create({
      data: { actorId: id, action: 'STUDENT_REGISTERED', resourceId: id, metadata: {} },
    });
  });
  const user = await db.user.findUnique({
    where: { email: data.email },
    select: { role: true, emailVerified: true, studentNumber: true },
  });
  if (user?.role === 'STUDENT' && !user.emailVerified && user.studentNumber === data.studentNumber)
    await getAuth().api.sendVerificationEmail({
      body: { email: data.email, callbackURL: process.env.APP_ORIGIN + '/login?verified=1' },
    });
  return {
    message:
      'اگر اطلاعات ثبت‌نام معتبر باشد، پیوند تأیید به ایمیل دانشجویی شما ارسال می‌شود. صندوق ورودی و پوشه هرزنامه را بررسی کنید.',
  };
}
