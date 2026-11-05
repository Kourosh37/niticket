import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { registerStudent } from '@niticket/core/application/registration';
import { assertOrigin, anonymousKey, readJson } from '@niticket/core/http/api';
import { rateLimit } from '@niticket/core/infrastructure/redis';
import { AppError } from '@niticket/core/domain/errors';

export async function POST(request: Request) {
  const requestId = randomUUID();
  try {
    assertOrigin(request);
    const input = await readJson(request, 8192);
    const email =
      input && typeof input === 'object' && 'email' in input
        ? String(input.email).toLowerCase()
        : '';
    if (
      !(await rateLimit(`register:${anonymousKey(request)}`, 8, 3600)) ||
      !(await rateLimit(
        `register-email:${createHash('sha256').update(email).digest('hex')}`,
        3,
        3600,
      ))
    )
      throw new AppError('RATE_LIMITED', 429, 'تعداد تلاش‌ها زیاد است؛ کمی بعد دوباره تلاش کنید.');
    return Response.json(
      { data: await registerStudent(input), requestId },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    const status =
      error instanceof AppError ? error.status : error instanceof z.ZodError ? 400 : 503;
    const message =
      error instanceof AppError
        ? error.message
        : error instanceof z.ZodError
          ? 'اطلاعات ثبت‌نام معتبر نیست. شماره دانشجویی، ایمیل و رمز عبور را بررسی کنید.'
          : 'ارسال پیوند تأیید انجام نشد. کمی بعد دوباره تلاش کنید.';
    return Response.json(
      { error: { code: 'REGISTRATION_FAILED', message }, requestId },
      { status },
    );
  }
}
