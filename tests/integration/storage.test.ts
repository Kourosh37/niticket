import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '@niticket/database';
import { fixtures } from '../helpers/fixtures';
import { createTicket, addMessage } from '@niticket/core/application/tickets';
import {
  createUpload,
  completeUpload,
  downloadAttachment,
  uploadStatuses,
} from '@niticket/core/application/attachments';
import { processScan } from '@niticket/core/application/jobs';
import { scanBytes } from '@niticket/core/infrastructure/scanner';
import { objectBytes } from '@niticket/core/infrastructure/storage';
import { deleteObject, putObject, storage } from '@niticket/core/infrastructure/storage';
import { ListObjectVersionsCommand } from '@aws-sdk/client-s3';
import { config } from '@niticket/core/infrastructure/config';

let f: Awaited<ReturnType<typeof fixtures>>;
let ticketId: string;
beforeAll(async () => {
  f = await fixtures();
  ticketId = (
    await createTicket(
      await f.actor(f.student.id),
      {
        departmentId: f.department.id,
        subject: 'آزمون بارگذاری پیوست امن',
        body: 'این درخواست برای آزمون بارگذاری امن پیوست است.',
      },
      randomUUID(),
    )
  ).id;
});
afterAll(async () => {
  await db.$disconnect();
});
it('permanently removes all versions of one object without deleting prefix neighbors', async () => {
  const key = `pending/${randomUUID()}`;
  const neighbor = `${key}-neighbor`;
  await putObject(key, Buffer.from('first'), 'text/plain');
  await putObject(key, Buffer.from('second'), 'text/plain');
  await putObject(neighbor, Buffer.from('keep'), 'text/plain');
  await deleteObject(key);
  const versions = await storage().send(
    new ListObjectVersionsCommand({ Bucket: config().S3_BUCKET, Prefix: key }),
  );
  expect(
    [...(versions.Versions ?? []), ...(versions.DeleteMarkers ?? [])].filter((v) => v.Key === key),
  ).toEqual([]);
  expect((await objectBytes(neighbor, 10)).toString()).toBe('keep');
  await deleteObject(neighbor);
});
it('rejects uploads whose actual length differs from the signed intent at storage', async () => {
  const intent = await createUpload(await f.actor(f.student.id), {
    ticketId,
    filename: 'bounded.txt',
    mime: 'text/plain',
    size: 4,
  });
  expect(new URL(intent.url).searchParams.get('X-Amz-SignedHeaders')).toContain('content-length');
  const response = await fetch(intent.url, {
    method: 'PUT',
    headers: { 'content-type': 'text/plain' },
    body: Buffer.alloc(1024, 65),
  });
  expect(response.ok).toBe(false);
  const valid = await fetch(intent.url, {
    method: 'PUT',
    headers: { 'content-type': 'text/plain' },
    body: Buffer.from('safe'),
  });
  expect(valid.ok).toBe(true);
});
it('uploads real bytes, quarantines, scans and promotes an immutable clean object', async () => {
  const actor = await f.actor(f.student.id);
  const bytes = Buffer.from('پیوست آزمایشی برای بررسی امن دانشگاه');
  const message = await db.message.findFirstOrThrow({ where: { ticketId } });
  const intent = await createUpload(actor, {
    ticketId,
    messageId: message.id,
    filename: 'document.txt',
    mime: 'text/plain',
    size: bytes.length,
  });
  const response = await fetch(intent.url, {
    method: 'PUT',
    headers: { 'content-type': 'text/plain' },
    body: bytes,
  });
  expect(response.ok).toBe(true);
  await completeUpload(actor, intent.id);
  await expect(downloadAttachment(actor, intent.id)).rejects.toThrow();
  const event = await db.outboxEvent.findFirstOrThrow({
    where: { type: 'SCAN_ATTACHMENT', payload: { path: ['attachmentId'], equals: intent.id } },
  });
  await processScan(event.id, event.payload);
  expect((await downloadAttachment(actor, intent.id)).bytes.equals(bytes)).toBe(true);
  await expect(downloadAttachment(await f.actor(f.outsider.id), intent.id)).rejects.toThrow();
  expect(await uploadStatuses(await f.actor(f.outsider.id), [intent.id])).toEqual([]);
  expect(await uploadStatuses(actor, [intent.id])).toMatchObject([
    { id: intent.id, scanStatus: 'CLEAN', detectedMime: 'text/plain' },
  ]);
  // Replay the original PUT after approval. It must not replace the released object.
  await fetch(intent.url, {
    method: 'PUT',
    headers: { 'content-type': 'text/plain' },
    body: Buffer.from('replaced'),
  });
  expect((await downloadAttachment(actor, intent.id)).bytes.equals(bytes)).toBe(true);
  const a = await db.attachment.findUniqueOrThrow({ where: { id: intent.id } });
  expect(a.objectKey.startsWith('clean/')).toBe(true);
  expect((await objectBytes(a.objectKey, 10485760)).equals(bytes)).toBe(true);
});
it('does not expose an internal attachment to the requester', async () => {
  const agent = await f.actor(f.agent.id);
  const message = await addMessage(agent, ticketId, {
    version: 1,
    body: 'پیوست محرمانه همکاران',
    visibility: 'INTERNAL',
  });
  const bytes = Buffer.from('محرمانه داخلی');
  const intent = await createUpload(agent, {
    ticketId,
    messageId: message.id,
    filename: 'internal.txt',
    mime: 'text/plain',
    size: bytes.length,
  });
  await fetch(intent.url, {
    method: 'PUT',
    headers: { 'content-type': 'text/plain' },
    body: bytes,
  });
  await completeUpload(agent, intent.id);
  const event = await db.outboxEvent.findFirstOrThrow({
    where: { type: 'SCAN_ATTACHMENT', payload: { path: ['attachmentId'], equals: intent.id } },
  });
  await processScan(event.id, event.payload);
  await expect(downloadAttachment(await f.actor(f.student.id), intent.id)).rejects.toThrow();
  expect((await downloadAttachment(agent, intent.id)).bytes.equals(bytes)).toBe(true);
});
it('rejects spoofed image signatures', async () => {
  const actor = await f.actor(f.student.id);
  const bytes = Buffer.from('This is not a PNG.');
  const intent = await createUpload(actor, {
    ticketId,
    filename: 'spoof.png',
    mime: 'image/png',
    size: bytes.length,
  });
  await fetch(intent.url, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: bytes });
  await completeUpload(actor, intent.id);
  const event = await db.outboxEvent.findFirstOrThrow({
    where: { type: 'SCAN_ATTACHMENT', payload: { path: ['attachmentId'], equals: intent.id } },
  });
  await processScan(event.id, event.payload);
  expect((await db.attachment.findUniqueOrThrow({ where: { id: intent.id } })).scanStatus).toBe(
    'REJECTED',
  );
});
it('detects the harmless standard EICAR malware test string', async () => {
  const eicar = Buffer.from(
    'WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo=',
    'base64',
  );
  await expect(scanBytes(eicar)).rejects.toThrow('MALWARE_FOUND');
});
