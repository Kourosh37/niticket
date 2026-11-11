import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '@niticket/database';
import { fixtures } from '../helpers/fixtures';
import { putObject } from '@niticket/core/infrastructure/storage';
import { streamAttachment } from '@niticket/core/application/attachments';

afterAll(async () => {
  await db.$disconnect();
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
