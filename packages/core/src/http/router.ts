import { db } from '@niticket/database';
import type { Actor } from '../domain/authorization';
import { fail } from '../domain/errors';
import * as tickets from '../application/tickets';
import * as admin from '../application/administration';
import * as attachments from '../application/attachments';
import { readJson } from './api';
import { settings, saveSettings } from '../application/settings';
import { failedJobs, retryJob } from '../application/operations';
import { assertAdmin } from '../domain/authorization';
import * as credentials from '../application/credentials';
import * as sessions from '../application/sessions';
import { getAuth } from '../infrastructure/auth';
import { searchMessages, searchSenders } from '../application/message-search';
import { rateLimit } from '../infrastructure/redis';
import { getMessageReceipts, markMessagesSeen } from '../application/message-receipts';
import * as savedReplies from '../application/saved-replies';
import { fileResponse } from './file-response';

export async function dispatch(
  request: Request,
  segments: string[],
  actor: Actor,
): Promise<unknown> {
  const [resource, id, action] = segments;
  const method = request.method === 'HEAD' ? 'GET' : request.method;
  if (request.method === 'HEAD' && !['avatars', 'attachments'].includes(resource))
    fail('METHOD_NOT_ALLOWED', 405);
  const query = Object.fromEntries(new URL(request.url).searchParams);
  if (resource === 'saved-replies') {
    if (!id && method === 'GET') return savedReplies.listSavedReplies(actor, query);
    if (!id && method === 'POST')
      return savedReplies.createSavedReply(actor, await readJson(request));
    if (id && !action && method === 'GET') return savedReplies.getSavedReply(actor, id);
    if (id && !action && method === 'PATCH')
      return savedReplies.updateSavedReply(actor, id, await readJson(request));
    if (id && !action && method === 'DELETE')
      return savedReplies.deleteSavedReply(actor, id, await readJson(request));
    if (id && action === 'uploads' && method === 'POST')
      return attachments.createSavedReplyUpload(actor, id, await readJson(request));
    fail();
  }
  if (resource === 'search' && method === 'GET' && (!id || id === 'senders')) {
    if (!(await rateLimit(`${actor.id}:message-search`, 90, 60)))
      fail('RATE_LIMITED', 429, 'کمی صبر کنید و جستجو را دوباره انجام دهید.');
    return id === 'senders' ? searchSenders(actor, query) : searchMessages(actor, query);
  }
  if (resource === 'conversations' && !id && method === 'POST')
    return tickets.openConversation(actor, await readJson(request));
  if (resource === 'session' && method === 'GET') {
    const session = await getAuth().api.getSession({
      headers: request.headers,
      query: { disableRefresh: true },
    });
    if (!session) fail('UNAUTHENTICATED', 401, 'برای ادامه وارد حساب خود شوید.');
    return {
      expiresAt: session.session.expiresAt,
      expiresInMs: Math.max(0, new Date(session.session.expiresAt).getTime() - Date.now()),
    };
  }
  if (resource === 'inbox' && id === 'revision' && method === 'GET')
    return tickets.inboxRevision(actor);
  if (resource === 'tickets') {
    if (id && action === 'receipts' && method === 'GET')
      return getMessageReceipts(
        actor,
        id,
        typeof query.ids === 'string' && query.ids.length <= 1850 ? query.ids.split(',') : [],
      );
    if (id && action === 'read' && method === 'POST')
      return markMessagesSeen(actor, id, await readJson(request));
    if (id && action === 'sync' && method === 'GET')
      return tickets.syncTicket(actor, id, query.since);
    if (!id && method === 'GET') return tickets.listTickets(actor, query);
    if (!id && method === 'POST')
      return tickets.createTicket(
        actor,
        await readJson(request),
        request.headers.get('idempotency-key') ?? '',
      );
    if (id && !action && method === 'GET')
      return tickets.getTicket(actor, id, query.messageCursor, query.activityCursor);
    if (id && action === 'messages' && method === 'GET')
      return segments[3] === 'context'
        ? tickets.getMessageContext(actor, id, query.messageId)
        : tickets.getMessagePage(
            actor,
            id,
            query.cursor,
            query.direction as 'older' | 'newer' | undefined,
          );
    if (id && action === 'history' && method === 'GET')
      return segments[3]
        ? tickets.getHistoryActivity(actor, id, segments[3])
        : tickets.getHistoryPage(actor, id, query.cursor);
    if (id && method === 'POST') {
      const body = await readJson(request);
      if (action === 'activities' && segments[3] && segments[4] === 'notes')
        return tickets.addActivityNote(actor, id, segments[3], body);
      if (action === 'messages') return tickets.addMessage(actor, id, body);
      if (action === 'status' || action === 'reopen') return tickets.changeStatus(actor, id, body);
    }
  }
  if (resource === 'departments' && id === 'choices' && method === 'GET')
    return admin.conversationChoices(actor, query);
  if (resource === 'departments' && method === 'GET')
    return admin.listDepartments(actor, false, { q: query.q });
  if (resource === 'reports' && method === 'GET') return admin.reports(actor, query);
  if (resource === 'notifications') {
    if (id === 'count' && method === 'GET')
      return {
        unreadCount: await db.notification.count({ where: { userId: actor.id, readAt: null } }),
      };
    if (method === 'GET') return admin.notifications(actor, query.cursor);
    if (method === 'PATCH') return admin.readNotification(actor, await readJson(request));
  }
  if (resource === 'users' && id === 'me') {
    if (action === 'sessions') {
      if (method === 'GET' && !segments[3]) return sessions.listSessions(actor, query.cursor);
      if (method === 'DELETE' && segments[3]) return sessions.revokeSessions(actor, segments[3]);
      if (method === 'DELETE' && !segments[3]) return sessions.revokeSessions(actor);
      fail();
    }
    if (action === 'password' && method === 'POST')
      return credentials.setPassword(actor, await readJson(request));
    if (method === 'GET') return admin.getProfile(actor);
    if (method === 'PATCH') return admin.updateProfile(actor, await readJson(request));
  }
  if (resource === 'reauthenticate' && method === 'POST') {
    if (id === 'code') return credentials.sendReauthenticationCode(actor);
    if (!id) return credentials.reauthenticate(actor, await readJson(request));
  }
  if (resource === 'uploads' && method === 'POST') {
    if (id === 'intents') return attachments.createUpload(actor, await readJson(request));
    if (id && action === 'complete') return attachments.completeUpload(actor, id);
  }
  if (resource === 'uploads' && id && action === 'status' && method === 'GET')
    return attachments.uploadStatus(actor, id);
  if (resource === 'uploads' && id === 'statuses' && method === 'GET')
    return attachments.uploadStatuses(
      actor,
      typeof query.ids === 'string' && query.ids.length <= 1850 ? query.ids.split(',') : [],
    );
  if (resource === 'avatars' && id === 'intents' && method === 'POST')
    return attachments.createAvatarUpload(actor, await readJson(request));
  if (resource === 'avatars' && id && method === 'GET') {
    const attachmentId = await attachments.avatarAttachment(actor, id, query.v);
    return fileResponse(
      await attachments.streamAttachment(actor, attachmentId, request.signal, undefined, {
        ifNoneMatch: request.headers.get('if-none-match') ?? undefined,
        head: request.method === 'HEAD',
      }),
    );
  }
  if (resource === 'attachments' && id && action === 'metadata' && method === 'GET')
    return attachments.attachmentMetadata(actor, id);
  if (resource === 'attachments' && id && action === 'access' && method === 'GET') {
    const file = await attachments.streamAttachment(
      actor,
      id,
      request.signal,
      request.headers.get('range') ?? undefined,
      {
        ifNoneMatch: request.headers.get('if-none-match') ?? undefined,
        ifRange: request.headers.get('if-range') ?? undefined,
        head: request.method === 'HEAD',
      },
    );
    return fileResponse(file);
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
      if (method === 'GET')
        return admin.listUsers(
          actor,
          query.q,
          query.cursor,
          query.direction as 'next' | 'previous' | undefined,
        );
      if (method === 'POST') return admin.createUser(actor, await readJson(request));
      if (departmentId && method === 'PATCH')
        return admin.updateUser(actor, departmentId, await readJson(request));
    }
    if (id === 'audit' && method === 'GET') return admin.auditLogs(actor, query.cursor);
  }
  fail();
}
