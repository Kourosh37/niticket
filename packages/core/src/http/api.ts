import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '@niticket/database';
import { actorFromHeaders } from '../application/context';
import { AppError, fail } from '../domain/errors';
import { config } from '../infrastructure/config';
import { rateLimit } from '../infrastructure/redis';
import { log } from '../infrastructure/log';
import type { Actor } from '../domain/authorization';

export async function readJson(request: Request, max = 65536): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    fail('VALIDATION', 400, 'قالب درخواست معتبر نیست.');
  const reader = request.body?.getReader();
  if (!reader) return {};
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      fail('TOO_LARGE', 413, 'حجم درخواست بیش از حد مجاز است.');
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    fail('VALIDATION', 400, 'ساختار درخواست معتبر نیست.');
  }
}

export function assertOrigin(request: Request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  const expected = config().APP_ORIGIN;
  const origin = request.headers.get('origin');
  if (origin === expected) return;
  // Standalone Next.js reconstructs Request.url with its internal bind address.
  // The public Host must match configuration exactly; never trust forwarded hosts.
  const host = request.headers.get('host');
  const destinationMatches = host
    ? host === new URL(expected).host
    : new URL(request.url).origin === new URL(expected).origin;
  // Privacy settings can omit Origin or serialize it as null. Fetch Metadata is
  // browser-controlled; accept it only for the configured, same-origin endpoint.
  if (
    (!origin || origin === 'null') &&
    request.headers.get('sec-fetch-site') === 'same-origin' &&
    destinationMatches
  )
    return;
  fail('FORBIDDEN', 403, 'مبدأ درخواست معتبر نیست.');
}

export async function api(request: Request, fn: (actor: Actor) => Promise<unknown>) {
  const requestId = randomUUID();
  const started = performance.now();
  try {
    assertOrigin(request);
    const actor = await actorFromHeaders(request.headers);
    if (
      !(await rateLimit(
        `${actor.id}:${request.method === 'GET' ? 'read' : 'write'}`,
        request.method === 'GET' ? 180 : 40,
        60,
      ))
    )
      fail('RATE_LIMITED', 429, 'تعداد درخواست‌ها زیاد است. کمی بعد تلاش کنید.');
    const result = await fn(actor);
    const response =
      result instanceof Response ? result : Response.json({ data: result, requestId });
    response.headers.set('x-request-id', requestId);
    response.headers.set('cache-control', 'no-store');
    return response;
  } catch (error) {
    let status = 500;
    let code = 'INTERNAL';
    let message = 'عملیات انجام نشد. لطفاً دوباره تلاش کنید.';
    if (error instanceof AppError) {
      status = error.status;
      code = error.code;
      message = error.message;
    } else if (error instanceof z.ZodError) {
      status = 400;
      code = 'VALIDATION';
      message = 'اطلاعات واردشده معتبر نیست. فیلدها را بررسی کنید.';
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        status = 409;
        code = 'CONFLICT';
        message = 'این اطلاعات قبلاً ثبت شده است.';
      } else if (error.code === 'P2025') {
        status = 404;
        code = 'NOT_FOUND';
        message = 'مورد درخواستی یافت نشد.';
      } else if (error.code === 'P2003') {
        status = 400;
        code = 'VALIDATION';
        message = 'اطلاعات مرتبط معتبر نیست.';
      }
    } else if (error instanceof Prisma.PrismaClientInitializationError) {
      status = 503;
      code = 'UNAVAILABLE';
      message = 'سرویس موقتاً در دسترس نیست.';
    }
    log[status >= 500 ? 'error' : 'warn'](
      {
        requestId,
        operation: new URL(request.url).pathname,
        category: code,
        ...(status >= 500
          ? { err: error instanceof Error ? error : new Error('Non-error exception') }
          : {}),
        duration: Math.round(performance.now() - started),
      },
      'Request failed',
    );
    return Response.json(
      { error: { code, message }, requestId },
      { status, headers: { 'x-request-id': requestId, 'cache-control': 'no-store' } },
    );
  } finally {
    log[request.method === 'GET' ? 'debug' : 'info'](
      {
        requestId,
        operation: request.method + ' ' + new URL(request.url).pathname,
        duration: Math.round(performance.now() - started),
      },
      'Request completed',
    );
  }
}

export function anonymousKey(request: Request) {
  return createHash('sha256')
    .update(request.headers.get('x-real-ip') ?? 'direct')
    .digest('hex');
}
