import { expect, it } from 'vitest';
import { sessionDevice } from '@niticket/core/domain/session-device';

it('labels common devices without treating the user agent as trusted identity', () => {
  expect(
    sessionDevice('Mozilla/5.0 (Linux; Android 16) Chrome/143.0 Mobile Safari/537.36 EdgA/142.0'),
  ).toMatchObject({ browser: 'Edge 142', os: 'Android', kind: 'phone' });
  expect(
    sessionDevice(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1',
    ),
  ).toMatchObject({ browser: 'Safari 18', os: 'iPadOS', kind: 'tablet' });
  expect(sessionDevice('Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Firefox/142.0')).toMatchObject({
    browser: 'Firefox 142',
    os: 'Linux',
    kind: 'desktop',
  });
  expect(sessionDevice('<script>alert(1)</script>')).toEqual({
    browser: 'مرورگر ناشناخته',
    os: 'سیستم‌عامل ناشناخته',
    kind: 'unknown',
  });
  expect(sessionDevice(null).kind).toBe('unknown');
});
