import { afterEach, it, expect, vi } from 'vitest';
import { request, RequestError } from '../../apps/web/src/lib/utils';

afterEach(() => vi.unstubAllGlobals());

it('redirects an expired session before trying to parse the response body', async () => {
  const replace = vi.fn();
  vi.stubGlobal('window', { location: { replace } });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('expired', { status: 401 })));
  await expect(request('/api/v1/users/me')).rejects.toMatchObject({
    code: 'UNAUTHENTICATED',
    message: '',
  });
  expect(replace).toHaveBeenCalledWith('/login');
});

it('preserves a fresh-password challenge without redirecting the active session', async () => {
  const replace = vi.fn();
  vi.stubGlobal('window', { location: { replace } });
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: { code: 'REAUTH_REQUIRED', message: 'تأیید رمز لازم است' } },
          { status: 403 },
        ),
      ),
  );
  await expect(
    request('/api/v1/admin/settings', { method: 'PATCH', body: '{}' }),
  ).rejects.toBeInstanceOf(RequestError);
  expect(replace).not.toHaveBeenCalled();
});

it('keeps an invalid confirmation password separate from session expiry', async () => {
  const replace = vi.fn();
  vi.stubGlobal('window', { location: { replace } });
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: { code: 'INVALID_PASSWORD', message: 'رمز عبور معتبر نیست.' } },
          { status: 400 },
        ),
      ),
  );
  await expect(
    request('/api/v1/reauthenticate', { method: 'POST', body: '{}' }),
  ).rejects.toMatchObject({ code: 'INVALID_PASSWORD', status: 400 });
  expect(replace).not.toHaveBeenCalled();
});
