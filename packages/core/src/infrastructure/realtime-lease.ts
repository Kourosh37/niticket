import { randomUUID } from 'node:crypto';
import { redis } from './redis';
import { realtimeNamespace } from './realtime';
import { fail } from '../domain/errors';

const TTL = 45000;
const ACQUIRE = `
for i=1,2 do redis.call('ZREMRANGEBYSCORE',KEYS[i],'-inf',ARGV[1]) end
if redis.call('ZCARD',KEYS[1]) >= 10 or redis.call('ZCARD',KEYS[2]) >= 3 then return 0 end
for i=1,2 do redis.call('ZADD',KEYS[i],ARGV[2],ARGV[3]); redis.call('PEXPIRE',KEYS[i],45000) end
return 1`;
const RENEW = `
if not redis.call('ZSCORE',KEYS[1],ARGV[2]) or not redis.call('ZSCORE',KEYS[2],ARGV[2]) then return 0 end
for i=1,2 do redis.call('ZADD',KEYS[i],ARGV[1],ARGV[2]); redis.call('PEXPIRE',KEYS[i],45000) end
return 1`;

export async function acquireRealtimeLease(userId: string, sessionId: string) {
  const base = realtimeNamespace(),
    id = randomUUID();
  const keys = [`${base}:user:${userId}`, `${base}:session:${sessionId}`];
  const now = Date.now();
  if (Number(await redis().eval(ACQUIRE, 2, ...keys, now, now + TTL, id)) !== 1)
    fail('RATE_LIMITED', 429, 'تعداد اتصال‌های هم‌زمان زیاد است. چند تب دیگر را ببندید.');
  let released = false;
  return {
    renew: async () => {
      if (released) return false;
      const renewed = Number(await redis().eval(RENEW, 2, ...keys, Date.now() + TTL, id)) === 1;
      // Cancellation can race an in-flight renewal. Do not revive its lease.
      if (released) {
        await Promise.all(keys.map((key) => redis().zrem(key, id)));
        return false;
      }
      return renewed;
    },
    release: async () => {
      if (released) return;
      released = true;
      await Promise.all(keys.map((key) => redis().zrem(key, id)));
    },
  };
}
