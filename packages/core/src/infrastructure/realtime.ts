import Redis from 'ioredis';
import { db, type Prisma } from '@niticket/database';
import { config } from './config';
import { redis } from './redis';
import { afterCommit } from './after-commit';
import { log } from './log';
import { invalidateLocalReads, invalidateSharedReads, tagsForChange } from './read-cache';
import {
  realtimeChangeSchema,
  realtimeEnvelopeSchema,
  type RealtimeChange,
  type RealtimeEnvelope,
} from '../domain/realtime';

const publications = new Set<Promise<unknown>>();

/** Drain post-commit work before CLI/worker shutdown; failed events remain in the outbox. */
export async function drainRealtime() {
  while (publications.size) await Promise.allSettled([...publications]);
}

export function realtimeNamespace() {
  const c = config();
  return `niticket:${c.QUEUE_NAME}:${new URL(c.DATABASE_URL).pathname}:realtime`;
}

export async function publishRealtimeEvent(id: string, payload: unknown) {
  const change = realtimeChangeSchema.parse(payload);
  await invalidateSharedReads(tagsForChange(change));
  await redis().publish(`${realtimeNamespace()}:changes`, JSON.stringify({ id, change }));
  await db.outboxEvent.updateMany({
    where: { id, type: 'REALTIME_INVALIDATION', processedAt: null },
    data: { processedAt: new Date() },
  });
}

export async function enqueueRealtime(tx: Prisma.TransactionClient, input: RealtimeChange) {
  const change = realtimeChangeSchema.parse(input);
  const event = await tx.outboxEvent.create({
    data: { type: 'REALTIME_INVALIDATION', payload: change },
  });
  afterCommit(() => {
    invalidateLocalReads(tagsForChange(change));
    const publication = publishRealtimeEvent(event.id, change)
      .then(() => redis().publish(`${realtimeNamespace()}:work`, 'wake'))
      .catch((error: unknown) => {
        log.warn(
          {
            operation: 'realtime_publish',
            category: error instanceof Error ? error.name : 'unknown',
          },
          'Realtime delivery deferred to outbox',
        );
      });
    publications.add(publication);
    void publication.finally(() => publications.delete(publication));
  });
  return event.id;
}

type Listener = { change: (event: RealtimeEnvelope) => void; disconnect: () => void };
type Hub = { client: Redis; listeners: Set<Listener>; ready: Promise<void> };
const hubs = new Map<string, Hub>();

/** One Redis subscription per web process, shared by all open SSE connections. */
export async function subscribeRealtime(listener: Listener) {
  const key = realtimeNamespace();
  let hub = hubs.get(key);
  if (!hub) {
    const client = new Redis(config().REDIS_URL, {
      lazyConnect: true,
      connectTimeout: 3000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    const listeners = new Set<Listener>();
    const ready = client
      .connect()
      .then(() => client.subscribe(`${key}:changes`))
      .then(() => {});
    hub = { client, listeners, ready };
    hubs.set(key, hub);
    client.on('error', () => {});
    client.on('message', (_channel, data: string) => {
      if (data.length > 8192) return;
      let parsed;
      try {
        parsed = realtimeEnvelopeSchema.safeParse(JSON.parse(data));
      } catch {
        return;
      }
      if (parsed.success) {
        invalidateLocalReads(tagsForChange(parsed.data.change));
        for (const current of [...listeners]) current.change(parsed.data);
      }
    });
    client.on('close', () => {
      // EventSource will reconnect and clients reconcile against HTTP revisions.
      for (const current of [...listeners]) current.disconnect();
    });
    void ready.catch(() => {});
  }
  const current = hub;
  current.listeners.add(listener);
  let removed = false;

  function unsubscribe() {
    if (removed) return;
    removed = true;
    current.listeners.delete(listener);
    if (!current.listeners.size) {
      if (hubs.get(key) === current) hubs.delete(key);
      current.client.disconnect();
    }
  }

  try {
    await current.ready;
  } catch (error) {
    unsubscribe();
    throw error;
  }
  return unsubscribe;
}
