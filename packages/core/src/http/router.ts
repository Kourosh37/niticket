import { db } from '@niticket/database';
import { verify } from '@node-rs/argon2';
import { z } from 'zod';
import type { Actor } from '../domain/authorization';
import { fail } from '../domain/errors';
import * as tickets from '../application/tickets';
import * as admin from '../application/administration';
import * as attachments from '../application/attachments';
import { readJson } from './api';
import { settings, saveSettings } from '../application/settings';
import { failedJobs, retryJob } from '../application/operations';
import { assertAdmin } from '../domain/authorization';
import { getAuth } from '../infrastructure/auth';

export async function dispatch(
  request: Request,
  segments: string[],
  actor: Actor,
): Promise<unknown> {
  const [resource, id, action] = segments;
  const method = request.method;
  const query = Object.fromEntries(new URL(request.url).searchParams);
  if (resource === 'session' && method === 'GET') {
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session) fail('UNAUTHENTICATED', 401, 'برای ادامه وارد حساب خود شوید.');
    return {
      expiresAt: session.session.expiresAt,
      expiresInMs: Math.max(0, new Date(session.session.expiresAt).getTime() - Date.now()),
    };
  }
  if (resource === 'tickets') {
    if (!id && method === 'GET') return tickets.listTickets(actor, query);
    if (!id && method === 'POST')
      return tickets.createTicket(
        actor,
        await readJson(request),
        request.headers.get('idempotency-key') ?? '',
      );
    if (id && !action && method === 'GET')
      return tickets.getTicket(actor, id, query.messageCursor, query.activityCursor);
    if (id && action === 'history' && method === 'GET') {
      const detail = await tickets.getTicket(actor, id, undefined, query.cursor);
      return { items: detail.activities, nextCursor: detail.nextActivityCursor };
    }
    if (id && method === 'POST') {
      const body = await readJson(request);
      if (action === 'activities' && segments[3] && segments[4] === 'notes')
        return tickets.addActivityNote(actor, id, segments[3], body);
      if (action === 'messages') return tickets.addMessage(actor, id, body);
      if (action === 'status' || action === 'reopen') return tickets.changeStatus(actor, id, body);
    }
  }
  if (resource === 'departments' && method === 'GET')
    return admin.listDepartments(actor, false, { q: query.q });
  if (resource === 'reports' && method === 'GET') return admin.reports(actor, query);
  if (resource === 'notifications') {
    if (method === 'GET') return admin.notifications(actor, query.cursor);
    if (method === 'PATCH') return admin.readNotification(actor, await readJson(request));
  }
  if (resource === 'users' && id === 'me') {
    if (method === 'GET') return admin.getProfile(actor);
    if (method === 'PATCH') return admin.updateProfile(actor, await readJson(request));
  }
  if (resource === 'reauthenticate' && method === 'POST') {
    const { password } = z
      .object({ password: z.string().min(1).max(128) })
      .strict()
      .parse(await readJson(request));
    const account = await db.account.findFirst({
      where: { userId: actor.id, providerId: 'credential' },
    });
    if (!account?.password || !(await verify(account.password, password)))
      fail('INVALID_PASSWORD', 400, 'رمز عبور معتبر نیست.');
    await db.$transaction([
      db.reauthentication.upsert({
        where: { sessionId: actor.sessionId },
        create: { sessionId: actor.sessionId, verifiedAt: new Date() },
        update: { verifiedAt: new Date() },
      }),
      db.auditLog.create({ data: { actorId: actor.id, action: 'REAUTHENTICATED', metadata: {} } }),
    ]);
    return { ok: true };
  }
  if (resource === 'uploads' && method === 'POST') {
    if (id === 'intents') return attachments.createUpload(actor, await readJson(request));
    if (id && action === 'complete') return attachments.completeUpload(actor, id);
  }
  if (resource === 'uploads' && id && action === 'status' && method === 'GET')
    return attachments.uploadStatus(actor, id);
  if (resource === 'avatars' && id === 'intents' && method === 'POST')
    return attachments.createAvatarUpload(actor, await readJson(request));
  if (resource === 'avatars' && id && method === 'GET') {
    const file = await attachments.downloadAvatar(actor, id);
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        'content-type': file.mime,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  }
  if (resource === 'attachments' && id && action === 'access' && method === 'GET') {
    const file = await attachments.downloadAttachment(actor, id);
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        'content-type': file.mime,
        'content-length': String(file.bytes.length),
        'content-disposition': `${file.mime.startsWith('audio/') || file.mime.startsWith('image/') ? 'inline' : 'attachment'}; filename="attachment"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
      },
    });
  }
  if (resource === 'admin') {
    assertAdmin(actor);
    const departmentId = segments[2],
      sub = segments[3];
    if (id === 'settings') {
      assertAdmin(actor);
      if (method === 'GET') return settings();
      if (method === 'PATCH') return saveSettings(actor, await readJson(request));
    }
    if (id === 'jobs') {
      if (method === 'GET') return failedJobs(actor);
      if (method === 'POST' && departmentId) return retryJob(actor, departmentId);
    }
    if (id === 'departments') {
      if (!departmentId && method === 'GET')
        return admin.listDepartments(actor, true, { q: query.q, cursor: query.cursor, limit: 30 });
      if (!departmentId && method === 'POST')
        return admin.saveDepartment(actor, await readJson(request));
      if (departmentId && !sub && method === 'PATCH')
        return admin.saveDepartment(actor, await readJson(request), departmentId);
      if (departmentId && sub === 'members') {
        if (method === 'GET') return admin.listMembers(actor, departmentId);
        if (method === 'POST')
          return admin.saveMember(actor, departmentId, await readJson(request));
      }
      if (departmentId && sub === 'categories' && method === 'POST')
        return admin.saveCategory(actor, departmentId, await readJson(request));
    }
    if (id === 'users') {
      if (method === 'GET') return admin.listUsers(actor, query.q, query.cursor);
      if (method === 'POST') return admin.createUser(actor, await readJson(request));
      if (departmentId && method === 'PATCH')
        return admin.updateUser(actor, departmentId, await readJson(request));
    }
    if (id === 'audit' && method === 'GET') return admin.auditLogs(actor, query.cursor);
  }
  fail();
}
