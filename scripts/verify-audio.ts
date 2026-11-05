import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const url = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!);
if (!process.env.TEST_DATABASE_URL) url.pathname = '/niticket_test';
if (!url.pathname.endsWith('_test')) throw new Error('Audio verification requires a test database');
process.env.DATABASE_URL = url.toString();
const { fixtures } = await import('../tests/helpers/fixtures');
const { db } = await import('@niticket/database');
const { createTicket } = await import('@niticket/core/application/tickets');
const { createUpload, completeUpload, downloadAttachment } =
  await import('@niticket/core/application/attachments');
const { settings } = await import('@niticket/core/application/settings');

function wav(seconds: number) {
  const size = 8000 * seconds * 2;
  const bytes = Buffer.alloc(44 + size);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + size, 4);
  bytes.write('WAVE', 8);
  bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(16000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(size, 40);
  return bytes;
}

async function scanInContainer(eventId: string) {
  const internal = new URL(url);
  internal.hostname = 'postgres';
  const code =
    "import {processScan} from './packages/core/src/application/jobs.ts';import {db} from './packages/database/src/index.ts';if(!new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))throw new Error('Test database required');let raw='';for await(const chunk of process.stdin)raw+=chunk;const e=await db.outboxEvent.findUniqueOrThrow({where:{id:JSON.parse(raw).eventId}});await processScan(e.id,e.payload);await db.$disconnect();";
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'docker',
      [
        'compose',
        'exec',
        '-T',
        '-e',
        'DATABASE_URL',
        'worker',
        'node',
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        code,
      ],
      {
        env: { ...process.env, DATABASE_URL: internal.toString() },
        stdio: ['pipe', 'ignore', 'inherit'],
      },
    );
    child.stdin.end(JSON.stringify({ eventId }));
    child.on('error', reject);
    child.on('exit', (status) =>
      status === 0 ? resolve() : reject(new Error('Container audio scan failed')),
    );
  });
}

try {
  const f = await fixtures();
  const actor = await f.actor(f.student.id);
  const ticket = await createTicket(
    actor,
    {
      departmentId: f.department.id,
      subject: 'آزمون پردازش واقعی پیام صوتی',
      body: 'این درخواست آزمایشی برای بررسی پردازش صوت در کانتینر است.',
    },
    randomUUID(),
  );
  const initial = await db.message.findFirstOrThrow({ where: { ticketId: ticket.id } });
  const policy = await settings();
  for (const seconds of [1, policy.maxVoiceSeconds + 1]) {
    const bytes = wav(seconds);
    const intent = await createUpload(actor, {
      ticketId: ticket.id,
      messageId: initial.id,
      filename: `audio-${seconds}.wav`,
      mime: 'audio/wav',
      size: bytes.length,
    });
    const uploaded = await fetch(intent.url, {
      method: 'PUT',
      headers: { 'content-type': 'audio/wav' },
      body: bytes,
    });
    if (!uploaded.ok) throw new Error('Audio upload failed');
    await completeUpload(actor, intent.id);
    const event = await db.outboxEvent.findFirstOrThrow({
      where: { type: 'SCAN_ATTACHMENT', payload: { path: ['attachmentId'], equals: intent.id } },
    });
    await scanInContainer(event.id);
    const result = await db.attachment.findUniqueOrThrow({ where: { id: intent.id } });
    const expected = seconds === 1 ? 'CLEAN' : 'REJECTED';
    if (result.scanStatus !== expected) throw new Error('Unexpected audio scan result');
    if (expected === 'CLEAN') await downloadAttachment(actor, intent.id);
    console.log(JSON.stringify({ seconds, scanStatus: result.scanStatus, verifiedInDocker: true }));
  }
} finally {
  await db.$disconnect();
}
