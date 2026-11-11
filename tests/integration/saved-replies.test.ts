import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { db } from '@niticket/database';
import { fixtures } from '../helpers/fixtures';
import { scanInContainer } from '../helpers/scan-in-container';
import {
  createSavedReply,
  listSavedReplies,
  getSavedReply,
  updateSavedReply,
  deleteSavedReply,
} from '@niticket/core/application/saved-replies';
import {
  createSavedReplyUpload,
  completeUpload,
  downloadAttachment,
} from '@niticket/core/application/attachments';
import { addMessage, getTicket } from '@niticket/core/application/tickets';
import { putObject } from '@niticket/core/infrastructure/storage';
import { processNotification, processScan } from '@niticket/core/application/jobs';

afterAll(() => db.$disconnect());

async function setup() {
  const f = await fixtures();
  const staff = await f.actor(f.agent.id),
    student = await f.actor(f.student.id);
  const ticket = await db.ticket.create({
    data: {
      departmentId: f.department.id,
      creatorId: f.student.id,
      subject: 'Saved reply destination',
    },
  });
  return { f, staff, student, ticket };
}

it('shares CRUD within a unit, makes creation idempotent and rejects stale edits and deletion', async () => {
  const { f, staff } = await setup();
  const input = {
    departmentId: f.department.id,
    clientId: randomUUID(),
    title: 'راهنمای ثبت‌نام',
    body: 'متن راهنما',
  };
  const reply = await createSavedReply(staff, input);
  expect((await createSavedReply(staff, input)).id).toBe(reply.id);
  await expect(createSavedReply(staff, { ...input, body: 'different' })).rejects.toMatchObject({
    code: 'IDEMPOTENCY_CONFLICT',
  });
  const manager = await f.actor(f.manager.id);
  expect((await getSavedReply(manager, reply.id)).body).toBe(input.body);
  const changed = await updateSavedReply(manager, reply.id, {
    title: 'راهنمای تازه',
    body: 'اصلاح متن',
    version: reply.version,
  });
  expect(changed.version).toBe(reply.version + 1);
  await expect(
    updateSavedReply(staff, reply.id, { title: 'stale', version: reply.version }),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(deleteSavedReply(staff, reply.id, { version: reply.version })).rejects.toMatchObject(
    { code: 'CONFLICT' },
  );
  await deleteSavedReply(staff, reply.id, { version: changed.version });
  expect((await listSavedReplies(staff, { departmentId: f.department.id })).items).toEqual([]);
  await expect(getSavedReply(staff, reply.id)).rejects.toMatchObject({ status: 404 });
  expect(
    await db.auditLog.count({
      where: {
        resourceId: reply.id,
        action: { in: ['SAVED_REPLY_CREATED', 'SAVED_REPLY_UPDATED', 'SAVED_REPLY_DELETED'] },
      },
    }),
  ).toBe(3);
});

it('denies users, administrators, other units, revoked membership and forged metadata', async () => {
  const { f, staff, student, ticket } = await setup();
  const input = {
    departmentId: f.department.id,
    clientId: randomUUID(),
    title: 'PRIVATE_TEMPLATE',
    body: 'private library',
  };
  const reply = await createSavedReply(staff, input);
  for (const actor of [student, await f.actor(f.admin.id)]) {
    await expect(listSavedReplies(actor)).rejects.toMatchObject({ status: 403 });
    await expect(
      createSavedReply(actor, { ...input, clientId: randomUUID() }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(getSavedReply(actor, reply.id)).rejects.toMatchObject({ status: 403 });
    await expect(
      addMessage(actor, ticket.id, { version: 1, savedReplyId: reply.id }),
    ).rejects.toMatchObject({ status: 403 });
  }
  await db.user.update({ where: { id: f.outsider.id }, data: { role: 'STAFF' } });
  await db.departmentMembership.create({
    data: {
      userId: f.outsider.id,
      departmentId: f.destination.id,
      role: 'AGENT',
      assignedBy: f.admin.id,
    },
  });
  const outsider = await f.actor(f.outsider.id);
  expect((await listSavedReplies(outsider)).items).toEqual([]);
  await expect(getSavedReply(outsider, reply.id)).rejects.toMatchObject({ status: 404 });
  await expect(
    updateSavedReply(staff, reply.id, { title: 'forged', version: 1, creatorId: f.student.id }),
  ).rejects.toThrow();
  await db.departmentMembership.updateMany({
    where: { userId: f.agent.id },
    data: { active: false },
  });
  await expect(
    updateSavedReply(staff, reply.id, { title: 'revoked', version: 1 }),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    createSavedReplyUpload(staff, reply.id, { filename: 'file.txt', mime: 'text/plain', size: 4 }),
  ).rejects.toMatchObject({ status: 404 });
});

it('searches Persian variants and paginates deterministically without exposing foreign unit templates or cursors', async () => {
  const { f, staff } = await setup();
  const at = new Date();
  await db.savedReply.createMany({
    data: Array.from({ length: 23 }, (_, index) => ({
      departmentId: f.department.id,
      creatorId: f.agent.id,
      title: `پیگیری ${index}`,
      body: 'راهنمای واحد',
      updatedAt: at,
    })),
  });
  const foreign = await db.savedReply.create({
    data: { departmentId: f.destination.id, creatorId: f.agent.id, title: 'پیگیری محرمانه' },
  });
  const first = await listSavedReplies(staff, { departmentId: f.department.id, q: 'پيگيري' });
  const second = await listSavedReplies(staff, {
    departmentId: f.department.id,
    q: 'پيگيري',
    cursor: first.nextCursor!,
  });
  expect(first.items).toHaveLength(20);
  expect(second.items).toHaveLength(3);
  expect(new Set([...first.items, ...second.items].map((reply) => reply.id)).size).toBe(23);
  expect(second.nextCursor).toBeNull();
  expect(JSON.stringify(first)).not.toContain(foreign.title);
  await expect(listSavedReplies(staff, { cursor: foreign.id })).rejects.toMatchObject({
    status: 404,
  });
  expect((await listSavedReplies(staff, { q: '%' })).items).toEqual([]);
});

it('creates one complete message with immutable text and media snapshots, notifications and safe retries after template deletion', async () => {
  const { f, staff, student, ticket } = await setup();
  const reply = await createSavedReply(staff, {
    departmentId: f.department.id,
    clientId: randomUUID(),
    title: 'پاسخ همراه فایل',
    body: 'نسخه اصلی پاسخ آماده',
  });
  const bytes = Buffer.from('approved saved media');
  const source = await db.attachment.create({
    data: {
      savedReplyId: reply.id,
      uploaderId: staff.id,
      filename: 'راهنما.txt',
      objectKey: `clean/${randomUUID()}`,
      declaredMime: 'text/plain',
      detectedMime: 'text/plain',
      expectedSize: bytes.length,
      size: bytes.length,
      scanStatus: 'CLEAN',
      expiresAt: new Date(),
    },
  });
  await putObject(source.objectKey, bytes, source.declaredMime);
  const payload = { savedReplyId: reply.id, version: 1, clientId: randomUUID() };
  const sent = await addMessage(staff, ticket.id, payload);
  expect(await addMessage(staff, ticket.id, payload)).toEqual(sent);
  const message = await db.message.findUniqueOrThrow({
    where: { id: sent.id },
    include: { attachments: true },
  });
  expect(message.body).toBe(reply.body);
  expect(message.attachments).toHaveLength(1);
  const snapshot = message.attachments[0];
  expect(snapshot.id).not.toBe(source.id);
  expect(snapshot.objectKey).toBe(source.objectKey);
  expect(snapshot.savedReplyId).toBeNull();
  expect(snapshot.ticketId).toBe(ticket.id);
  expect((await downloadAttachment(student, snapshot.id)).bytes.equals(bytes)).toBe(true);
  await expect(downloadAttachment(student, source.id)).rejects.toMatchObject({ status: 403 });
  const event = await db.outboxEvent.findFirstOrThrow({
    where: { payload: { path: ['messageId'], equals: sent.id } },
  });
  await processNotification(event.id, event.payload);
  expect(await db.notification.count({ where: { messageId: sent.id, userId: f.student.id } })).toBe(
    1,
  );
  const updated = await updateSavedReply(staff, reply.id, {
    title: reply.title,
    body: 'نسخه دوم',
    version: reply.version,
    removeAttachmentIds: [source.id],
  });
  await deleteSavedReply(staff, reply.id, { version: updated.version });
  expect((await db.message.findUniqueOrThrow({ where: { id: sent.id } })).body).toBe(reply.body);
  expect((await downloadAttachment(student, snapshot.id)).bytes.equals(bytes)).toBe(true);
  expect(await addMessage(staff, ticket.id, payload)).toEqual(sent);
  expect(await db.message.count({ where: { ticketId: ticket.id } })).toBe(1);
  await expect(
    addMessage(staff, ticket.id, { ...payload, savedReplyId: randomUUID() }),
  ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
});

it('rejects empty, pending, rejected and wrong-unit templates atomically, and respects private visibility', async () => {
  const { f, staff, student, ticket } = await setup();
  const reply = await createSavedReply(staff, {
    departmentId: f.department.id,
    clientId: randomUUID(),
    title: 'فقط پیوست',
  });
  await expect(
    addMessage(staff, ticket.id, { version: 1, savedReplyId: reply.id }),
  ).rejects.toMatchObject({ code: 'SAVED_REPLY_NOT_READY' });
  const attachment = await db.attachment.create({
    data: {
      savedReplyId: reply.id,
      uploaderId: staff.id,
      filename: 'pending.txt',
      objectKey: `pending/${randomUUID()}`,
      declaredMime: 'text/plain',
      expectedSize: 4,
      expiresAt: new Date(),
    },
  });
  for (const scanStatus of ['PENDING', 'QUARANTINED', 'REJECTED'] as const) {
    await db.attachment.update({ where: { id: attachment.id }, data: { scanStatus } });
    await expect(
      addMessage(staff, ticket.id, { version: 1, savedReplyId: reply.id }),
    ).rejects.toMatchObject({ code: 'SAVED_REPLY_NOT_READY' });
  }
  const foreign = await db.savedReply.create({
    data: {
      departmentId: f.destination.id,
      creatorId: staff.id,
      title: 'other unit',
      body: 'other',
    },
  });
  await expect(
    addMessage(staff, ticket.id, { version: 1, savedReplyId: foreign.id }),
  ).rejects.toMatchObject({ status: 404 });
  expect(await db.message.count({ where: { ticketId: ticket.id } })).toBe(0);
  const ready = await createSavedReply(staff, {
    departmentId: f.department.id,
    clientId: randomUUID(),
    title: 'یادداشت',
    body: 'PRIVATE_SAVED_NOTE',
  });
  const sent = await addMessage(staff, ticket.id, {
    version: 1,
    savedReplyId: ready.id,
    visibility: 'INTERNAL',
  });
  expect(JSON.stringify(await getTicket(student, ticket.id))).not.toContain('PRIVATE_SAVED_NOTE');
  expect(
    await db.outboxEvent.count({ where: { payload: { path: ['messageId'], equals: sent.id } } }),
  ).toBe(0);
});

it('uploads library media through quarantine, signature checks and scanning before reusing it', async () => {
  const { f, staff, ticket, student } = await setup();
  const reply = await createSavedReply(staff, {
    departmentId: f.department.id,
    clientId: randomUUID(),
    title: 'راهنمای فایل',
  });
  const bytes = Buffer.from('راهنمای مشترک واحد');
  const input = {
    filename: 'guide.txt',
    mime: 'text/plain',
    size: bytes.length,
    clientId: randomUUID(),
  };
  const intent = await createSavedReplyUpload(staff, reply.id, input);
  expect((await createSavedReplyUpload(staff, reply.id, input)).id).toBe(intent.id);
  await expect(
    createSavedReplyUpload(staff, reply.id, { ...input, size: 3 }),
  ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  expect(
    (
      await fetch(intent.url!, {
        method: 'PUT',
        headers: { 'content-type': input.mime },
        body: bytes,
      })
    ).ok,
  ).toBe(true);
  await completeUpload(staff, intent.id);
  await expect(downloadAttachment(staff, intent.id)).rejects.toMatchObject({ status: 404 });
  const event = await db.outboxEvent.findFirstOrThrow({
    where: { type: 'SCAN_ATTACHMENT', payload: { path: ['attachmentId'], equals: intent.id } },
  });
  await processScan(event.id, event.payload);
  expect((await getSavedReply(staff, reply.id)).attachments[0].scanStatus).toBe('CLEAN');
  const sent = await addMessage(staff, ticket.id, { version: 1, savedReplyId: reply.id });
  const snapshot = await db.attachment.findFirstOrThrow({ where: { messageId: sent.id } });
  expect((await downloadAttachment(student, snapshot.id)).bytes.equals(bytes)).toBe(true);
  const archived = await updateSavedReply(staff, reply.id, {
    title: reply.title,
    version: (await getSavedReply(staff, reply.id)).version,
    removeAttachmentIds: [intent.id],
  });
  expect(archived.attachments).toEqual([]);
  await expect(downloadAttachment(staff, intent.id)).rejects.toMatchObject({ status: 404 });
});

it('enforces file quotas, safe names, archive ownership and optimistic concurrent updates', async () => {
  const { f, staff } = await setup();
  const reply = await createSavedReply(staff, {
    departmentId: f.department.id,
    clientId: randomUUID(),
    title: 'quota',
    body: 'text',
  });
  await expect(
    createSavedReplyUpload(staff, reply.id, {
      filename: '../bad.txt',
      mime: 'text/plain',
      size: 4,
    }),
  ).rejects.toThrow();
  await expect(
    createSavedReplyUpload(staff, reply.id, {
      filename: 'large.txt',
      mime: 'text/plain',
      size: 52428801,
    }),
  ).rejects.toThrow();
  await expect(
    createSavedReplyUpload(staff, reply.id, {
      filename: 'x.txt',
      mime: 'text/plain',
      size: 4,
      ticketId: randomUUID(),
    }),
  ).rejects.toThrow();
  await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      createSavedReplyUpload(staff, reply.id, {
        filename: `file${index}.txt`,
        mime: 'text/plain',
        size: 4,
      }),
    ),
  );
  await expect(
    createSavedReplyUpload(staff, reply.id, { filename: 'sixth.txt', mime: 'text/plain', size: 4 }),
  ).rejects.toThrow();
  const currentVersion = (await getSavedReply(staff, reply.id)).version;
  await expect(
    updateSavedReply(staff, reply.id, {
      title: 'forged',
      version: currentVersion,
      removeAttachmentIds: [randomUUID()],
    }),
  ).rejects.toMatchObject({ status: 404 });
  const results = await Promise.allSettled(
    ['one', 'two'].map((title) =>
      updateSavedReply(staff, reply.id, { title, version: currentVersion }),
    ),
  );
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect((await getSavedReply(staff, reply.id)).version).toBe(currentVersion + 1);
});

it('requires a fresh preview after template edits and media additions', async () => {
  const { f, staff, ticket } = await setup();
  const original = await createSavedReply(staff, {
    departmentId: f.department.id,
    clientId: randomUUID(),
    title: 'Preview version',
    body: 'Original',
  });
  const edited = await updateSavedReply(staff, original.id, {
    title: original.title,
    body: 'Edited',
    version: original.version,
  });
  await expect(
    addMessage(staff, ticket.id, {
      version: 1,
      savedReplyId: original.id,
      savedReplyVersion: original.version,
    }),
  ).rejects.toMatchObject({ code: 'SAVED_REPLY_CHANGED' });
  await createSavedReplyUpload(staff, original.id, {
    filename: 'new.txt',
    mime: 'text/plain',
    size: 4,
  });
  await expect(
    addMessage(staff, ticket.id, {
      version: 1,
      savedReplyId: original.id,
      savedReplyVersion: edited.version,
    }),
  ).rejects.toMatchObject({ code: 'SAVED_REPLY_CHANGED' });
  expect(await db.message.count({ where: { ticketId: ticket.id } })).toBe(0);
});

it('scans real video in the media runtime and sends it as an independent playable attachment', async () => {
  const { f, staff, student, ticket } = await setup();
  const reply = await createSavedReply(staff, {
    departmentId: f.department.id,
    clientId: randomUUID(),
    title: 'ویدیوی راهنما',
  });
  const bytes = await readFile('tests/fixtures/video.webm');
  const intent = await createSavedReplyUpload(staff, reply.id, {
    filename: 'video.webm',
    mime: 'video/webm',
    size: bytes.length,
  });
  expect(
    (
      await fetch(intent.url!, {
        method: 'PUT',
        headers: { 'content-type': 'video/webm' },
        body: bytes,
      })
    ).ok,
  ).toBe(true);
  await completeUpload(staff, intent.id);
  const event = await db.outboxEvent.findFirstOrThrow({
    where: { type: 'SCAN_ATTACHMENT', payload: { path: ['attachmentId'], equals: intent.id } },
  });
  await scanInContainer(event.id);
  expect((await getSavedReply(staff, reply.id)).attachments[0]).toMatchObject({
    scanStatus: 'CLEAN',
    detectedMime: 'video/webm',
  });
  const sent = await addMessage(staff, ticket.id, { version: 1, savedReplyId: reply.id });
  const attachment = await db.attachment.findFirstOrThrow({ where: { messageId: sent.id } });
  expect((await downloadAttachment(student, attachment.id)).bytes.equals(bytes)).toBe(true);
});
