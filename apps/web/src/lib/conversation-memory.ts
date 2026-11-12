import { clientCache, onPrivateCacheReset } from './client-cache';
import { BoundedCache } from '@niticket/core/domain/bounded-cache';

export type Draft = {
  body: string;
  visibility: 'PUBLIC' | 'INTERNAL';
  updated: number;
  expires: number;
};

const drafts = new BoundedCache<Draft>({ entries: 32, bytes: 512 * 1024 });
const prefix = 'niticket:draft:v1:';
const lifetime = 24 * 60 * 60 * 1000;

function storage() {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function key(ticket: string, visibility: Draft['visibility']) {
  return `${prefix}${clientCache.scope}:${ticket}:${visibility}`;
}

export function clearTicketDraft(ticket: string) {
  for (const visibility of ['PUBLIC', 'INTERNAL'] as const) {
    const id = key(ticket, visibility);
    drafts.delete(id);
    try {
      storage()?.removeItem(id);
    } catch {
      /* Storage may be unavailable. */
    }
  }
}

export function saveDraft(ticket: string, body: string, visibility: Draft['visibility']) {
  if (!clientCache.scope) return;
  const id = key(ticket, visibility);
  if (!body) {
    drafts.delete(id);
    try {
      storage()?.removeItem(id);
    } catch {}
    return;
  }
  const value: Draft = {
    body: body.slice(0, 20000),
    visibility,
    updated: Date.now(),
    expires: Date.now() + lifetime,
  };
  const encoded = JSON.stringify(value);
  drafts.set(id, value, lifetime, encoded.length * 2);
  try {
    const saved = storage();
    if (!saved) return;
    saved.setItem(id, encoded);
    const others: { key: string; updated: number }[] = [];
    for (const key of Object.keys(saved)) {
      if (key === id || !key.startsWith(`${prefix}${clientCache.scope}:`)) continue;
      try {
        const previous = JSON.parse(saved.getItem(key) ?? 'null') as Draft | null;
        if (!previous || !Number.isFinite(previous.updated) || !(previous.expires > Date.now())) {
          saved.removeItem(key);
          continue;
        }
        others.push({ key, updated: previous.updated });
      } catch {
        saved.removeItem(key);
      }
    }
    // Updating an existing draft does not consume a new slot. Evict by recency, not key order.
    others.sort((a, b) => a.updated - b.updated || a.key.localeCompare(b.key));
    for (const old of others.slice(0, Math.max(0, others.length + 1 - 32)))
      saved.removeItem(old.key);
  } catch {
    /* A quota failure never prevents composing or sending. */
  }
}

export function readDraft(ticket: string, internalAllowed: boolean) {
  if (!clientCache.scope) return null;
  const result: Draft[] = [];
  for (const visibility of ['PUBLIC', 'INTERNAL'] as const) {
    if (visibility === 'INTERNAL' && !internalAllowed) continue;
    const id = key(ticket, visibility);
    let value = drafts.get(id);
    try {
      value ??= (JSON.parse(storage()?.getItem(id) ?? 'null') as Draft | null) ?? undefined;
    } catch {
      /* Ignore corrupt storage. */
    }
    if (
      value &&
      typeof value.body === 'string' &&
      value.body.length <= 20000 &&
      value.visibility === visibility &&
      typeof value.updated === 'number' &&
      typeof value.expires === 'number' &&
      value.expires > Date.now()
    )
      result.push(value);
    else {
      drafts.delete(id);
      try {
        storage()?.removeItem(id);
      } catch {}
    }
  }
  return result.sort((a, b) => b.updated - a.updated)[0] ?? null;
}

onPrivateCacheReset(() => {
  drafts.clear();
  const scope = clientCache.scope;
  if (!scope) return;
  try {
    const saved = storage();
    if (saved)
      for (const id of Object.keys(saved))
        if (id.startsWith(`${prefix}${scope}:`)) saved.removeItem(id);
  } catch {
    /* Privacy cleanup still clears all in-memory state. */
  }
});
