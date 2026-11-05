import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '@niticket/database';
import {
  createTicket,
  getTicket,
  addMessage,
  changeStatus,
  assignTicket,
  transferTicket,
  listTickets,
  changePriority,
} from '@niticket/core/application/tickets';
import { saveMember, updateUser, reports } from '@niticket/core/application/administration';
import { downloadAttachment } from '@niticket/core/application/attachments';
import { processNotification, startJobs } from '@niticket/core/application/jobs';
import { rateLimit, redis } from '@niticket/core/infrastructure/redis';
import { fixtures } from '../helpers/fixtures';

let f: Awaited<ReturnType<typeof fixtures>>;
let id: string;
const input = () => ({
  departmentId: f.department.id,
  categoryId: f.category.id,
  subject: 'درخواست بررسی وضعیت آموزشی',
  body: 'لطفاً وضعیت درخواست آموزشی اینجانب را بررسی فرمایید.',
  priority: 'NORMAL',
});
beforeAll(async () => {
  f = await fixtures();
});
afterAll(async () => {
  await redis().quit();
  await db.$disconnect();
});
describe('PostgreSQL ticket use cases and authorization', () => {
  it('commits initial message, audit, activity and outbox with ticket', async () => {
    const result = await createTicket(await f.actor(f.student.id), input(), randomUUID());
    id = result.id;
    expect(await db.message.count({ where: { ticketId: id } })).toBe(1);
    expect(await db.activity.count({ where: { ticketId: id } })).toBe(1);
    expect(await db.auditLog.count({ where: { resourceId: id } })).toBe(1);
    expect(
      await db.outboxEvent.count({ where: { payload: { path: ['ticketId'], equals: id } } }),
    ).toBe(1);
  });
  it('rolls back invalid categories and denies requester urgent priority', async () => {
    const actor = await f.actor(f.student.id);
    await expect(
      createTicket(actor, { ...input(), categoryId: randomUUID() }, randomUUID()),
    ).rejects.toThrow();
    await expect(
      createTicket(actor, { ...input(), priority: 'URGENT' }, randomUUID()),
    ).rejects.toThrow();
    expect(await db.ticket.count({ where: { creatorId: actor.id } })).toBe(1);
  });
  it('deduplicates retries and rejects a different payload under same key', async () => {
    const actor = await f.actor(f.student.id);
    const key = randomUUID();
    const first = await createTicket(actor, input(), key);
    expect(await createTicket(actor, input(), key)).toEqual(first);
    await expect(
      createTicket(actor, { ...input(), subject: 'عنوان متفاوت درخواست' }, key),
    ).rejects.toThrow();
  });
  it('creates unique sequence numbers under concurrent submissions', async () => {
    const actor = await f.actor(f.student.id);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => createTicket(actor, input(), randomUUID())),
    );
    const rows = await db.ticket.findMany({ where: { id: { in: results.map((r) => r.id) } } });
    expect(new Set(rows.map((r) => r.number)).size).toBe(5);
  });
  it('denies unrelated requester reads and excludes them from lists', async () => {
    const actor = await f.actor(f.outsider.id);
    await expect(getTicket(actor, id)).rejects.toThrow();
    expect((await listTickets(actor, { scope: 'department' })).items.some((t) => t.id === id)).toBe(
      false,
    );
  });
  it('hides internal notes and metadata from requester, but exposes to department staff', async () => {
    await addMessage(await f.actor(f.agent.id), id, {
      version: 1,
      body: 'SECRET_INTERNAL_ANNOTATION',
      visibility: 'INTERNAL',
    });
    const requester = await getTicket(await f.actor(f.student.id), id);
    expect(JSON.stringify(requester)).not.toContain('SECRET_INTERNAL_ANNOTATION');
    expect(requester.activities.some((a) => a.type === 'INTERNAL_NOTE')).toBe(false);
    expect(
      (await getTicket(await f.actor(f.manager.id), id)).messages.some(
        (m) => m.visibility === 'INTERNAL',
      ),
    ).toBe(true);
  });
  it('denies forged internal notes and stale updates', async () => {
    await expect(
      addMessage(await f.actor(f.student.id), id, {
        version: 2,
        body: 'یادداشت داخلی جعلی',
        visibility: 'INTERNAL',
      }),
    ).rejects.toThrow();
    await expect(
      changeStatus(await f.actor(f.agent.id), id, { version: 1, status: 'IN_PROGRESS' }),
    ).rejects.toThrow();
    expect((await db.ticket.findUniqueOrThrow({ where: { id } })).version).toBe(2);
  });
  it('restricts assignments to managers and eligible active members', async () => {
    await expect(
      assignTicket(await f.actor(f.agent.id), id, { version: 2, assigneeId: f.agent.id }),
    ).rejects.toThrow();
    await expect(
      assignTicket(await f.actor(f.manager.id), id, { version: 2, assigneeId: f.outsider.id }),
    ).rejects.toThrow();
    await assignTicket(await f.actor(f.manager.id), id, { version: 2, assigneeId: f.agent.id });
    expect((await db.ticket.findUniqueOrThrow({ where: { id } })).assigneeId).toBe(f.agent.id);
  });
  it('enforces workflow and requester reopening', async () => {
    await changeStatus(await f.actor(f.agent.id), id, { version: 3, status: 'IN_PROGRESS' });
    await changeStatus(await f.actor(f.agent.id), id, { version: 4, status: 'RESOLVED' });
    await changeStatus(await f.actor(f.student.id), id, { version: 5, status: 'REOPENED' });
    expect((await db.ticket.findUniqueOrThrow({ where: { id } })).reopenCount).toBe(1);
  });
  it('transfers history and immediately removes old department access', async () => {
    await transferTicket(await f.actor(f.manager.id), id, {
      version: 6,
      departmentId: f.destination.id,
      reason: 'بررسی تخصصی در واحد مقصد',
    });
    const t = await db.ticket.findUniqueOrThrow({ where: { id } });
    expect(t.assigneeId).toBeNull();
    expect(t.categoryId).toBeNull();
    await expect(getTicket(await f.actor(f.agent.id), id)).rejects.toThrow();
    expect(
      (await getTicket(await f.actor(f.student.id), id)).activities.some(
        (a) => a.type === 'TRANSFERRED',
      ),
    ).toBe(true);
  });
  it('does not release pending or quarantined attachment bytes', async () => {
    const a = await db.attachment.create({
      data: {
        ticketId: id,
        uploaderId: f.student.id,
        filename: 'private.txt',
        objectKey: randomUUID(),
        declaredMime: 'text/plain',
        expectedSize: 10,
        scanStatus: 'QUARANTINED',
        expiresAt: new Date(),
      },
    });
    await expect(downloadAttachment(await f.actor(f.student.id), a.id)).rejects.toThrow();
    await expect(downloadAttachment(await f.actor(f.outsider.id), a.id)).rejects.toThrow();
  });
  it('applies membership revocation and account deactivation on the server', async () => {
    await saveMember(await f.actor(f.admin.id), f.department.id, {
      userId: f.agent.id,
      role: 'AGENT',
      active: false,
    });
    const ownDepartmentTicket = await createTicket(
      await f.actor(f.student.id),
      input(),
      randomUUID(),
    );
    await expect(getTicket(await f.actor(f.agent.id), ownDepartmentTicket.id)).rejects.toThrow();
    await updateUser(await f.actor(f.admin.id), f.outsider.id, { active: false });
    await expect(f.actor(f.outsider.id)).rejects.toThrow();
  });
  it('deduplicates outbox notification processing in PostgreSQL', async () => {
    const event = await db.outboxEvent.create({
      data: {
        type: 'TICKET_NOTIFICATION',
        payload: { ticketId: id, actorId: f.admin.id, type: 'STATUS_CHANGED' },
      },
    });
    await processNotification(event.id, event.payload);
    await processNotification(event.id, event.payload);
    expect(
      await db.notification.count({ where: { eventId: event.id, userId: f.student.id } }),
    ).toBe(1);
    expect(
      (await db.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).processedAt,
    ).not.toBeNull();
  });
  it('rejects audit modification at the database boundary', async () => {
    const row = await db.auditLog.create({ data: { action: 'TEST_IMMUTABILITY', metadata: {} } });
    await expect(
      db.auditLog.update({ where: { id: row.id }, data: { action: 'TAMPERED' } }),
    ).rejects.toThrow('append only');
    await expect(db.auditLog.delete({ where: { id: row.id } })).rejects.toThrow('append only');
  });
  it('uses an atomic Redis rate limiter', async () => {
    const key = randomUUID();
    expect(await rateLimit(key, 2, 60)).toBe(true);
    expect(await rateLimit(key, 2, 60)).toBe(true);
    expect(await rateLimit(key, 2, 60)).toBe(false);
  });
  it('dispatches a committed outbox event through a real BullMQ worker', async () => {
    const result = await createTicket(await f.actor(f.student.id), input(), randomUUID());
    const event = await db.outboxEvent.findFirstOrThrow({
      where: { type: 'TICKET_NOTIFICATION', payload: { path: ['ticketId'], equals: result.id } },
    });
    const jobs = startJobs();
    try {
      await expect
        .poll(
          async () =>
            !!(await db.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).processedAt,
          { timeout: 20000 },
        )
        .toBe(true);
      expect(
        await db.notification.count({ where: { eventId: event.id, userId: f.manager.id } }),
      ).toBe(1);
    } finally {
      await jobs.close();
    }
  });
  it('protects staff priority changes and scopes SQL timing aggregates', async () => {
    const student = await f.actor(f.student.id);
    const manager = await f.actor(f.manager.id);
    const ticket = await createTicket(student, input(), randomUUID());
    await expect(
      changePriority(student, ticket.id, { version: 1, priority: 'URGENT' }),
    ).rejects.toThrow();
    await changePriority(manager, ticket.id, { version: 1, priority: 'HIGH' });
    await addMessage(manager, ticket.id, {
      version: 2,
      body: 'پاسخ برای محاسبه زمان رسیدگی',
      visibility: 'PUBLIC',
    });
    await changeStatus(manager, ticket.id, { version: 3, status: 'RESOLVED' });
    const report = await reports(student);
    expect(report.total).toBe(await db.ticket.count({ where: { creatorId: f.student.id } }));
    expect(report.timing.firstResponseSeconds).toBeGreaterThanOrEqual(0);
    expect(report.timing.resolutionSeconds).toBeGreaterThanOrEqual(0);
    await expect(reports(student, { departmentId: f.destination.id })).rejects.toThrow();
    const staleAdmin = {
      ...(await f.actor(f.admin.id)),
      sessionCreatedAt: new Date(Date.now() - 3600000),
    };
    await expect(updateUser(staleAdmin, f.outsider.id, { active: true })).rejects.toThrow(
      'دوباره رمز عبور',
    );
  });
});
