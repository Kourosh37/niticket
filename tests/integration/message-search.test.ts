import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '@niticket/database';
import { fixtures } from '../helpers/fixtures';
import { searchMessages, searchSenders } from '@niticket/core/application/message-search';
import { normalizeSearchText } from '@niticket/core/domain/search-text';
import { getMessageContext, getMessagePage, getTicket } from '@niticket/core/application/tickets';

let f: Awaited<ReturnType<typeof fixtures>>;
const tag = `search${randomUUID().slice(0, 8)}`;
beforeAll(async () => {
  f = await fixtures();
});
afterAll(async () => {
  await db.$disconnect();
});

async function chat(creatorId = f.student.id, departmentId = f.department.id) {
  return db.ticket.create({ data: { creatorId, departmentId, subject: tag } });
}

async function message(
  ticketId: string,
  body: string,
  visibility: 'PUBLIC' | 'INTERNAL' = 'PUBLIC',
  createdAt = new Date('2026-09-01T10:00:00Z'),
  senderId = f.student.id,
) {
  return db.message.create({ data: { ticketId, body, visibility, createdAt, senderId } });
}

async function file(
  ticketId: string,
  messageId: string,
  filename: string,
  detectedMime = 'application/pdf',
  scanStatus: 'CLEAN' | 'QUARANTINED' = 'CLEAN',
) {
  return db.attachment.create({
    data: {
      ticketId,
      messageId,
      filename,
      detectedMime,
      scanStatus,
      declaredMime: detectedMime,
      objectKey: randomUUID(),
      expectedSize: 10,
      size: 10,
      uploaderId: f.student.id,
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
}

it('normalizes Persian text identically in SQL and JavaScript and uses expression indexes', async () => {
  for (const value of [
    ' كلاس‌ رياضي ۱۲۳ ٤٥٦ ',
    'نــمــره اَصلی',
    'ＡＢＣ\tجلسه\u200f دوم',
    'ثبت\nنام',
    'ﻛﻼﺱ',
  ]) {
    const rows = await db.$queryRaw<
      { value: string }[]
    >`SELECT niticket_search_text(${value}) AS value`;
    expect(rows[0].value).toBe(normalizeSearchText(value));
  }
  const plan = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
    return tx.$queryRaw`EXPLAIN (FORMAT JSON) SELECT id FROM "Message" WHERE niticket_search_text(body) LIKE ${'%indexedneedle%'} `;
  });
  expect(JSON.stringify(plan)).toContain('Message_search_body_idx');
});

it('searches all stored history, folds Persian variants, and supports phrases, alternatives and exclusions', async () => {
  const ticket = await chat(),
    actor = await f.actor(f.student.id);
  const target = await message(ticket.id, `${tag} درخواست ثبت‌نام كلاس رياضي ۱۲۳`);
  await db.message.createMany({
    data: Array.from({ length: 120 }, (_, i) => ({
      ticketId: ticket.id,
      senderId: f.student.id,
      body: `جدید ${i}`,
      createdAt: new Date('2026-10-01T10:00:00Z'),
    })),
  });
  expect(
    (await searchMessages(actor, { ticketId: ticket.id, q: 'ثبت نام کلاس ریاضی 123' })).items.map(
      (row) => row.id,
    ),
  ).toEqual([target.id]);
  expect(
    (await searchMessages(actor, { ticketId: ticket.id, q: 'ثبت نام کلاس', mode: 'phrase' }))
      .items[0].id,
  ).toBe(target.id);
  expect(
    (await searchMessages(actor, { ticketId: ticket.id, q: 'کلاس ناموجود', mode: 'any' })).items[0]
      .id,
  ).toBe(target.id);
  expect(
    (await searchMessages(actor, { ticketId: ticket.id, q: 'کلاس ناموجود' })).items,
  ).toHaveLength(0);
  expect((await searchMessages(actor, { q: `${tag} -رياضي` })).items).toHaveLength(0);
  expect(
    (await searchMessages(actor, { q: '"ثبت نام" "کلاس ریاضی"' })).items.some(
      (row) => row.id === target.id,
    ),
  ).toBe(true);
  const wild = await message(ticket.id, `${tag} literal 100%_done`);
  await message(ticket.id, `${tag} literal 100anythingdone`);
  expect(
    (await searchMessages(actor, { ticketId: ticket.id, q: '100%_done' })).items.map(
      (row) => row.id,
    ),
  ).toEqual([wild.id]);
  expect(
    (await searchMessages(actor, { q: "' OR 1=1 --", ticketId: ticket.id })).items,
  ).toHaveLength(0);
});

it('never exposes inaccessible chats, internal messages, private filenames or private senders', async () => {
  const own = await chat(),
    foreign = await chat(f.outsider.id),
    elsewhere = await chat(f.outsider.id, f.destination.id);
  const publicMessage = await message(own.id, `${tag} public`);
  const privateMessage = await message(
    own.id,
    `${tag} private`,
    'INTERNAL',
    undefined,
    f.manager.id,
  );
  await file(own.id, privateMessage.id, `${tag}-confidential.pdf`);
  await message(foreign.id, `${tag} foreign`);
  await message(elsewhere.id, `${tag} elsewhere`);
  const student = await f.actor(f.student.id),
    officer = await f.actor(f.agent.id),
    admin = await f.actor(f.admin.id);
  const studentRows = await searchMessages(student, { q: tag });
  expect(studentRows.items.some((row) => row.id === publicMessage.id)).toBe(true);
  expect(
    studentRows.items.some((row) => row.id === privateMessage.id || row.ticketId === foreign.id),
  ).toBe(false);
  expect((await searchMessages(student, { q: 'confidential' })).items).toHaveLength(0);
  expect((await searchMessages(student, { q: tag, visibility: 'internal' })).items).toHaveLength(0);
  expect(
    (await searchMessages(officer, { q: tag })).items.some((row) => row.id === privateMessage.id),
  ).toBe(true);
  expect(
    (await searchMessages(officer, { q: tag })).items.some((row) => row.ticketId === elsewhere.id),
  ).toBe(false);
  expect(
    (await searchMessages(admin, { q: tag })).items.some((row) => row.ticketId === elsewhere.id),
  ).toBe(true);
  await expect(searchMessages(student, { q: tag, ticketId: foreign.id })).rejects.toMatchObject({
    status: 404,
  });
  expect((await searchSenders(student, { ticketId: own.id })).items.map((row) => row.id)).toEqual([
    f.student.id,
  ]);
  expect(
    (await searchSenders(officer, { ticketId: own.id })).items.some(
      (row) => row.id === f.manager.id,
    ),
  ).toBe(true);
  await expect(searchSenders(student, { ticketId: foreign.id })).rejects.toMatchObject({
    status: 404,
  });
  officer.memberships = [];
  expect((await searchMessages(officer, { q: tag })).items).toHaveLength(0);
});

it('filters clean file names and media, senders, local dates, text and links', async () => {
  const ticket = await chat(),
    actor = await f.actor(f.student.id);
  const document = await message(ticket.id, 'مدرک'),
    image = await message(ticket.id, 'عکس'),
    audio = await message(ticket.id, 'وویس');
  await file(ticket.id, document.id, `${tag}-كارنامه۱۲.pdf`);
  await file(ticket.id, image.id, 'photo.png', 'image/png');
  await file(ticket.id, audio.id, 'voice.webm', 'audio/webm');
  const quarantine = await message(ticket.id, 'فایل در انتظار');
  await file(ticket.id, quarantine.id, `${tag}-quarantine.pdf`, 'application/pdf', 'QUARANTINED');
  expect(
    (await searchMessages(actor, { q: 'کارنامه12', kind: 'files' })).items.map((row) => row.id),
  ).toEqual([document.id]);
  expect(
    (await searchMessages(actor, { ticketId: ticket.id, kind: 'photos' })).items.map(
      (row) => row.id,
    ),
  ).toEqual([image.id]);
  expect(
    (await searchMessages(actor, { ticketId: ticket.id, kind: 'audio' })).items.map(
      (row) => row.id,
    ),
  ).toEqual([audio.id]);
  expect((await searchMessages(actor, { q: 'quarantine' })).items).toHaveLength(0);
  const link = await message(
    ticket.id,
    'https://example.test/info',
    'PUBLIC',
    new Date('2026-09-03T20:30:00Z'),
    f.agent.id,
  );
  expect(
    (
      await searchMessages(actor, {
        ticketId: ticket.id,
        kind: 'links',
        senderId: f.agent.id,
        from: '2026-09-04',
        to: '2026-09-04',
      })
    ).items.map((row) => row.id),
  ).toEqual([link.id]);
  expect(
    (await searchMessages(actor, { ticketId: ticket.id, kind: 'links', to: '2026-09-03' })).items,
  ).toHaveLength(0);
  expect(
    (await searchMessages(actor, { ticketId: ticket.id, kind: 'text' })).items.some(
      (row) => row.id === document.id,
    ),
  ).toBe(false);
});

it('paginates stably with tied dates, signed query-bound cursors and a fixed snapshot', async () => {
  const ticket = await chat(),
    actor = await f.actor(f.student.id),
    body = `${tag} paging`;
  await db.message.createMany({
    data: Array.from({ length: 63 }, () => ({
      ticketId: ticket.id,
      senderId: actor.id,
      body,
      createdAt: new Date('2026-09-01T00:00:00Z'),
    })),
  });
  const first = await searchMessages(actor, { ticketId: ticket.id, q: 'paging' });
  expect(first.items).toHaveLength(20);
  const later = await message(ticket.id, body, 'PUBLIC', new Date(Date.now() + 1000));
  const ids = first.items.map((row) => row.id);
  let cursor = first.nextCursor;
  while (cursor) {
    const page = await searchMessages(actor, { ticketId: ticket.id, q: 'paging', cursor });
    expect(page.items.length).toBeLessThanOrEqual(20);
    ids.push(...page.items.map((row) => row.id));
    cursor = page.nextCursor;
  }
  expect(ids).toHaveLength(63);
  expect(new Set(ids).size).toBe(63);
  expect(ids).not.toContain(later.id);
  await expect(
    searchMessages(actor, { ticketId: ticket.id, q: 'paging', cursor: first.nextCursor! + 'x' }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    searchMessages(actor, { ticketId: ticket.id, q: 'different', cursor: first.nextCursor! }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    searchMessages(await f.actor(f.admin.id), {
      ticketId: ticket.id,
      q: 'paging',
      cursor: first.nextCursor!,
    }),
  ).rejects.toMatchObject({ status: 400 });
  const oldest = await searchMessages(actor, { ticketId: ticket.id, q: 'paging', sort: 'oldest' });
  expect(oldest.items.map((row) => row.id)).toEqual(ids.slice(-20).reverse());
  expect(JSON.stringify(first)).not.toMatch(/objectKey|checksum|email|phoneNumber/);
  await expect(searchMessages(actor, { q: 'a' })).rejects.toMatchObject({ status: 400 });
  await expect(searchMessages(actor, { q: 'valid', from: '2026-02-30' })).rejects.toBeDefined();
  await expect(
    searchMessages(actor, { q: 'valid', from: '2026-10-01', to: '2026-01-01' }),
  ).rejects.toBeDefined();
  expect((await searchMessages(actor, {})).items).toHaveLength(0);
});

it('jumps directly to an old message with bounded surrounding pages and rechecks visibility', async () => {
  const ticket = await chat(),
    other = await chat(f.outsider.id),
    actor = await f.actor(f.student.id);
  const ids = Array.from({ length: 180 }, () => randomUUID());
  const base = new Date('2026-09-01T00:00:00Z').getTime();
  await db.message.createMany({
    data: ids.map((id, index) => ({
      id,
      ticketId: ticket.id,
      senderId: f.student.id,
      body: `${tag} context ${index}`,
      createdAt: new Date(base + index * 1000),
    })),
  });
  const privateMessage = await message(
    ticket.id,
    'PRIVATE_CONTEXT_SEARCH',
    'INTERNAL',
    new Date(base + 60500),
    f.agent.id,
  );
  const context = await getMessageContext(actor, ticket.id, ids[60]);
  expect(context.items).toHaveLength(50);
  expect(context.items[25].id).toBe(ids[60]);
  expect(context.focusId).toBe(ids[60]);
  const detail = await getTicket(actor, ticket.id, undefined, undefined, false, ids[60]);
  expect(detail.messages.map((row) => row.id)).toEqual(context.items.map((row) => row.id));
  expect(detail.messageFocus).toEqual({ focusId: ids[60], newerCursor: ids[84] });
  expect(JSON.stringify(context)).not.toContain('PRIVATE_CONTEXT_SEARCH');
  expect(context.olderCursor).toBe(ids[35]);
  expect(context.newerCursor).toBe(ids[84]);
  const older = await getMessagePage(actor, ticket.id, context.olderCursor!);
  expect(older.items.map((row) => row.id)).toEqual(ids.slice(0, 35));
  const newer = await getMessagePage(actor, ticket.id, context.newerCursor!, 'newer');
  expect(newer.items.map((row) => row.id)).toEqual(ids.slice(85, 135));
  expect(newer.nextCursor).toBe(ids[134]);
  const rest = await getMessagePage(actor, ticket.id, newer.nextCursor!, 'newer');
  expect(rest.items.map((row) => row.id)).toEqual(ids.slice(135));
  expect(rest.nextCursor).toBeNull();
  await expect(getMessageContext(actor, ticket.id, privateMessage.id)).rejects.toMatchObject({
    status: 404,
  });
  await expect(getMessageContext(actor, other.id, ids[60])).rejects.toMatchObject({ status: 404 });
  const officer = await f.actor(f.agent.id);
  expect((await getMessageContext(officer, ticket.id, privateMessage.id)).focusId).toBe(
    privateMessage.id,
  );
  await expect(getMessagePage(actor, ticket.id, undefined, 'newer')).rejects.toMatchObject({
    status: 400,
  });
});
