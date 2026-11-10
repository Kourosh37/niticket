import { afterEach, expect, it, vi } from 'vitest';
import { api } from '@niticket/core/http/api';
import { AppError } from '@niticket/core/domain/errors';

const { log } = vi.hoisted(() => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@niticket/core/infrastructure/log', () => ({ log }));
vi.mock('@niticket/core/application/context', () => ({
  actorFromHeaders: async () => ({ id: 'actor' }),
}));
vi.mock('@niticket/core/infrastructure/redis', () => ({ rateLimit: async () => true }));
afterEach(() => vi.clearAllMocks());

it('logs unexpected error stacks and causes with a request ID while returning a generic response', async () => {
  const error = new Error('Storage request failed', { cause: new Error('Connection reset') });
  const response = await api(new Request('http://localhost/api/v1/tickets'), async () => {
    throw error;
  });
  expect(response.status).toBe(500);
  const body = await response.json();
  expect(JSON.stringify(body)).not.toContain('Storage request failed');
  expect(JSON.stringify(body)).not.toContain('Connection reset');
  expect(log.error).toHaveBeenCalledWith(
    expect.objectContaining({
      requestId: body.requestId,
      category: 'INTERNAL',
      err: error,
    }),
    'Request failed',
  );
});

it('does not attach exception details for expected client errors', async () => {
  const response = await api(new Request('http://localhost/api/v1/tickets'), async () => {
    throw new AppError('FORBIDDEN', 403, 'Denied');
  });
  expect(response.status).toBe(403);
  expect(log.warn.mock.calls[0][0]).not.toHaveProperty('err');
});
