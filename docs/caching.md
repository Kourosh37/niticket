# Caching and invalidation

HTTP remains authoritative for reads and writes. SSE carries invalidation metadata, never private message bodies. Caches accelerate repeated reads; session validation, authorization, mutation limits, upload approval and attachment ownership are checked against current state.

## Storage and budgets

| Layer                                | Budget / lifetime                                          | Contents                                                                |
| ------------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| React server render                  | One render                                                 | Current profile and display policy; no persistent authentication cache  |
| Server process L1                    | 256 entries / 8 MiB, 256 KiB per value                     | Serialized, actor-scoped read models                                    |
| Optional Redis L2                    | Dedicated 64 MiB `allkeys-lfu` instance                    | Same read models and random invalidation epochs                         |
| Catalog                              | 30–90 seconds                                              | Authorized departments, categories and personalized choices             |
| Display policy / responsible profile | 60 seconds                                                 | Presentation data; writes still use fresh policy                        |
| Saved replies                        | 30 seconds                                                 | Authorized lists; sending revalidates the template and files            |
| Reports / counters                   | 15 seconds / 1 second                                      | Actor-scoped report DTOs and small aggregate reads                      |
| Browser query cache                  | 160 entries / 6 MiB                                        | Search 20s, choices / saved replies 30s, message pages 60s              |
| Browser media cache                  | 12 entries / 24 MiB                                        | Approved preview bytes, up to 20 MiB each, 5 minutes                    |
| Parsed Office cache                  | 12 entries / 4 MiB                                         | Versioned parser output, 5 minutes                                      |
| Conversation window                  | Shared query-cache budget, 2 minutes, at most 400 messages | Loaded pages and reading anchor; fresh authorization before restoration |
| Text drafts                          | 32 drafts / 512 KiB memory, tab session storage, 24 hours  | User / ticket / visibility scoped, at most 20,000 characters per draft  |

Server TTLs include small downward jitter. Values exceeding a budget bypass storage. Cache failures and rejected loads are not retained. Concurrent reads share work; canceling one browser consumer does not cancel other consumers. Account changes and logout clear private browser caches and drafts. Drafts are local to a browser tab and contain text only; audio and uploads are not persisted there.

## Redis deployment

`CACHE_REDIS_URL` is optional. Leave it empty to use bounded process-local caching. Docker Compose configures a separate `cache` service; local host processes can use `redis://127.0.0.1:6380`. Production exposes no host cache port. This Redis is disposable and has no persistence. Never point it at the operational Redis used for sessions, OTP, rate limits and BullMQ: those records must not be evicted to make space for cached results.

When a configured cache is unavailable, reads go directly to PostgreSQL. The cache is not a readiness dependency. Short command deadlines and a failure cooldown limit latency. Reconnection rotates a global epoch because changes during an outage cannot be replayed. Background scripts which create a cache connection must call `closeReadCache()` before exiting.

Namespaces include database pathname and queue name, separating test and application data. Keys include current actor identity and active membership roles; raw query text is hashed. No credentials or signed upload URLs are stored. Cached DTO serialization preserves dates, big integers and undefined values without treating user JSON as serialization markers.

## Invalidation and consistency

Domain mutations enqueue their invalidation in the same database transaction as the change. After commit, local entries are invalidated immediately; the outbox publishes shared invalidation before SSE. The worker retries unprocessed events. Never emit invalidation before commit. Direct SQL maintenance must also publish the corresponding domain invalidation or wait for expiry; test fixtures that modify warm shared state follow the same rule.

Tags cover catalog / profiles, settings, reports, departments, users and individual tickets. Random epochs prevent an evicted epoch from making an old cached value valid again. An atomic Redis script checks epochs before storing an in-flight result, while local generations prevent late requests from replacing newer data. Reads fetch current epochs even when L1 has a value. Normal L1 reads need one batched epoch request, rather than one request per tag.

Browser SSE changes invalidate matching query tags. Reconnect discards warm queries before reconciliation. Successful writes and SSE changes briefly force authoritative HTTP reads (`Cache-Control: no-cache`) to avoid racing another process's invalidation. Authentication, permission checks, ticket synchronization and media authorization endpoints are excluded from browser query caching. Historical search pagination retains its existing snapshot semantics. Receipt updates do not change conversation revision semantics.

## Files and public assets

Approved private files and avatars use a strong ETag and `private, no-cache, no-transform`. Every GET, HEAD and conditional request authorizes before returning 200, 206 or 304. Errors remain `no-store`. `If-Range` requires the current strong validator; otherwise the full representation is served. Versioned avatar URLs must match the current avatar attachment. This permits browser reuse without permitting a CDN to store private files. Native audio benefits from conditional HTTP caching; microphone capture is unchanged.

Reopening a retained preview or downloading retained bytes first requests fresh media metadata. A revoked permission or changed content prevents reuse. Byte buffers are copied before transfer to Office workers, so parsing cannot detach the cached source. Office results include file version, MIME and parser version in their key. Original documents remain available for download.

PDF worker, CMaps, standard fonts and WASM live under `/pdf-assets/releases/<pdfjs-version>/` with a one-year immutable public policy. Legacy asset paths remain available without that immutable policy. When upgrading PDF.js in a rolling deployment, retain prior release asset directories in the static asset store/CDN for old open tabs; an isolated fresh image contains only the installed release plus legacy aliases.

Migration `202611130001_private_thumbnails` adds optional derivative metadata. Only after a successful scan does the worker create a bounded 512px WebP thumbnail from an approved image. The private thumbnail endpoint uses the same fresh ownership and visibility checks as the original. Legacy images and failed optional thumbnail conversions fall back to the approved original; thumbnail failure never bypasses scanning. Message copies of saved-reply files preserve their approved derivative. Large previews continue to load original bytes on demand.

## Verification and operations

Start the optional Compose cache, apply migrations to application and `_test` databases, then rebuild the worker before media tests. Run the repository's format, type, lint, unit, integration, production build and browser checks as documented in the README. Browser tests exercise real conditional responses, permission revocation, PDF reuse, reading-position / draft restoration and live catalog invalidation. Unit and integration coverage includes budgets, expiry, serialization, shared-reader cancellation, generation races, epoch eviction, request batching and scanned thumbnails.

Watch cache memory / evictions, PostgreSQL query latency, cache timeouts, outbox delay and media processing failures separately. `readCacheState()` exposes bounded local entry / byte / in-flight counts for diagnostics without content. Redis `INFO memory` and `INFO stats` cover the disposable L2. Benchmark representative cold and warm requests before changing budgets; no fixed performance gain is assumed. Health and access decisions never depend on cache hit rate.
