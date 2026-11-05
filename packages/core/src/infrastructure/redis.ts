import Redis from 'ioredis';
import { config } from './config';
import { AppError } from '../domain/errors';

let client: Redis | undefined;

export function redis() {
  return (client ??= new Redis(config().REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    lazyConnect: true,
  }));
}

export async function rateLimit(key: string, limit: number, seconds: number) {
  try {
    const count = (await redis().eval(
      "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return n",
      1,
      `rate:${key}`,
      seconds,
    )) as number;
    return count <= limit;
  } catch {
    throw new AppError('UNAVAILABLE', 503, 'سرویس موقتاً در دسترس نیست. دوباره تلاش کنید.');
  }
}
