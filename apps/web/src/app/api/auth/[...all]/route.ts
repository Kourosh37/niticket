import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db } from '@niticket/database';
import { getAuth, verifyDummyPassword } from '@niticket/core/infrastructure/auth';
import { assertOrigin, anonymousKey, readJson } from '@niticket/core/http/api';
import { rateLimit } from '@niticket/core/infrastructure/redis';
import { log } from '@niticket/core/infrastructure/log';
import { AppError, fail } from '@niticket/core/domain/errors';
import { iranianPhoneSchema, otpCodeSchema } from '@niticket/core/domain/phone';
import { issueOtp } from '@niticket/core/application/otp';

export const runtime = 'nodejs';

export const dynamic = 'force-dynamic';

const phoneInput = z.object({ phoneNumber: iranianPhoneSchema }).strict();
const codeInput = phoneInput.extend({ code: otpCodeSchema }).strict();
const passwordInput = phoneInput
  .extend({ password: z.string().min(1).max(128), rememberMe: z.boolean().optional() })
  .strict();
const hashKey = (value: string) => createHash('sha256').update(value).digest('hex');

function invalidCredentials() {
  return Response.json(
    { code: 'INVALID_CREDENTIALS', message: 'شماره موبایل یا رمز عبور معتبر نیست.' },
    { status: 401, headers: { 'cache-control': 'no-store' } },
  );
}

async function sanitize(response: Response) {
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json'))
    return response;
  const body = await response.json();
  if (body?.user)
    body.user = {
      id: body.user.id,
      name: body.user.name,
      image: body.user.image,
      phoneNumber: body.user.phoneNumber,
      phoneNumberVerified: body.user.phoneNumberVerified,
    };
  if (body?.session)
    body.session = {
      id: body.session.id,
      expiresAt: body.session.expiresAt,
      createdAt: body.session.createdAt,
    };
  if (body && typeof body === 'object') delete body.token;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('etag');
  return Response.json(body, { status: response.status, headers });
}

async function handle(request: Request) {
  try {
    assertOrigin(request);
    const path = new URL(request.url).pathname.split('/').slice(3).join('/');
    const allowed =
      request.method === 'GET'
        ? ['get-session']
        : ['phone-number/send-otp', 'phone-number/verify', 'sign-in/phone-number', 'sign-out'];
    if (!allowed.includes(path))
      return Response.json({ message: 'این مسیر در دسترس نیست.' }, { status: 404 });
    if (path === 'get-session') {
      if (!(await rateLimit(`session-ip:${anonymousKey(request)}`, 600, 60)))
        fail('RATE_LIMITED', 429, 'کمی بعد دوباره تلاش کنید.');
      const response = await sanitize(await getAuth().handler(request));
      response.headers.set('cache-control', 'no-store');
      return response;
    }
    if (!(await rateLimit(`auth-ip:${anonymousKey(request)}`, 120, 60)))
      fail('RATE_LIMITED', 429, 'تعداد تلاش‌ها زیاد است. کمی بعد تلاش کنید.');
    const input = await readJson(request, 4096);
    let body: unknown = {};
    if (path === 'phone-number/send-otp') {
      const { phoneNumber } = phoneInput.parse(input);
      return Response.json(await issueOtp(phoneNumber), {
        headers: { 'cache-control': 'no-store' },
      });
    }
    if (path === 'phone-number/verify') {
      const verified = codeInput.parse(input);
      if (!(await rateLimit(`otp-check:${hashKey(verified.phoneNumber)}`, 30, 300)))
        fail('RATE_LIMITED', 429, 'کمی بعد دوباره تلاش کنید.');
      body = { ...verified, disableSession: false };
    }
    if (path === 'sign-in/phone-number') {
      const data = passwordInput.parse(input);
      if (!(await rateLimit(`password-login:${hashKey(data.phoneNumber)}`, 10, 600)))
        fail('RATE_LIMITED', 429, 'تعداد تلاش‌ها زیاد است. می‌توانید با کد یک‌بارمصرف وارد شوید.');
      const user = await db.user.findUnique({
        where: { phoneNumber: data.phoneNumber },
        select: {
          active: true,
          phoneNumberVerified: true,
          accounts: { where: { providerId: 'credential' }, select: { password: true }, take: 1 },
        },
      });
      if (!user?.active || !user.phoneNumberVerified || !user.accounts[0]?.password) {
        await verifyDummyPassword(data.password);
        await db.auditLog.create({
          data: { action: 'AUTH_LOGIN_FAILED', metadata: { method: 'password' } },
        });
        return invalidCredentials();
      }
      body = { phoneNumber: data.phoneNumber, password: data.password, rememberMe: true };
    }
    if (path === 'sign-out') z.object({}).strict().parse(input);
    const forwarded = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(body),
    });
    const session =
      path === 'sign-out' ? await getAuth().api.getSession({ headers: request.headers }) : null;
    const response = await sanitize(await getAuth().handler(forwarded));
    response.headers.set('cache-control', 'no-store');
    if (session && response.ok)
      await db.auditLog.create({
        data: { actorId: session.user.id, action: 'AUTH_LOGOUT', metadata: {} },
      });
    if ((path === 'sign-in/phone-number' || path === 'phone-number/verify') && !response.ok)
      await db.auditLog.create({
        data: {
          action: 'AUTH_LOGIN_FAILED',
          metadata: { method: path === 'phone-number/verify' ? 'otp' : 'password' },
        },
      });
    if (path === 'sign-in/phone-number' && !response.ok && response.status < 500)
      return invalidCredentials();
    return response;
  } catch (error) {
    if (error instanceof AppError)
      return Response.json(
        { code: error.code, message: error.message },
        { status: error.status, headers: { 'cache-control': 'no-store' } },
      );
    if (error instanceof z.ZodError)
      return Response.json(
        { message: 'شماره موبایل، کد یا رمز واردشده معتبر نیست.' },
        { status: 400 },
      );
    log.error(
      { operation: 'auth_request', category: error instanceof Error ? error.name : 'unknown' },
      'Auth request failed',
    );
    return Response.json({ message: 'سرویس ورود موقتاً در دسترس نیست.' }, { status: 503 });
  }
}

export { handle as GET, handle as POST };
