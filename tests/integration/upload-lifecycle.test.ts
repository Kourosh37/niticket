import { afterAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '@niticket/database';
import { fixtures } from '../helpers/fixtures';
import { completeUpload } from '@niticket/core/application/attachments';
import { expireUpload, deleteExpiredUpload } from '@niticket/core/application/upload-lifecycle';
import * as storage from '@niticket/core/infrastructure/storage';
import { drainRealtime } from '@niticket/core/infrastructure/realtime';

afterAll(async () => {
  await drainRealtime();
  await db.$disconnect();
});

async function pending() {
  const f = await fixtures();
  const actor = await f.actor(f.student.id);
  const ticket = await db.ticket.create({
    data: { creatorId: actor.id, departmentId: f.department.id, subject: 'Expiry race' },
  });
  const file = await db.attachment.create({
    data: {
      ticketId: ticket.id,
      uploaderId: actor.id,
      filename: 'safe.txt',
      declaredMime: 'text/plain',
      expectedSize: 4,
      objectKey: `pending/${randomUUID()}`,
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  return { actor, file };
}

it('returns the actual rejected state when expiry wins during the storage HEAD request', async () => {
  const { actor, file } = await pending();
  const head = vi.spyOn(storage, 'headObject').mockImplementationOnce(async () => {
    await db.attachment.update({ where: { id: file.id }, data: { expiresAt: new Date(0) } });
    expect(await expireUpload(file.id)).toBe(1);
    return { ContentLength: 4, $metadata: {} };
  });
  try {
    expect(await completeUpload(actor, file.id)).toEqual({ id: file.id, scanStatus: 'REJECTED' });
    expect(
      await db.outboxEvent.count({
        where: { type: 'SCAN_ATTACHMENT', payload: { path: ['attachmentId'], equals: file.id } },
      }),
    ).toBe(0);
  } finally {
    head.mockRestore();
  }
});

it('claims expiry atomically, defers deletion durably and never expires quarantined uploads', async () => {
  const { actor, file } = await pending();
  await storage.putObject(file.objectKey, Buffer.from('safe'), 'text/plain');
  const done = await completeUpload(actor, file.id);
  expect(done.scanStatus).toBe('QUARANTINED');
  expect(await expireUpload(file.id, new Date(Date.now() + 120000))).toBe(0);
  expect((await storage.objectBytes(file.objectKey, 10)).toString()).toBe('safe');

  const next = await pending();
  await storage.putObject(next.file.objectKey, Buffer.from('safe'), 'text/plain');
  await db.attachment.update({ where: { id: next.file.id }, data: { expiresAt: new Date(0) } });
  expect(await Promise.all([expireUpload(next.file.id), expireUpload(next.file.id)])).toEqual(
    expect.arrayContaining([1, 0]),
  );
  const events = await db.outboxEvent.findMany({
    where: {
      type: 'DELETE_PENDING_OBJECT',
      payload: { path: ['key'], equals: next.file.objectKey },
    },
  });
  expect(events).toHaveLength(1);
  expect((await storage.objectBytes(next.file.objectKey, 10)).toString()).toBe('safe');
  await deleteExpiredUpload(events[0].id, events[0].payload);
  await deleteExpiredUpload(events[0].id, events[0].payload);
  await expect(storage.objectBytes(next.file.objectKey, 10)).rejects.toThrow();
});

it('keeps failed storage deletion retryable and refuses deletion of active storage references', async () => {
  const { file } = await pending();
  await storage.putObject(file.objectKey, Buffer.from('safe'), 'text/plain');
  await db.attachment.update({ where: { id: file.id }, data: { expiresAt: new Date(0) } });
  await expireUpload(file.id);
  const event = await db.outboxEvent.findFirstOrThrow({
    where: { type: 'DELETE_PENDING_OBJECT', payload: { path: ['key'], equals: file.objectKey } },
  });
  const remove = vi
    .spyOn(storage, 'deleteObject')
    .mockRejectedValueOnce(new Error('Storage unavailable'));
  try {
    await expect(deleteExpiredUpload(event.id, event.payload)).rejects.toThrow(
      'Storage unavailable',
    );
    expect(
      (await db.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).processedAt,
    ).toBeNull();
  } finally {
    remove.mockRestore();
  }
  await deleteExpiredUpload(event.id, event.payload);
  expect(
    (await db.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).processedAt,
  ).not.toBeNull();
  const active = await pending();
  await expect(deleteExpiredUpload(event.id, { key: active.file.objectKey })).rejects.toThrow(
    'still in use',
  );
});
