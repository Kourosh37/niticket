import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '@niticket/database';
import { fixtures } from '../helpers/fixtures';
import { openRealtime } from '@niticket/core/http/realtime';
import { enqueueRealtime, realtimeNamespace } from '@niticket/core/infrastructure/realtime';
import { transaction } from '@niticket/core/infrastructure/transaction';
import { redis } from '@niticket/core/infrastructure/redis';
import { openConversation, addMessage } from '@niticket/core/application/tickets';
import { GET } from '../../apps/web/src/app/api/v1/events/route';
import { config } from '@niticket/core/infrastructure/config';
import type { Actor } from '@niticket/core/domain/authorization';

afterAll(async () => {
  await db.$disconnect();
  redis().disconnect();
});

async function session(actor: Actor, expiresAt = new Date(Date.now() + 60000)) {
  const row = await db.session.create({
    data: { token: randomUUID(), userId: actor.id, expiresAt },
  });
  return { ...actor, sessionId: row.id, sessionCreatedAt: row.createdAt };
}

function capture(response: Response) {
  const events: { event: string; data: unknown }[] = [];
  const reader = response.body!.getReader(),
    decoder = new TextDecoder();
  let ended = false;
  const done = (async () => {
    let buffer = '';
    for (;;) {
      const next = await reader.read();
      if (next.done) {
        ended = true;
        break;
      }
      buffer += decoder.decode(next.value, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const type = frame.match(/^event: (.+)$/m)?.[1],
          data = frame.match(/^data: (.+)$/m)?.[1];
        if (type && data) events.push({ event: type, data: JSON.parse(data) });
      }
    }
  })();
  return {
    events,
    get ended() {
      return ended;
    },
    cancel: async () => {
      await reader.cancel();
      await done;
    },
  };
}

it('requires authentication and rejects cross-origin subscriptions', async () => {
  expect((await GET(new Request(`${config().APP_ORIGIN}/api/v1/events`))).status).toBe(401);
  const f = await fixtures(),
    actor = await session(await f.actor(f.student.id));
  await expect(
    openRealtime(
      new Request(`${config().APP_ORIGIN}/api/v1/events`, {
        headers: { origin: 'https://untrusted.example', 'sec-fetch-site': 'cross-site' },
      }),
      actor,
    ),
  ).rejects.toMatchObject({ status: 403 });
});

it('streams promptly committed changes with safe headers, filters private content and releases its subscription on cancel', async () => {
  const f = await fixtures(),
    actor = await session(await f.actor(f.student.id));
  const ticket = await openConversation(actor, { departmentId: f.department.id });
  const response = await openRealtime(new Request(`${config().APP_ORIGIN}/api/v1/events`), actor);
  expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
  expect(response.headers.get('cache-control')).toContain('no-transform');
  expect(response.headers.get('x-accel-buffering')).toBe('no');
  const stream = capture(response);
  try {
    await expect.poll(() => stream.events[0]?.event).toBe('ready');
    await addMessage(await f.actor(f.agent.id), ticket.id, {
      version: 1,
      body: 'private-hidden',
      visibility: 'INTERNAL',
    });
    await addMessage(await f.actor(f.agent.id), ticket.id, {
      version: 2,
      body: 'public-body-not-on-the-stream',
    });
    await expect
      .poll(() => stream.events.filter((event) => event.event === 'change').length)
      .toBeGreaterThan(0);
    expect(JSON.stringify(stream.events)).not.toMatch(
      /private-hidden|public-body-not-on-the-stream|creatorId|departmentId|userId/,
    );
    const updates = stream.events.filter((event) => event.event === 'change');
    expect(updates.some((event) => JSON.stringify(event.data).includes(ticket.id))).toBe(true);
  } finally {
    await stream.cancel();
  }
  await expect
    .poll(() => redis().zcard(`${realtimeNamespace()}:session:${actor.sessionId}`))
    .toBe(0);
});

it('revalidates revoked sessions on incoming events and closes an expired idle stream at its deadline', async () => {
  const f = await fixtures(),
    actor = await session(await f.actor(f.student.id));
  const stream = capture(
    await openRealtime(new Request(`${config().APP_ORIGIN}/api/v1/events`), actor),
  );
  await db.session.delete({ where: { id: actor.sessionId } });
  await transaction((tx) =>
    enqueueRealtime(tx, { scope: 'user', userId: actor.id, topics: ['access'] }),
  );
  await expect.poll(() => stream.events.some((event) => event.event === 'auth')).toBe(true);
  await expect.poll(() => stream.ended).toBe(true);
  const expiring = await session(await f.actor(f.student.id), new Date(Date.now() + 500));
  const idle = capture(
    await openRealtime(new Request(`${config().APP_ORIGIN}/api/v1/events`), expiring),
  );
  await expect.poll(() => idle.events.some((event) => event.event === 'auth')).toBe(true);
  await expect.poll(() => idle.ended).toBe(true);
});

it('caps concurrent tabs per session and allows immediate replacement after cancellation', async () => {
  const f = await fixtures(),
    actor = await session(await f.actor(f.student.id));
  const streams: Response[] = [];
  try {
    for (let i = 0; i < 3; i++)
      streams.push(await openRealtime(new Request(`${config().APP_ORIGIN}/api/v1/events`), actor));
    await expect(
      openRealtime(new Request(`${config().APP_ORIGIN}/api/v1/events`), actor),
    ).rejects.toMatchObject({ status: 429 });
    await streams.shift()!.body!.cancel();
    await expect
      .poll(() => redis().zcard(`${realtimeNamespace()}:session:${actor.sessionId}`))
      .toBe(2);
    streams.push(await openRealtime(new Request(`${config().APP_ORIGIN}/api/v1/events`), actor));
  } finally {
    await Promise.all(streams.map((stream) => stream.body!.cancel()));
  }
});

it('bounds an event burst and closes the stream rather than retaining an unbounded backlog', async () => {
  const f = await fixtures(),
    actor = await session(await f.actor(f.student.id));
  const stream = capture(
    await openRealtime(new Request(`${config().APP_ORIGIN}/api/v1/events`), actor),
  );
  await Promise.all(
    Array.from({ length: 100 }, () =>
      redis().publish(
        `${realtimeNamespace()}:changes`,
        JSON.stringify({
          id: randomUUID(),
          change: { scope: 'user', userId: actor.id, topics: ['notifications'] },
        }),
      ),
    ),
  );
  await expect.poll(() => stream.ended).toBe(true);
  await expect
    .poll(() => redis().zcard(`${realtimeNamespace()}:session:${actor.sessionId}`))
    .toBe(0);
});
