import { afterAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '@niticket/database';
import { fixtures } from '../helpers/fixtures';
import {
  reservePromotion,
  collectPromotion,
  deleteUnreferencedObject,
} from '@niticket/core/application/storage-reconciliation';
import { createUpload, completeUpload } from '@niticket/core/application/attachments';
import { processScan } from '@niticket/core/application/jobs';
import { drainRealtime } from '@niticket/core/infrastructure/realtime';
import * as storage from '@niticket/core/infrastructure/storage';

afterAll(async () => {
  await drainRealtime();
  await db.$disconnect();
});

it('reconciles an orphan from a failed database commit while preserving the successful retry', async () => {
  const f = await fixtures(),
    actor = await f.actor(f.student.id);
  const ticket = await db.ticket.create({
    data: { creatorId: actor.id, departmentId: f.department.id, subject: 'Promotion retry' },
  });
  const intent = await createUpload(actor, {
    ticketId: ticket.id,
    filename: 'safe.txt',
    mime: 'text/plain',
    size: 4,
  });
  await fetch(intent.url!, {
    method: 'PUT',
    headers: { 'content-type': 'text/plain' },
    body: 'safe',
  });
  await completeUpload(actor, intent.id);
  const event = await db.outboxEvent.findFirstOrThrow({
    where: { type: 'SCAN_ATTACHMENT', payload: { path: ['attachmentId'], equals: intent.id } },
  });
  const failure = vi
    .spyOn(db, '$transaction')
    .mockRejectedValueOnce(new Error('Database unavailable after promotion'));
  try {
    await expect(processScan(event.id, event.payload)).rejects.toThrow('Database unavailable');
  } finally {
    failure.mockRestore();
  }
  const orphan = await db.storageCandidate.findFirstOrThrow({
    where: { key: { startsWith: 'clean/' } },
    orderBy: { createdAt: 'desc' },
  });
  expect((await storage.objectBytes(orphan.key, 10)).toString()).toBe('safe');
  expect(await collectPromotion(orphan.key)).toBe(0);
  await processScan(event.id, event.payload);
  const accepted = await db.attachment.findUniqueOrThrow({ where: { id: intent.id } });
  expect(accepted.scanStatus).toBe('CLEAN');
  expect(accepted.objectKey).not.toBe(orphan.key);
  expect(await db.storageCandidate.findUnique({ where: { key: accepted.objectKey } })).toBeNull();
  expect(await collectPromotion(orphan.key, new Date(Date.now() + 7200000))).toBe(1);
  const purge = await db.outboxEvent.findFirstOrThrow({
    where: { type: 'DELETE_UNREFERENCED_OBJECT', payload: { path: ['key'], equals: orphan.key } },
  });
  await deleteUnreferencedObject(purge.id, purge.payload);
  await deleteUnreferencedObject(purge.id, purge.payload);
  await expect(storage.objectBytes(orphan.key, 10)).rejects.toThrow();
  expect((await storage.objectBytes(accepted.objectKey, 10)).toString()).toBe('safe');
});

it('protects shared originals and thumbnails and rechecks references before a queued deletion', async () => {
  const f = await fixtures();
  const key = `clean/${randomUUID()}`,
    thumbnail = `${key}.thumbnail.webp`;
  await reservePromotion([key, thumbnail]);
  await storage.putObject(key, Buffer.from('safe'), 'text/plain');
  const ticket = await db.ticket.create({
    data: { creatorId: f.student.id, departmentId: f.department.id, subject: 'Shared media' },
  });
  const file = await db.attachment.create({
    data: {
      ticketId: ticket.id,
      uploaderId: f.agent.id,
      objectKey: key,
      thumbnailKey: thumbnail,
      thumbnailSize: 10,
      filename: 'shared.txt',
      declaredMime: 'text/plain',
      scanStatus: 'CLEAN',
      expectedSize: 4,
      expiresAt: new Date(),
    },
  });
  const later = new Date(Date.now() + 7200000);
  expect(await collectPromotion(key, later)).toBe(0);
  expect(await collectPromotion(thumbnail, later)).toBe(0);
  const orphan = `clean/${randomUUID()}`;
  await reservePromotion([orphan]);
  await storage.putObject(orphan, Buffer.from('keep'), 'text/plain');
  expect(await collectPromotion(orphan, later)).toBe(1);
  const event = await db.outboxEvent.findFirstOrThrow({
    where: { type: 'DELETE_UNREFERENCED_OBJECT', payload: { path: ['key'], equals: orphan } },
  });
  await db.attachment.create({
    data: {
      ticketId: file.ticketId,
      uploaderId: file.uploaderId,
      filename: file.filename,
      declaredMime: file.declaredMime,
      expectedSize: file.expectedSize,
      scanStatus: 'CLEAN',
      expiresAt: file.expiresAt,
      objectKey: orphan,
    },
  });
  await deleteUnreferencedObject(event.id, event.payload);
  expect((await storage.objectBytes(orphan, 10)).toString()).toBe('keep');
});
