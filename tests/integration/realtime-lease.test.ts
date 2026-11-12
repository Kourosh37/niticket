import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { acquireRealtimeLease } from '@niticket/core/infrastructure/realtime-lease';
import { realtimeNamespace } from '@niticket/core/infrastructure/realtime';
import { redis } from '@niticket/core/infrastructure/redis';

afterAll(() => redis().disconnect());

it('enforces the account cap across sessions and restores capacity after idempotent release', async () => {
  const user = randomUUID();
  const leases = [];
  try {
    for (let i = 0; i < 10; i++) leases.push(await acquireRealtimeLease(user, randomUUID()));
    await expect(acquireRealtimeLease(user, randomUUID())).rejects.toMatchObject({ status: 429 });
    await leases[0].release();
    await leases[0].release();
    leases.push(await acquireRealtimeLease(user, randomUUID()));
    expect(await leases.at(-1)!.renew()).toBe(true);
  } finally {
    await Promise.all(leases.map((lease) => lease.release()));
  }
  expect(await redis().zcard(`${realtimeNamespace()}:user:${user}`)).toBe(0);
});

it('reclaims expired crashed-process leases and refuses renewal after a lease is lost', async () => {
  const user = randomUUID(),
    session = randomUUID();
  const keys = [`${realtimeNamespace()}:user:${user}`, `${realtimeNamespace()}:session:${session}`];
  for (const key of keys) await redis().zadd(key, Date.now() - 1, 'crashed');
  const lease = await acquireRealtimeLease(user, session);
  try {
    expect(await redis().zcard(keys[0])).toBe(1);
    expect(await redis().pttl(keys[0])).toBeGreaterThan(40000);
    expect(await lease.renew()).toBe(true);
    await redis().del(keys[1]);
    expect(await lease.renew()).toBe(false);
  } finally {
    await lease.release();
    await redis().del(...keys);
  }
  expect(await lease.renew()).toBe(false);
});
