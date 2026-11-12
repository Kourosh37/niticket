import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { BoundedCache } from '../domain/bounded-cache';
import type { Actor } from '../domain/authorization';
import type { RealtimeChange } from '../domain/realtime';
import { config } from './config';

const context = new AsyncLocalStorage<{ bypass: boolean }>();
const local = new BoundedCache<string>({ entries: 256, bytes: 8 * 1024 * 1024 });
const flights = new Map<string, Promise<unknown>>();
let generation = 0,
  client: Redis | undefined,
  unavailableUntil = 0;
const MAX_ENTRY = 256 * 1024;
const STORE = `for i=2,#KEYS do if (redis.call('GET',KEYS[i]) or '0') ~= ARGV[i] then return 0 end end
redis.call('SET',KEYS[1],ARGV[1],'PX',ARGV[#KEYS+1]); return 1`;

export const withReadCache = <T>(bypass: boolean, work: () => T) => context.run({ bypass }, work);

export function cacheNamespace() {
  const c = config();
  return `niticket:${c.QUEUE_NAME}:${new URL(c.DATABASE_URL).pathname}:cache:v1`;
}

export function actorCacheScope(actor: Actor) {
  return [
    actor.id,
    actor.isAdmin,
    actor.role,
    ...actor.memberships
      .filter((m) => m.active)
      .map((m) => `${m.departmentId}:${m.role}`)
      .sort(),
  ].join(':');
}

function connection() {
  const url = config().CACHE_REDIS_URL;
  if (!url || unavailableUntil > Date.now()) return;
  client ??= new Redis(url, {
    maxRetriesPerRequest: 0,
    connectTimeout: 500,
    commandTimeout: 300,
    enableOfflineQueue: false,
    retryStrategy: () => 1000,
  });
  // Keep failures optional: queues/auth use a separate Redis connection.
  if (!client.listenerCount('error')) client.on('error', () => {});
  if (!client.listenerCount('ready'))
    client.on('ready', () => {
      // Changes published while this optional connection was down cannot be replayed.
      local.clear();
      void client
        ?.set(`${cacheNamespace()}:tag:__all`, randomUUID(), 'PX', 86400000)
        .catch(() => {});
    });
  return client.status === 'ready' ? client : undefined;
}

// Tagged nodes preserve Date/BigInt/undefined without interpreting user metadata as tags.
type Node = [string, unknown?];

function pack(value: unknown): Node {
  if (value instanceof Date) return ['date', value.toISOString()];
  if (typeof value === 'bigint') return ['bigint', String(value)];
  if (value === undefined) return ['undefined'];
  if (Array.isArray(value)) return ['array', value.map(pack)];
  if (value && typeof value === 'object')
    return ['object', Object.entries(value).map(([key, item]) => [key, pack(item)])];
  return ['value', value];
}

function unpack(node: Node): unknown {
  const [kind, value] = node;
  if (kind === 'date') return new Date(value as string);
  if (kind === 'bigint') return BigInt(value as string);
  if (kind === 'undefined') return undefined;
  if (kind === 'array') return (value as Node[]).map(unpack);
  if (kind === 'object')
    return Object.fromEntries(
      (value as [string, Node][]).map(([key, item]) => [key, unpack(item)]),
    );
  if (kind !== 'value') throw new Error('Invalid cached value');
  return value;
}

export function tagsForChange(change: RealtimeChange) {
  const tags = new Set<string>();
  for (const topic of change.topics) {
    if (['access', 'catalog'].includes(topic)) {
      tags.add('catalog');
      tags.add('profiles');
      tags.add('reports');
    }
    if (topic === 'settings') tags.add('settings');
    if (topic === 'conversation' || topic === 'inbox') tags.add('reports');
    if (change.scope === 'ticket' && topic === 'inbox') tags.add(`user:${change.creatorId}`);
    if (change.scope === 'ticket') tags.add(`ticket:${change.ticketId}`);
    if (change.scope === 'department') tags.add(`department:${change.departmentId}`);
    if (change.scope === 'user') tags.add(`user:${change.userId}`);
  }
  return [...tags];
}

