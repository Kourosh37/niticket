import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '@niticket/database';
import { fixtures } from '../helpers/fixtures';
import {
  openConversation,
  syncTicket,
  inboxRevision,
  addMessage,
  addActivityNote,
  getHistoryPage,
  getHistoryActivity,
  getMessagePage,
} from '@niticket/core/application/tickets';
import { cleanupExpiredAuth } from '@niticket/core/application/jobs';

afterAll(async () => {
  await db.$disconnect();
});

it('returns no history for an unchanged chat and preserves authorization and private notes on changes', async () => {
  const f = await fixtures(),
    student = await f.actor(f.student.id),
    staff = await f.actor(f.agent.id);
  const { id } = await openConversation(student, { departmentId: f.department.id });
  const first = await syncTicket(student, id);
  expect(first.detail).not.toBeNull();
  expect((await syncTicket(student, id, first.revision)).detail).toBeNull();
  await expect(syncTicket(await f.actor(f.outsider.id), id, first.revision)).rejects.toThrow();
  await addMessage(student, id, { body: 'A new message', version: first.detail!.ticket.version });
  const updated = await syncTicket(student, id, first.revision);
  expect(updated.detail?.messages).toHaveLength(1);
  const activity = await db.activity.findFirstOrThrow({ where: { ticketId: id } });
  await addActivityNote(staff, id, activity.id, { body: 'PRIVATE_SYNC_NOTE' });
  const privateUpdate = await syncTicket(student, id, updated.revision);
  expect(privateUpdate.detail).not.toBeNull();
  expect(JSON.stringify(privateUpdate)).not.toContain('PRIVATE_SYNC_NOTE');
  expect((await syncTicket(staff, id, updated.revision)).detail?.activities).toEqual([]);
  expect(JSON.stringify(await getHistoryPage(staff, id))).toContain('PRIVATE_SYNC_NOTE');
  expect(JSON.stringify(await getHistoryPage(student, id))).not.toContain('PRIVATE_SYNC_NOTE');
  await expect(getMessagePage(await f.actor(f.outsider.id), id)).rejects.toThrow();
  await expect(getHistoryPage(await f.actor(f.outsider.id), id)).rejects.toThrow();
});

it('limits the inbox revision to visible conversations', async () => {
  const f = await fixtures(),
    student = await f.actor(f.student.id),
    other = await f.actor(f.outsider.id);
  const before = await inboxRevision(student);
  await openConversation(other, { departmentId: f.department.id });
  expect(await inboxRevision(student)).toEqual(before);
  await openConversation(student, { departmentId: f.department.id });
  expect(await inboxRevision(student)).not.toEqual(before);
});

it('refreshes a specific old activity while enforcing ticket and private visibility', async () => {
  const f = await fixtures();
  const { id } = await openConversation(await f.actor(f.student.id), {
    departmentId: f.department.id,
  });
  await addMessage(await f.actor(f.student.id), id, { body: 'پرسش اولیه', version: 1 });
  const old = await db.activity.findFirstOrThrow({ where: { ticketId: id } });
  await db.activity.createMany({
    data: Array.from({ length: 60 }, () => ({
      ticketId: id,
      actorId: f.agent.id,
      type: 'INTERNAL_NOTE',
      visibility: 'INTERNAL' as const,
      metadata: {},
    })),
  });
  const staff = await f.actor(f.agent.id);
  const note = await addActivityNote(staff, id, old.id, { body: 'یادداشت تازه روی رویداد قدیمی' });
  expect((await getHistoryPage(staff, id)).items.some((a) => a.id === old.id)).toBe(false);
  expect((await getHistoryActivity(staff, id, old.id)).notes.some((n) => n.id === note.id)).toBe(
    true,
  );
  expect((await getHistoryActivity(await f.actor(f.student.id), id, old.id)).notes).toEqual([]);
  await expect(getHistoryActivity(await f.actor(f.outsider.id), id, old.id)).rejects.toThrow();
  const privateActivity = await db.activity.findFirstOrThrow({
    where: { ticketId: id, visibility: 'INTERNAL' },
  });
  await expect(
    getHistoryActivity(await f.actor(f.student.id), id, privateActivity.id),
  ).rejects.toThrow();
});

it('cleans expired sessions in bounded batches and cascades step-up proofs without removing live sessions', async () => {
  const f = await fixtures();
  const expired = await db.session.create({
    data: {
      token: randomUUID(),
      userId: f.student.id,
      expiresAt: new Date(Date.now() - 60000),
      reauthentication: { create: { verifiedAt: new Date() } },
    },
  });
  const live = await db.session.create({
    data: { token: randomUUID(), userId: f.student.id, expiresAt: new Date(Date.now() + 86400000) },
  });
  // Existing test data may have accumulated expired sessions; each cleanup remains bounded.
  for (let i = 0; i < 10 && (await db.session.findUnique({ where: { id: expired.id } })); i++)
    await cleanupExpiredAuth();
  expect(await db.session.findUnique({ where: { id: expired.id } })).toBeNull();
  expect(await db.reauthentication.findUnique({ where: { sessionId: expired.id } })).toBeNull();
  expect(await db.session.findUnique({ where: { id: live.id } })).not.toBeNull();
});
