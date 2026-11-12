import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '@niticket/database';
import { fixtures } from '../helpers/fixtures';
import { putObject, deleteObject } from '@niticket/core/infrastructure/storage';
import { streamAttachment, avatarAttachment } from '@niticket/core/application/attachments';

afterAll(async () => {
  await db.$disconnect();
});

it('validates access before 304, supports HEAD without reading S3 and fences stale range validators', async () => {
  const f = await fixtures();
  const ticket = await db.ticket.create({
    data: {
      creatorId: f.student.id,
      departmentId: f.department.id,
      subject: 'conditional download',
    },
  });
  const bytes = Buffer.from('approved immutable bytes'),
    key = `clean/${randomUUID()}`;
  await putObject(key, bytes, 'text/plain');
  const a = await db.attachment.create({
    data: {
      ticketId: ticket.id,
      uploaderId: f.student.id,
      objectKey: key,
      filename: 'conditional.txt',
      declaredMime: 'text/plain',
      detectedMime: 'text/plain',
      expectedSize: bytes.length,
      size: bytes.length,
      scanStatus: 'CLEAN',
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  const actor = await f.actor(f.student.id);
  const head = await streamAttachment(actor, a.id, undefined, undefined, { head: true });
  expect(head).toMatchObject({ status: 200, size: bytes.length, stream: null });
  const full = await streamAttachment(actor, a.id, undefined, 'bytes=0-2', { ifRange: '"stale"' });
  expect(full.status).toBe(200);
  expect(await new Response(full.stream).text()).toBe(bytes.toString());
  const partial = await streamAttachment(actor, a.id, undefined, 'bytes=0-2', {
    ifRange: head.etag,
  });
  expect(partial.status).toBe(206);
  expect(await new Response(partial.stream).text()).toBe('app');
  await deleteObject(key);
  expect(
    await streamAttachment(actor, a.id, undefined, undefined, { ifNoneMatch: `W/${head.etag}` }),
  ).toMatchObject({ status: 304, stream: null });
  await expect(
    streamAttachment(await f.actor(f.outsider.id), a.id, undefined, undefined, {
      ifNoneMatch: head.etag,
    }),
  ).rejects.toMatchObject({ status: 404 });
  await db.attachment.update({ where: { id: a.id }, data: { scanStatus: 'REJECTED' } });
  await expect(
    streamAttachment(actor, a.id, undefined, undefined, { ifNoneMatch: head.etag }),
  ).rejects.toMatchObject({ status: 404 });
});

it('binds avatar version URLs to the currently approved staff image', async () => {
  const f = await fixtures();
  const a = await db.attachment.create({
    data: {
      avatarOwnerId: f.agent.id,
      uploaderId: f.agent.id,
      objectKey: `clean/${randomUUID()}`,
      filename: 'avatar.webp',
      declaredMime: 'image/webp',
      detectedMime: 'image/webp',
      expectedSize: 10,
      size: 10,
      scanStatus: 'CLEAN',
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  await db.user.update({ where: { id: f.agent.id }, data: { avatarAttachmentId: a.id } });
  const actor = await f.actor(f.student.id);
  expect(await avatarAttachment(actor, f.agent.id, a.id)).toBe(a.id);
  await expect(avatarAttachment(actor, f.agent.id, randomUUID())).rejects.toMatchObject({
    status: 404,
  });
});

it('streams approved bytes with an exact length, checks ownership and cancels a transfer', async () => {
  const f = await fixtures(),
    ticket = await db.ticket.create({
      data: {
        creatorId: f.student.id,
        departmentId: f.department.id,
        subject: 'streamed download',
      },
    });
  const bytes = Buffer.alloc(2 * 1024 * 1024, 'a'),
    key = `clean/${randomUUID()}`;
  await putObject(key, bytes, 'text/plain');
  const attachment = await db.attachment.create({
    data: {
      ticketId: ticket.id,
      uploaderId: f.student.id,
      objectKey: key,
      filename: 'stream.txt',
      declaredMime: 'text/plain',
      detectedMime: 'text/plain',
      expectedSize: bytes.length,
      size: bytes.length,
      scanStatus: 'CLEAN',
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  const actor = await f.actor(f.student.id),
    file = await streamAttachment(actor, attachment.id);
  expect(file.size).toBe(bytes.length);
  expect(Buffer.from(await new Response(file.stream).arrayBuffer()).equals(bytes)).toBe(true);
  const partial = await streamAttachment(actor, attachment.id, undefined, 'bytes=10-29');
  expect(partial.status).toBe(206);
  expect(partial.contentRange).toBe(`bytes 10-29/${bytes.length}`);
  expect(Buffer.from(await new Response(partial.stream).arrayBuffer())).toEqual(
    bytes.subarray(10, 30),
  );
  const suffix = await streamAttachment(actor, attachment.id, undefined, 'bytes=-8');
  expect(Buffer.from(await new Response(suffix.stream).arrayBuffer())).toEqual(bytes.subarray(-8));
  const unsatisfied = await streamAttachment(
    actor,
    attachment.id,
    undefined,
    `bytes=${bytes.length}-`,
  );
  expect(unsatisfied).toMatchObject({
    status: 416,
    contentRange: `bytes */${bytes.length}`,
    stream: null,
  });
  await expect(streamAttachment(await f.actor(f.outsider.id), attachment.id)).rejects.toMatchObject(
    { status: 404 },
  );
  const abort = new AbortController(),
    transfer = await streamAttachment(actor, attachment.id, abort.signal);
  abort.abort();
  await expect(new Response(transfer.stream).arrayBuffer()).rejects.toThrow();
  await db.attachment.update({ where: { id: attachment.id }, data: { scanStatus: 'QUARANTINED' } });
  await expect(streamAttachment(actor, attachment.id)).rejects.toMatchObject({ status: 404 });
});
