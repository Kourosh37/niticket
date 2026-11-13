import { afterAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '@niticket/database';
import { fixtures } from '../helpers/fixtures';
import {
  conversationChoices,
  departmentChoices,
  saveDepartment,
  reports,
} from '@niticket/core/application/administration';
import { openConversation } from '@niticket/core/application/tickets';
import {
  createSavedReply,
  listSavedReplies,
  updateSavedReply,
} from '@niticket/core/application/saved-replies';
import { displayPolicy, settings, saveSettings } from '@niticket/core/application/settings';
import { transaction } from '@niticket/core/infrastructure/transaction';
import { enqueueRealtime, drainRealtime } from '@niticket/core/infrastructure/realtime';
import { closeReadCache } from '@niticket/core/infrastructure/read-cache';
import { redis } from '@niticket/core/infrastructure/redis';

afterAll(async () => {
  await drainRealtime();
  closeReadCache();
  redis().disconnect();
  await db.$disconnect();
});

it('reuses unit reads, isolates personalized choices and invalidates committed catalog changes', async () => {
  const f = await fixtures(),
    student = await f.actor(f.student.id),
    outsider = await f.actor(f.outsider.id);
  // Keep this fixture inside the bounded catalog even in a reused test database.
  await db.department.update({
    where: { id: f.department.id },
    data: { displayOrder: -2147483647 },
  });
  const query = vi.spyOn(db.department, 'findMany');
  try {
    const first = await departmentChoices(student);
    const count = query.mock.calls.length;
    first.find((d) => d.id === f.department.id)!.name = 'mutated copy';
    expect((await departmentChoices(student)).find((d) => d.id === f.department.id)?.name).toBe(
      f.department.name,
    );
    expect(query.mock.calls.length).toBe(count);
    const filter = { departmentId: f.department.id };
    expect((await conversationChoices(student, filter)).items[0].canContinue).toBe(false);
    await openConversation(student, filter);
    expect((await conversationChoices(student, filter)).items[0].canContinue).toBe(true);
    expect((await conversationChoices(outsider, filter)).items[0].canContinue).toBe(false);
    const name = `Cached catalog ${randomUUID()}`;
    await saveDepartment(await f.actor(f.admin.id), { name }, f.department.id);
    expect((await departmentChoices(student)).find((d) => d.id === f.department.id)?.name).toBe(
      name,
    );
  } finally {
    query.mockRestore();
  }
});

it('refreshes saved-reply lists and actor-scoped report aggregates after domain writes', async () => {
  const f = await fixtures(),
    staff = await f.actor(f.agent.id),
    student = await f.actor(f.student.id);
  const filter = { departmentId: f.department.id };
  expect((await listSavedReplies(staff, filter)).items).toEqual([]);
  const reply = await createSavedReply(staff, {
    ...filter,
    clientId: randomUUID(),
    title: 'Cached template',
    body: 'Original',
  });
  expect((await listSavedReplies(staff, filter)).items[0].body).toBe('Original');
  await updateSavedReply(staff, reply.id, {
    version: reply.version,
    title: reply.title,
    body: 'Updated',
  });
  expect((await listSavedReplies(staff, filter)).items[0].body).toBe('Updated');
  expect((await reports(student)).total).toBe(0);
  await openConversation(student, filter);
  expect((await reports(student)).total).toBe(1);
  await expect(listSavedReplies(student, filter)).rejects.toMatchObject({ status: 403 });
  expect((await reports(await f.actor(f.outsider.id))).total).toBe(0);
});

it('invalidates display policy while keeping authoritative policy reads uncached', async () => {
  const f = await fixtures(),
    admin = await f.actor(f.admin.id);
  const previous = await db.systemSetting.findUnique({ where: { key: 'policy' } });
  const original = await settings();
  try {
    await displayPolicy();
    const updated = { ...original, maxVoiceSeconds: original.maxVoiceSeconds === 10 ? 11 : 10 };
    await saveSettings(admin, updated);
    expect((await displayPolicy()).maxVoiceSeconds).toBe(updated.maxVoiceSeconds);
    await db.systemSetting.update({ where: { key: 'policy' }, data: { value: original } });
    expect((await settings()).maxVoiceSeconds).toBe(original.maxVoiceSeconds);
  } finally {
    if (previous) await saveSettings(admin, previous.value);
    else
      await transaction(async (tx) => {
        await tx.systemSetting.deleteMany({ where: { key: 'policy' } });
        await enqueueRealtime(tx, { scope: 'everyone', topics: ['settings'] });
      });
  }
});

it('keeps an unrelated unit report warm while refreshing the affected unit and global aggregates', async () => {
  const first = await fixtures(),
    second = await fixtures();
  const a = await first.actor(first.agent.id),
    b = await second.actor(second.agent.id),
    admin = await first.actor(first.admin.id);
  const filterA = { departmentId: first.department.id },
    filterB = { departmentId: second.department.id };
  await reports(a, filterA);
  await reports(b, filterB);
  const global = await reports(admin);
  await openConversation(await first.actor(first.student.id), filterA);
  const queries = vi.spyOn(db.ticket, 'count');
  try {
    expect((await reports(b, filterB)).total).toBe(0);
    expect(queries).not.toHaveBeenCalled();
    expect((await reports(a, filterA)).total).toBe(1);
    expect((await reports(admin)).total).toBe(global.total + 1);
  } finally {
    queries.mockRestore();
  }
});
