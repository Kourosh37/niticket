import { expect, it, vi } from 'vitest';
import { assertOrigin } from '@niticket/core/http/api';

vi.mock('@niticket/core/infrastructure/config', () => ({
  config: () => ({ APP_ORIGIN: 'http://localhost:3000' }),
}));

it.each(['POST', 'PATCH', 'DELETE'])(
  'accepts trusted %s requests using Origin or verified same-origin Fetch Metadata',
  (method) => {
    const cases: Record<string, string>[] = [
      { origin: 'http://localhost:3000' },
      { 'sec-fetch-site': 'same-origin' },
      { origin: 'null', 'sec-fetch-site': 'same-origin' },
    ];
    for (const headers of cases) {
      expect(() =>
        assertOrigin(
          new Request('http://localhost:3000/api/v1/users/me/sessions/device', { method, headers }),
        ),
      ).not.toThrow();
    }
  },
);

const untrustedHeaders: Record<string, string>[] = [
  {},
  { origin: 'null' },
  { 'sec-fetch-site': 'cross-site' },
  { 'sec-fetch-site': 'same-site' },
  { 'sec-fetch-site': 'none' },
  { origin: 'null', 'sec-fetch-site': 'cross-site' },
  { origin: 'https://attacker.example', 'sec-fetch-site': 'same-origin' },
  { origin: 'http://localhost:3000.attacker.example' },
  { origin: 'http://localhost:3001', 'sec-fetch-site': 'same-origin' },
];
it.each(untrustedHeaders)('rejects untrusted or unverifiable mutation headers %j', (headers) => {
  expect(() =>
    assertOrigin(
      new Request('http://localhost:3000/api/v1/users/me/sessions/device', {
        method: 'DELETE',
        headers,
      }),
    ),
  ).toThrow(expect.objectContaining({ status: 403, code: 'FORBIDDEN' }));
});

it('does not accept missing Origin on an unexpected destination even with same-origin metadata', () => {
  expect(() =>
    assertOrigin(
      new Request('https://attacker.example/api/v1/users/me/sessions/device', {
        method: 'DELETE',
        headers: { 'sec-fetch-site': 'same-origin' },
      }),
    ),
  ).toThrow(expect.objectContaining({ status: 403 }));
});

it('accepts a configured public Host when standalone Next reconstructs an internal bind URL', () => {
  expect(() =>
    assertOrigin(
      new Request('http://0.0.0.0:3000/api/v1/users/me/sessions/device', {
        method: 'DELETE',
        headers: { host: 'localhost:3000', 'sec-fetch-site': 'same-origin' },
      }),
    ),
  ).not.toThrow();
});

it.each(['foreign.example', 'localhost:3001', 'localhost:3000.attacker.example'])(
  'rejects unexpected Host %s even when forwarded headers claim the configured host',
  (host) => {
    expect(() =>
      assertOrigin(
        new Request('http://localhost:3000/api/v1/users/me/sessions/device', {
          method: 'DELETE',
          headers: { host, 'x-forwarded-host': 'localhost:3000', 'sec-fetch-site': 'same-origin' },
        }),
      ),
    ).toThrow(expect.objectContaining({ status: 403 }));
  },
);
