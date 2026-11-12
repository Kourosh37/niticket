import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { db } from '@niticket/database';
import { fixtures } from '../helpers/fixtures';
import {
  createUpload,
  completeUpload,
  streamAttachment,
} from '@niticket/core/application/attachments';
import { processScan } from '@niticket/core/application/jobs';
import { drainRealtime } from '@niticket/core/infrastructure/realtime';

afterAll(async () => {
  await drainRealtime();
  await db.$disconnect();
});

it('promotes scanned images with private reusable thumbnails and falls back for legacy originals', async () => {
  const f = await fixtures(),
    actor = await f.actor(f.student.id);
  const ticket = await db.ticket.create({
    data: { creatorId: actor.id, departmentId: f.department.id, subject: 'private derivative' },
  });
  const message = await db.message.create({
    data: { ticketId: ticket.id, senderId: actor.id, body: 'image' },
  });
  const bytes = await sharp({
    create: { width: 2400, height: 1600, channels: 3, background: '#73847b' },
  })
    .png()
    .toBuffer();
  const upload = await createUpload(actor, {
    ticketId: ticket.id,
    messageId: message.id,
    filename: 'large.png',
    mime: 'image/png',
    size: bytes.length,
    clientId: randomUUID(),
  });
  expect(
    (
      await fetch(upload.url!, {
        method: 'PUT',
        headers: { 'content-type': 'image/png' },
        body: bytes,
      })
    ).ok,
  ).toBe(true);
  await completeUpload(actor, upload.id);
  const event = await db.outboxEvent.findFirstOrThrow({
    where: { type: 'SCAN_ATTACHMENT', payload: { path: ['attachmentId'], equals: upload.id } },
  });
  await processScan(event.id, event.payload);
  const row = await db.attachment.findUniqueOrThrow({ where: { id: upload.id } });
  expect(row.thumbnailKey).toBeTruthy();
  expect(row.thumbnailSize).toBeLessThan(bytes.length);
  const thumbnail = await streamAttachment(actor, upload.id, undefined, undefined, {
    thumbnail: true,
  });
  expect(thumbnail.mime).toBe('image/webp');
  expect(
    (await sharp(Buffer.from(await new Response(thumbnail.stream).arrayBuffer())).metadata()).width,
  ).toBe(512);
  await expect(
    streamAttachment(await f.actor(f.outsider.id), upload.id, undefined, undefined, {
      thumbnail: true,
      ifNoneMatch: thumbnail.etag,
    }),
  ).rejects.toMatchObject({ status: 404 });
  await db.attachment.update({
    where: { id: upload.id },
    data: { thumbnailKey: null, thumbnailSize: null },
  });
  const legacy = await streamAttachment(actor, upload.id, undefined, undefined, {
    thumbnail: true,
  });
  expect(legacy.mime).toBe('image/png');
  expect(await new Response(legacy.stream).arrayBuffer()).toHaveLength(bytes.length);
});
