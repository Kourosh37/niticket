import { afterAll, expect, it } from 'vitest';
import { randomUUID, randomInt } from 'node:crypto';
import { db } from '@niticket/database';
import { fixtures } from '../helpers/fixtures';
import { config } from '@niticket/core/infrastructure/config';
import { actorFromHeaders } from '@niticket/core/application/context';
import { listSessions, revokeSessions } from '@niticket/core/application/sessions';
import {
  listUsers,
  departmentChoices,
  conversationChoices,
} from '@niticket/core/application/administration';
import { POST } from '../../apps/web/src/app/api/auth/[...all]/route';
import { DELETE } from '../../apps/web/src/app/api/v1/[...path]/route';

const desktop =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0.0.0 Safari/537.36';
const mobile =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
afterAll(async () => {
  await db.$disconnect();
});

async function login(phoneNumber: string, password: string, userAgent = desktop) {
  const response = await POST(
    new Request(`${config().APP_ORIGIN}/api/auth/sign-in/phone-number`, {
      method: 'POST',
      headers: {
        origin: config().APP_ORIGIN,
        'content-type': 'application/json',
        'user-agent': userAgent,
      },
      body: JSON.stringify({ phoneNumber, password }),
    }),
  );
  expect(response.status).toBe(200);
  const headers = new Headers({
    cookie: response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; '),
  });
  return { actor: await actorFromHeaders(headers), headers };
}

