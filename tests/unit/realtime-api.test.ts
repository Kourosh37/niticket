import { afterEach, expect, it, vi } from 'vitest';
import { api } from '@niticket/core/http/api';

const { rateLimit } = vi.hoisted(() => ({ rateLimit: vi.fn(async () => true) }));
vi.mock('@niticket/core/application/context', () => ({
  actorFromHeaders: async () => ({ id: 'actor' }),
}));
vi.mock('@niticket/core/infrastructure/redis', () => ({ rateLimit }));
afterEach(() => vi.clearAllMocks());

it.each([
  ['/api/v1/events', 'stream', 30],
  ['/api/v1/tickets/id/sync?since=1', 'sync', 600],
  ['/api/v1/tickets/id/receipts?ids=id', 'sync', 600],
  ['/api/v1/notifications/count', 'sync', 600],
  ['/api/v1/uploads/statuses?ids=id', 'sync', 600],
  ['/api/v1/inbox/revision', 'sync', 600],
  ['/api/v1/tickets/id/history', 'read', 180],
])('isolates the rate budget for %s', async (path, bucket, limit) => {
  const response = await api(new Request(`http://localhost${path}`), async () => ({ ok: true }));
  expect(response.status).toBe(200);
  expect(rateLimit).toHaveBeenCalledWith(`actor:${bucket}`, limit, 60);
});

it('preserves no-transform and unbuffered headers for SSE while ordinary JSON stays uncached', async () => {
  const stream = await api(
    new Request('http://localhost/api/v1/events'),
    async () =>
      new Response('', {
        headers: { 'content-type': 'text/event-stream; charset=utf-8', 'x-accel-buffering': 'no' },
      }),
  );
  expect(stream.headers.get('cache-control')).toBe('no-store, no-transform');
  expect(stream.headers.get('x-accel-buffering')).toBe('no');
  expect(stream.headers.get('x-request-id')).toBeTruthy();
  const normal = await api(new Request('http://localhost/api/v1/tickets'), async () => ({}));
  expect(normal.headers.get('cache-control')).toBe('no-store');
});
