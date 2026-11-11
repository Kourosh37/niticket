import { expect, it } from 'vitest';
import { searchReturnPath } from '../../apps/web/src/lib/search';

it('keeps inline search return links on allowed local pages', () => {
  for (const path of [
    '/?q=test',
    '/workspace?q=test&view=action',
    '/search?q=test',
    '/admin/users?q=test',
    '/saved-replies',
  ])
    expect(searchReturnPath(path)).toBe(path);
  for (const path of [
    undefined,
    '//evil.test',
    '/\\evil.test',
    'https://evil.test',
    '/api/auth/sign-out',
    '/search?' + 'q'.repeat(2200),
  ])
    expect(searchReturnPath(path)).toBeUndefined();
});