it('shows only the owner’s paginated active sessions and never returns authentication secrets', async () => {
  const f = await fixtures(),
    current = await login(f.student.phoneNumber!, f.password),
    other = await login(f.student.phoneNumber!, f.password, mobile),
    outsider = await login(f.outsider.phoneNumber!, f.password);
  const expired = await db.session.create({
    data: { token: randomUUID(), userId: f.student.id, expiresAt: new Date(Date.now() - 1000) },
  });
  await db.session.createMany({
    data: Array.from({ length: 43 }, (_, index) => ({
      id: randomUUID(),
      token: randomUUID(),
      userId: f.student.id,
      userAgent: desktop,
      createdAt: new Date(Date.now() - (index + 1) * 1000),
      expiresAt: new Date(Date.now() + 86400000),
    })),
  });
  let cursor: string | undefined;
  const ids: string[] = [];
  do {
    const page = await listSessions(current.actor, cursor);
    expect(page.items.length).toBeLessThanOrEqual(20);
    expect(page.current.id).toBe(current.actor.sessionId);
    expect(page.current.device).toMatchObject({
      browser: 'Chrome 142',
      os: 'Windows',
      kind: 'desktop',
    });
    expect(JSON.stringify(page)).not.toMatch(/token|userAgent|ipAddress/);
    ids.push(...page.items.map((row) => row.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  expect(ids).toHaveLength(44);
  expect(new Set(ids).size).toBe(44);
  expect(ids).toContain(other.actor.sessionId);
  expect(ids).not.toContain(expired.id);
  expect(ids).not.toContain(outsider.actor.sessionId);
  await expect(listSessions(current.actor, outsider.actor.sessionId)).rejects.toMatchObject({
    status: 404,
  });
});

it('revokes one or all owned devices from an older valid login and preserves the current and foreign sessions', async () => {
  const f = await fixtures(),
    current = await login(f.student.phoneNumber!, f.password),
    other = await login(f.student.phoneNumber!, f.password, mobile),
    outsider = await login(f.outsider.phoneNumber!, f.password);
  await expect(revokeSessions(current.actor, outsider.actor.sessionId)).rejects.toMatchObject({
    status: 404,
  });
  expect(await db.session.findUnique({ where: { id: outsider.actor.sessionId } })).not.toBeNull();
  current.actor.sessionCreatedAt = new Date(Date.now() - 600000);
  await db.session.update({
    where: { id: current.actor.sessionId },
    data: { createdAt: current.actor.sessionCreatedAt },
  });
  await expect(revokeSessions(current.actor, other.actor.sessionId)).resolves.toEqual({
    revoked: 1,
  });
  await expect(actorFromHeaders(other.headers)).rejects.toMatchObject({ status: 401 });
  await expect(actorFromHeaders(current.headers)).resolves.toMatchObject({ id: f.student.id });
  await expect(revokeSessions(current.actor, current.actor.sessionId)).rejects.toMatchObject({
    status: 400,
  });
  await db.session.createMany({
    data: Array.from({ length: 25 }, () => ({
      token: randomUUID(),
      userId: f.student.id,
      expiresAt: new Date(Date.now() + 86400000),
    })),
  });
  await expect(revokeSessions(current.actor)).resolves.toEqual({ revoked: 25 });
  expect(await db.session.count({ where: { userId: f.student.id } })).toBe(1);
  expect(await db.session.findUnique({ where: { id: outsider.actor.sessionId } })).not.toBeNull();
  expect(
    await db.auditLog.count({
      where: {
        actorId: f.student.id,
        action: { in: ['SESSION_REVOKED', 'OTHER_SESSIONS_REVOKED'] },
      },
    }),
  ).toBe(2);
});

it.each(['student', 'manager', 'admin'] as const)(
  'allows %s to revoke an owned session through HTTP after the freshness window while enforcing origin and ownership',
  async (role) => {
    const f = await fixtures();
    const current = await login(f[role].phoneNumber!, f.password);
    const target = await login(f[role].phoneNumber!, f.password, mobile);
    const untouched = await login(f[role].phoneNumber!, f.password);
    const foreign = await login(f.outsider.phoneNumber!, f.password);
    await db.session.update({
      where: { id: current.actor.sessionId },
      data: { createdAt: new Date(Date.now() - 86400000) },
    });

    async function remove(id: string, origin: string | null = config().APP_ORIGIN) {
      const headers = new Headers(current.headers);
      if (origin) headers.set('origin', origin);
      return DELETE(
        new Request(`${config().APP_ORIGIN}/api/v1/users/me/sessions/${id}`, {
          method: 'DELETE',
          headers,
        }),
        { params: Promise.resolve({ path: ['users', 'me', 'sessions', id] }) },
      );
    }

    expect((await remove(target.actor.sessionId, 'https://foreign.example')).status).toBe(403);
    expect((await remove(target.actor.sessionId, null)).status).toBe(403);
    expect(await db.session.findUnique({ where: { id: target.actor.sessionId } })).not.toBeNull();
    expect((await remove(foreign.actor.sessionId)).status).toBe(404);
    expect((await remove(current.actor.sessionId)).status).toBe(400);
    const response = await remove(target.actor.sessionId);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ revoked: 1 });
    await expect(actorFromHeaders(target.headers)).rejects.toMatchObject({ status: 401 });
    for (const session of [current, untouched, foreign])
      await expect(actorFromHeaders(session.headers)).resolves.toMatchObject({
        id: session.actor.id,
      });
    // A deleted login cannot revoke another session, even if its in-memory actor was loaded earlier.
    await expect(revokeSessions(target.actor, untouched.actor.sessionId)).rejects.toMatchObject({
      status: 401,
    });
    await db.session.update({
      where: { id: current.actor.sessionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await remove(untouched.actor.sessionId)).status).toBe(401);
    expect(
      await db.session.findUnique({ where: { id: untouched.actor.sessionId } }),
    ).not.toBeNull();
  },
);

it('tracks recent activity without refreshing auth timestamps or writing on every read', async () => {
  const f = await fixtures(),
    current = await login(f.student.phoneNumber!, f.password);
  const marker = new Date(Date.now() - 120000);
  await db.session.update({
    where: { id: current.actor.sessionId },
    data: { lastSeenAt: new Date(Date.now() - 900000), updatedAt: marker },
  });
  await actorFromHeaders(current.headers);
  const first = await db.session.findUniqueOrThrow({ where: { id: current.actor.sessionId } });
  expect(first.lastSeenAt.getTime()).toBeGreaterThan(Date.now() - 3000);
  expect(first.updatedAt).toEqual(marker);
  await actorFromHeaders(current.headers);
  expect(
    (await db.session.findUniqueOrThrow({ where: { id: current.actor.sessionId } })).lastSeenAt,
  ).toEqual(first.lastSeenAt);
});

it('paginates administrators’ users forward and backward and normalizes phone searches', async () => {
  const f = await fixtures(),
    actor = await f.actor(f.admin.id),
    name = `pagination-${randomUUID()}`,
    number = `+989${randomInt(100000000, 999999999)}`;
  await db.user.createMany({
    data: Array.from({ length: 67 }, (_, index) => ({
      name,
      email: `${randomUUID()}@identity.niticket.invalid`,
      ...(index === 0 ? { phoneNumber: number, phoneNumberVerified: true } : {}),
    })),
  });
  const first = await listUsers(actor, name),
    second = await listUsers(actor, name, first.nextCursor!);
  expect(first.items).toHaveLength(30);
  expect(second.items).toHaveLength(30);
  expect(new Set([...first.items, ...second.items].map((user) => user.id)).size).toBe(60);
  const back = await listUsers(actor, name, second.previousCursor!, 'previous');
  expect(back.items.map((user) => user.id)).toEqual(first.items.map((user) => user.id));
  expect(back.previousCursor).toBeNull();
  expect((await listUsers(actor, name, second.nextCursor!)).items).toHaveLength(7);
  for (const query of [
    number.replace('+98', '0'),
    number.slice(3),
    `+98 ${number.slice(3)}`,
    number.replace('+98', '0').replace(/\d/g, (digit) => String.fromCharCode(1776 + Number(digit))),
  ])
    expect((await listUsers(actor, query)).items.some((user) => user.phoneNumber === number)).toBe(
      true,
    );
  await expect(listUsers(await f.actor(f.student.id))).rejects.toMatchObject({ status: 403 });
  expect(
    (await departmentChoices(await f.actor(f.student.id))).every(
      (department) => !('memberships' in department) && !('categories' in department),
    ),
  ).toBe(true);
});

it('searches and paginates unit choices beyond the initial page without exposing hidden units', async () => {
  const f = await fixtures(),
    actor = await f.actor(f.student.id),
    name = `choices-${randomUUID()}`;
  await db.department.createMany({
    data: Array.from({ length: 57 }, () => ({
      name,
      slug: randomUUID(),
      displayOrder: 1000000,
    })),
  });
  const first = await conversationChoices(actor, { q: name });
  expect(first.items).toHaveLength(50);
  const second = await conversationChoices(actor, { q: name, cursor: first.nextCursor! });
  expect(second.items).toHaveLength(7);
  expect(second.nextCursor).toBeNull();
  expect(new Set([...first.items, ...second.items].map((row) => row.id)).size).toBe(57);
  const chosen = first.items[0];
  expect((await conversationChoices(actor, { departmentId: chosen.id })).items[0].id).toBe(
    chosen.id,
  );
  await db.department.update({ where: { id: chosen.id }, data: { visible: false } });
  expect((await conversationChoices(actor, { departmentId: chosen.id })).items).toHaveLength(0);
  expect(
    (await conversationChoices(actor, { q: name })).items.some((row) => row.id === chosen.id),
  ).toBe(false);
  await expect(conversationChoices(actor, { cursor: chosen.id })).rejects.toMatchObject({
    status: 404,
  });
  await expect(conversationChoices(await f.actor(f.agent.id))).rejects.toMatchObject({
    status: 403,
  });
});
