# HTTP and SSE delivery

Writes, uploads, authorization and pagination remain HTTP operations. The authenticated
`GET /api/v1/events` endpoint only announces that HTTP data may have changed. It never
streams message bodies, filenames, signed URLs or recipient lists.

## Commit and delivery

Domain changes and `REALTIME_INVALIDATION` outbox entries commit in the same serializable
transaction. Only successful attempts publish to Redis. An immediate post-commit publish
keeps the request independent of delivery failures; the existing outbox worker retries
unprocessed entries. Successful publication wakes the worker so notification creation and
attachment jobs need not wait for its five-second recovery sweep.

Redis channels include the queue name and database pathname. Every web replica subscribes
once and fans events out to its local streams. Configure the same `DATABASE_URL`,
`QUEUE_NAME` and `REDIS_URL` on all web/worker replicas of an environment. Test processes
use a separate database and `niticket-test` queue, including container-based media scans.

Pub/Sub is not a durable cursor. Repeated invalidations are harmless; `Last-Event-ID`
does not replay messages. Each connection emits `ready`, prompting authorized HTTP
reconciliation. HTTP revision checks and periodic reconciliation cover changes missed
during disconnects or a publish with no listeners. The SQL database remains authoritative.

## Browser behavior

One EventSource belongs to the signed-in shell in each tab and survives client navigation.
Topic subscribers reconcile chat, inbox, unread counts, read receipts, pending attachments
and saved replies. HTTP refreshes coalesce bursts, serialize work and retain a pending
refresh when an event arrives during a request. Chat updates preserve drafts, recording
components, pagination and scroll state. Incoming events never acknowledge a message;
the existing active, focused viewport observation remains the read boundary.

With a healthy stream, most subscribers reconcile every 60 seconds as a safety net.
On streaming failure, chat/inbox/receipt checks resume every five seconds. Notification
counts fall back to 20 seconds; saved-reply lists use 30 seconds (120 seconds when live).
Explicit upload approval remains bounded by its own deadline and also wakes on events.
Browsers without EventSource use HTTP fallback without installing a polyfill.

Reconnects use exponential backoff with jitter, capped at 30 seconds before jitter.
Offline browsers pause connection attempts. The server heartbeats every 15 seconds;
a 45-second stale connection is replaced. Every reconnect reconciles again. Invalid
sessions receive an `auth` event and leave the protected UI; opaque EventSource errors
trigger a separate session check so a network outage does not log out a valid user.

## Access and resource bounds

The stream uses the normal same-origin session cookie. Foreign origins/fetch sites are
rejected. Before each coalesced flush and heartbeat, the server checks the database
session, expiry, active account and current memberships. Ticket access is checked against
the current department, even for delayed events. Internal messages and receipts never
invalidate student streams. Transfers notify the former department to reconcile access
without disclosing the destination conversation. HTTP requests independently reauthorize.

Redis leases cap connections at three per session and ten per account across replicas.
Leases expire after 45 seconds if a process disappears. Streams close after 15 minutes
and reconnect normally. Event batches have a 64-entry limit and outgoing buffers have
a 16 KiB budget; overloaded clients close and reconcile rather than accumulating memory.
Abort, cancellation, Redis disconnect and expiry release subscriptions, timers and leases.
Workers drain post-commit publications before closing database/Redis clients.

Streaming connection attempts, synchronization reads, ordinary reads and writes have
separate rate-limit buckets. Coalescing limits repeated reads during busy conversations.

## Deployment

Use the Node/Bun server runtime and long-lived response support. The bundled TLS Nginx
configuration enables HTTP/2 for browsers and disables buffering, caching and compression
on the exact events route. Its upstream read timeout exceeds the heartbeat interval.
Keep equivalent settings on any outer reverse proxy/CDN and allow `text/event-stream`
responses to remain open. Do not cache this endpoint or forward it through a platform
that buffers responses. HTTP/2 avoids HTTP/1 browser connection pressure across tabs.

Deploy web and worker together. No schema migration or additional package is required.
Web and worker health endpoints remain independent of individual live streams. Outbox
failures use the existing worker retry/failed-event recovery path. Streaming outages
retain the application's HTTP recovery path; Redis is still required by existing
authentication rate limits and queues.

## Verification

Unit coverage exercises post-commit isolation, rollback, transport validation, reconnect
backoff, heartbeats, offline behavior, lifecycle cleanup, topic filtering and HTTP refresh
races. PostgreSQL/Redis integration coverage verifies publication, current ACLs, private
receipts, transfers, revoked/expired sessions, connection leases and bounded queues.
Browser tests exercise real streams through the production Next server, live messages,
draft retention, receipts, navigation reuse, offline catch-up, HTTP fallback and revocation.

Run `bun run typecheck`, `bun run lint`, `bun run format:check`, `bun run test`,
`bun run test:integration`, then `bun run build` and `bun run test:e2e` in that order.
Build the Linux worker image before media integration/browser tests. Do not regenerate
Prisma on Windows while tests or a local server hold its query-engine DLL open.