export function invalidateLocalReads(tags: string[]) {
  generation++;
  local.invalidate(tags);
}

export async function invalidateSharedReads(tags: string[]) {
  invalidateLocalReads(tags);
  const shared = connection();
  if (!shared) return;
  try {
    const pipe = shared.pipeline();
    for (const tag of new Set(tags)) {
      const key = `${cacheNamespace()}:tag:${tag}`;
      pipe.set(key, randomUUID(), 'PX', 86400000);
    }
    const results = await pipe.exec();
    if (!results || results.some(([error]) => error)) throw new Error('Cache invalidation failed');
  } catch {
    unavailableUntil = Date.now() + 5000;
  }
}

/** Data cache only: callers must authorize before invoking this function. Never cache ACL decisions. */
export async function cachedRead<T>(
  key: string,
  tags: string[],
  ttl: number,
  load: () => Promise<T>,
): Promise<T> {
  if (context.getStore()?.bypass) return load();
  const sharedConfigured = !!config().CACHE_REDIS_URL;
  const shared = connection();
  if (sharedConfigured && !shared) return load();
  const started = generation;
  const tagKeys = ['__all', ...new Set(tags)].sort().map((tag) => `${cacheNamespace()}:tag:${tag}`);
  let versions: string[] = [];
  try {
    if (shared && tagKeys.length) {
      const current = await shared.mget(...tagKeys);
      // Epochs can be evicted independently of data. Unique replacements
      // prevent eviction from resurrecting an old cache generation.
      if (current.some((value) => value === null)) {
        await Promise.all(
          current.map((value, i) =>
            value === null ? shared.set(tagKeys[i], randomUUID(), 'PX', 86400000, 'NX') : undefined,
          ),
        );
        versions = (await shared.mget(...tagKeys)).map((value) => value ?? randomUUID());
      } else versions = current as string[];
    }
  } catch {
    unavailableUntil = Date.now() + 5000;
    return load();
  }
  const hash = createHash('sha256')
    .update(JSON.stringify([key, versions]))
    .digest('hex');
  const id = `${cacheNamespace()}:data:${hash}`;
  const decode = (value: string) => unpack(JSON.parse(value)) as T;
  const warm = local.get(id);
  if (warm !== undefined) return decode(warm);
  const flightKey = `${id}:${started}`;
  const existing = flights.get(flightKey);
  if (existing) return existing.then((value) => structuredClone(value as T));
  if (flights.size >= 128) return load();
  const task = (async () => {
    if (shared) {
      try {
        const value = await shared.get(id);
        if (value && Buffer.byteLength(value) <= MAX_ENTRY) {
          const result = decode(value);
          // A local hit must not outlive the remote entry's remaining TTL.
          const remaining = await shared.pttl(id);
          if (remaining > 0 && started === generation)
            local.set(id, value, Math.min(ttl, remaining), Buffer.byteLength(value), tags);
          return result;
        }
      } catch {
        /* Corrupt/failed optional cache falls back to the database. */
      }
    }
    const result = await load();
    const value = JSON.stringify(pack(result)),
      size = Buffer.byteLength(value);
    const lifetime = Math.max(1, Math.floor(ttl * (0.9 + Math.random() * 0.1)));
    if (size <= MAX_ENTRY && started === generation) {
      if (shared) {
        try {
          const saved = await shared.eval(
            STORE,
            tagKeys.length + 1,
            id,
            ...tagKeys,
            value,
            ...versions,
            lifetime,
          );
          if (Number(saved) === 1) local.set(id, value, lifetime, size, tags);
        } catch {
          unavailableUntil = Date.now() + 5000;
        }
      } else local.set(id, value, lifetime, size, tags);
    }
    return result;
  })();
  flights.set(flightKey, task);
  try {
    return structuredClone(await task);
  } finally {
    if (flights.get(flightKey) === task) flights.delete(flightKey);
  }
}

export function closeReadCache() {
  client?.disconnect();
  client = undefined;
  local.clear();
  generation++;
}

export function readCacheState() {
  return {
    entries: local.size,
    bytes: local.byteSize,
    sharedReady: client?.status === 'ready',
    flights: flights.size,
  };
}
