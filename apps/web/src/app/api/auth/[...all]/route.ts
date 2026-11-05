import { getAuth } from '@niticket/core/infrastructure/auth';
import { assertOrigin, anonymousKey } from '@niticket/core/http/api';
import { rateLimit } from '@niticket/core/infrastructure/redis';
import { log } from '@niticket/core/infrastructure/log';
import { AppError } from '@niticket/core/domain/errors';
import { readJson } from '@niticket/core/http/api';
import { createHash } from 'node:crypto';

export const runtime = 'nodejs';

export const dynamic = 'force-dynamic';

async function handle(request: Request) {
  try {
    assertOrigin(request);
    const authPath = new URL(request.url).pathname.split('/').slice(3).join('/');
    if (
      ![
        'sign-in/email',
        'sign-in/username',
        'sign-out',
        'get-session',
        'request-password-reset',
        'reset-password',
        'change-password',
        'send-verification-email',
        'verify-email',
        'error',
      ].includes(authPath)
    )
      return Response.json({ message: 'این مسیر در دسترس نیست.' }, { status: 404 });
    if (!(await rateLimit(`auth:${anonymousKey(request)}`, 30, 60)))
      return Response.json(
        { message: 'تعداد تلاش‌ها زیاد است. کمی بعد تلاش کنید.' },
        { status: 429 },
      );
    let forwarded = request;
    if (request.method === 'POST') {
      let body = await readJson(request, 16384);
      if (
        new URL(request.url).pathname.endsWith('/change-password') &&
        body &&
        typeof body === 'object' &&
        !Array.isArray(body)
      )
        body = { ...body, revokeOtherSessions: true };
      const identifier =
        body && typeof body === 'object' && 'email' in body
          ? String(body.email).trim().toLowerCase()
          : body && typeof body === 'object' && 'username' in body
            ? String(body.username).trim().toLowerCase()
            : '';
      if (
        identifier &&
        !(await rateLimit(
          `auth-account:${createHash('sha256').update(identifier).digest('hex')}`,
          10,
          60,
        ))
      )
        return Response.json(
          { message: 'تعداد تلاش‌ها زیاد است. کمی بعد تلاش کنید.' },
          { status: 429 },
        );
      forwarded = new Request(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(body),
      });
    }
    const logout =
      request.method === 'POST' && new URL(request.url).pathname.endsWith('/sign-out')
        ? await getAuth().api.getSession({ headers: request.headers })
        : null;
    const response = await getAuth().handler(forwarded);
    if (logout && response.ok)
      await import('@niticket/database').then(({ db }) =>
        db.auditLog.create({
          data: { actorId: logout.user.id, action: 'AUTH_LOGOUT', metadata: {} },
        }),
      );
    if (
      request.method === 'POST' &&
      /\/sign-in\/(email|username)$/.test(new URL(request.url).pathname) &&
      !response.ok
    )
      await import('@niticket/database').then(({ db }) =>
        db.auditLog.create({ data: { action: 'AUTH_LOGIN_FAILED', metadata: {} } }),
      );
    return response;
  } catch (error) {
    if (error instanceof AppError)
      return Response.json({ message: error.message }, { status: error.status });
    log.error(
      { operation: 'auth_request', category: error instanceof Error ? error.name : 'unknown' },
      'Auth request failed',
    );
    return Response.json({ message: 'سرویس ورود موقتاً در دسترس نیست.' }, { status: 503 });
  }
}

export { handle as GET, handle as POST };
