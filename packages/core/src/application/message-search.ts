import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { db, Prisma } from '@niticket/database';
import { type Actor, assertRead, userRole } from '../domain/authorization';
import { fail } from '../domain/errors';
import { searchTerms, searchExcerpt, normalizeSearchText } from '../domain/search-text';
import { config } from '../infrastructure/config';
import { uuid } from '../validation';

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  });

export const messageSearchSchema = z
  .object({
    q: z.string().trim().max(200).default(''),
    ticketId: uuid.optional(),
    departmentId: uuid.optional(),
    senderId: uuid.optional(),
    from: day.optional(),
    to: day.optional(),
    kind: z.enum(['all', 'text', 'files', 'photos', 'audio', 'links']).default('all'),
    mode: z.enum(['all', 'any', 'phrase']).default('all'),
    sort: z.enum(['newest', 'oldest']).default('newest'),
    visibility: z.enum(['all', 'public', 'internal']).default('all'),
    cursor: z.string().max(1200).optional(),
  })
  .strict()
  .refine((data) => !data.from || !data.to || data.from <= data.to, {
    message: 'بازهٔ تاریخ معتبر نیست.',
    path: ['to'],
  });

export type MessageSearchFilters = z.infer<typeof messageSearchSchema>;

type SearchRow = {
  id: string;
  ticketId: string;
  body: string;
  createdAt: Date;
  visibility: 'PUBLIC' | 'INTERNAL';
  senderId: string;
  senderName: string;
  departmentName: string;
  creatorName: string;
};
const cursorSchema = z
  .object({
    id: uuid,
    at: z.iso.datetime(),
    snapshot: z.iso.datetime(),
    key: z.string().length(64),
  })
  .strict();

function encodeCursor(value: z.infer<typeof cursorSchema>) {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  const signature = createHmac('sha256', config().BETTER_AUTH_SECRET)
    .update(`message-search:v1:${payload}`)
    .digest('base64url');
  return `${payload}.${signature}`;
}

function decodeCursor(value: string, key: string) {
  try {
    const [payload, signature, extra] = value.split('.');
    if (!payload || !signature || extra) throw new Error();
    const expected = createHmac('sha256', config().BETTER_AUTH_SECRET)
      .update(`message-search:v1:${payload}`)
      .digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
      throw new Error();
    const cursor = cursorSchema.parse(
      JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
    );
    if (cursor.key !== key || new Date(cursor.snapshot).getTime() < Date.now() - 3600000)
      throw new Error();
    return cursor;
  } catch {
    fail('VALIDATION', 400, 'نتایج جستجو را دوباره از صفحهٔ اول دریافت کنید.');
  }
}

/** Every SQL branch is parameterized. Apply access to both the chat and message visibility. */
function access(actor: Actor) {
  if (!actor.active) fail('UNAUTHENTICATED', 401);
  if (actor.isAdmin) return Prisma.sql`TRUE`;
  if (userRole(actor) === 'STUDENT')
    return Prisma.sql`t."creatorId"=${actor.id} AND m.visibility='PUBLIC'`;
  const ids = actor.memberships
    .filter((member) => member.active)
    .map((member) => member.departmentId);
  return ids.length ? Prisma.sql`t."departmentId" IN (${Prisma.join(ids)})` : Prisma.sql`FALSE`;
}

const escapeLike = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;

function matching(term: string, ticketId?: string) {
  const pattern = escapeLike(term);
  return Prisma.sql`m.id IN (
    SELECT text_message.id FROM "Message" text_message
      WHERE ${ticketId ? Prisma.sql`text_message."ticketId"=${ticketId} AND` : Prisma.empty} niticket_search_text(text_message.body) LIKE ${pattern}
    UNION
    SELECT a."messageId" FROM "Attachment" a
      JOIN "Message" attached ON attached.id=a."messageId" AND attached."ticketId"=a."ticketId"
      WHERE a."scanStatus"='CLEAN' AND a."messageId" IS NOT NULL
        AND a."noteId" IS NULL AND a."avatarOwnerId" IS NULL
        ${ticketId ? Prisma.sql`AND attached."ticketId"=${ticketId}` : Prisma.empty}
        AND niticket_search_text(a.filename) LIKE ${pattern}
  )`;
}

function matchingFiles(pattern: string) {
  return Prisma.sql`SELECT a."messageId" FROM "Attachment" a
    JOIN "Message" attached ON attached.id=a."messageId" AND attached."ticketId"=a."ticketId"
    WHERE a."scanStatus"='CLEAN' AND a."messageId" IS NOT NULL
      AND a."noteId" IS NULL AND a."avatarOwnerId" IS NULL
      AND niticket_search_text(a.filename) LIKE ${pattern}`;
}

async function boundedQuery<T>(query: Prisma.Sql): Promise<T> {
  try {
    return await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '2500ms'`;
        // Search selectivity varies dramatically; a cached generic plan can turn rare lookups into scans.
        await tx.$executeRaw`SET LOCAL plan_cache_mode = force_custom_plan`;
        return tx.$queryRaw<T>(query);
      },
      { timeout: 5000, maxWait: 3000 },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2028' || (error.code === 'P2010' && error.meta?.code === '57014'))
    )
      fail('SEARCH_BUSY', 503, 'جستجو زمان‌بر شد؛ عبارت دقیق‌تر یا بازهٔ تاریخ انتخاب کنید.');
    throw error;
  }
}

export async function searchMessages(actor: Actor, input: unknown) {
  const data = messageSearchSchema.parse(input);
  const { cursor: rawCursor, ...filters } = data;
  const terms = searchTerms(data.q, data.mode);
  if (
    terms.include.length + terms.exclude.length > 8 ||
    (data.q && (normalizeSearchText(data.q).length < 2 || !terms.include.length))
  )
    fail('VALIDATION', 400, 'حداقل دو حرف و حداکثر هشت واژه وارد کنید.');
  const permitted = access(actor);
  // A scoped search must not reveal whether an inaccessible chat has matching messages.
  if (data.ticketId) {
    const ticket = await db.ticket.findUnique({
      where: { id: data.ticketId },
      select: { creatorId: true, departmentId: true },
    });
    if (!ticket) fail();
    assertRead(actor, ticket);
  }
  const key = createHash('sha256')
    .update(
      JSON.stringify({
        filters,
        actor: actor.id,
        role: userRole(actor),
        units: actor.memberships
          .filter((m) => m.active)
          .map((m) => m.departmentId)
          .sort(),
      }),
    )
    .digest('hex');
  const cursor = rawCursor ? decodeCursor(rawCursor, key) : null;
  const snapshot = cursor?.snapshot ?? new Date().toISOString();
  const hasFilters = !!(
    data.ticketId ||
    data.departmentId ||
    data.senderId ||
    data.from ||
    data.to ||
    data.kind !== 'all' ||
    data.visibility !== 'all'
  );
  if (!data.q && !hasFilters)
    return { items: [], nextCursor: null, terms: terms.include, snapshot };
  const clauses: Prisma.Sql[] = [permitted, Prisma.sql`m."createdAt"<=${new Date(snapshot)}`];
  if (data.ticketId) clauses.push(Prisma.sql`m."ticketId"=${data.ticketId}`);
  if (data.departmentId) clauses.push(Prisma.sql`t."departmentId"=${data.departmentId}`);
  if (data.senderId) clauses.push(Prisma.sql`m."senderId"=${data.senderId}`);
  if (data.visibility !== 'all')
    clauses.push(Prisma.sql`m.visibility::text=${data.visibility.toUpperCase()}`);
  if (data.from)
    clauses.push(
      Prisma.sql`m."createdAt">=((${data.from}::date::timestamp AT TIME ZONE 'Asia/Tehran') AT TIME ZONE 'UTC')`,
    );
  if (data.to)
    clauses.push(
      Prisma.sql`m."createdAt"<(((${data.to}::date+1)::timestamp AT TIME ZONE 'Asia/Tehran') AT TIME ZONE 'UTC')`,
    );
  const singleTerm = terms.include.length === 1 && terms.exclude.length === 0;
  if (terms.include.length && !singleTerm)
    clauses.push(
      Prisma.sql`(${Prisma.join(
        terms.include.map((term) => matching(term, data.ticketId)),
        data.mode === 'any' ? ' OR ' : ' AND ',
      )})`,
    );
  for (const term of terms.exclude)
    clauses.push(Prisma.sql`NOT (${matching(term, data.ticketId)})`);
  if (data.kind === 'links') clauses.push(Prisma.sql`m.body ~* '(https?://|www\.)'`);
  if (data.kind === 'text')
    clauses.push(
      Prisma.sql`NOT EXISTS (SELECT 1 FROM "Attachment" a WHERE a."messageId"=m.id AND a."ticketId"=m."ticketId" AND a."scanStatus"='CLEAN' AND a."noteId" IS NULL AND a."avatarOwnerId" IS NULL)`,
    );
  if (['files', 'photos', 'audio'].includes(data.kind)) {
    const mime =
      data.kind === 'photos'
        ? Prisma.sql`a."detectedMime" LIKE 'image/%'`
        : data.kind === 'audio'
          ? Prisma.sql`a."detectedMime" LIKE 'audio/%'`
          : Prisma.sql`a."detectedMime" NOT LIKE 'image/%' AND a."detectedMime" NOT LIKE 'audio/%'`;
    clauses.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "Attachment" a WHERE a."messageId"=m.id AND a."ticketId"=m."ticketId" AND a."scanStatus"='CLEAN' AND a."noteId" IS NULL AND a."avatarOwnerId" IS NULL AND ${mime})`,
    );
  }
  if (cursor)
    clauses.push(
      data.sort === 'newest'
        ? Prisma.sql`(m."createdAt",m.id)<(${new Date(cursor.at)},${cursor.id})`
        : Prisma.sql`(m."createdAt",m.id)>(${new Date(cursor.at)},${cursor.id})`,
    );
  const order =
    data.sort === 'newest'
      ? Prisma.sql`m."createdAt" DESC,m.id DESC`
      : Prisma.sql`m."createdAt" ASC,m.id ASC`;
  const selection = Prisma.sql`
    SELECT m.id,m."ticketId",m.body,m."createdAt",m.visibility,m."senderId",u.name AS "senderName",
      d.name AS "departmentName",creator.name AS "creatorName"
    FROM "Message" m JOIN "Ticket" t ON t.id=m."ticketId"
      JOIN "User" u ON u.id=m."senderId" JOIN "User" creator ON creator.id=t."creatorId"
      JOIN "Department" d ON d.id=t."departmentId"`;
  // Bound each ordered branch before combining. Common terms must not materialize every hit.
  const rows = await boundedQuery<SearchRow[]>(
    singleTerm
      ? Prisma.sql`
    SELECT * FROM (
      (${selection} WHERE ${Prisma.join(clauses, ' AND ')} AND niticket_search_text(m.body) LIKE ${escapeLike(terms.include[0])} ORDER BY ${order} LIMIT 21)
      UNION
      (${selection} WHERE ${Prisma.join(clauses, ' AND ')} AND m.id IN (${matchingFiles(escapeLike(terms.include[0]))}) ORDER BY ${order} LIMIT 21)
    ) matched ORDER BY ${data.sort === 'newest' ? Prisma.sql`"createdAt" DESC,id DESC` : Prisma.sql`"createdAt" ASC,id ASC`} LIMIT 21`
      : Prisma.sql`${selection} WHERE ${Prisma.join(clauses, ' AND ')} ORDER BY ${order} LIMIT 21`,
  );
  const page = rows.slice(0, 20);
  const filenameMatch = terms.include.length
    ? Prisma.sql`(${Prisma.join(
        terms.include.map(
          (term) => Prisma.sql`niticket_search_text(a.filename) LIKE ${escapeLike(term)}`,
        ),
        ' OR ',
      )})`
    : Prisma.sql`FALSE`;
  const attachments = page.length
    ? await boundedQuery<
        {
          id: string;
          messageId: string;
          ticketId: string;
          filename: string;
          detectedMime: string | null;
        }[]
      >(Prisma.sql`
        WITH ranked AS (
          SELECT a.id,a."messageId",a."ticketId",a.filename,a."detectedMime",
            row_number() OVER (PARTITION BY a."messageId" ORDER BY CASE WHEN ${filenameMatch} THEN 0 ELSE 1 END,a.id) AS position
          FROM "Attachment" a JOIN "Message" m ON m.id=a."messageId" AND m."ticketId"=a."ticketId"
          WHERE a."messageId" IN (${Prisma.join(page.map((row) => row.id))}) AND a."scanStatus"='CLEAN'
            AND a."avatarOwnerId" IS NULL AND a."noteId" IS NULL
        ) SELECT id,"messageId","ticketId",filename,"detectedMime" FROM ranked WHERE position<=5 ORDER BY "messageId",position`)
    : [];
  return {
    items: page.map(({ body, ...row }) => ({
      ...row,
      excerpt: searchExcerpt(body, terms.include),
      chatName:
        userRole(actor) === 'STUDENT'
          ? row.departmentName
          : `${row.creatorName} · ${row.departmentName}`,
      attachments: attachments
        .filter((a) => a.messageId === row.id && a.ticketId === row.ticketId)
        .map(({ id, filename, detectedMime }) => ({ id, filename, detectedMime })),
    })),
    nextCursor:
      rows.length > 20
        ? encodeCursor({ id: page[19].id, at: page[19].createdAt.toISOString(), snapshot, key })
        : null,
    terms: terms.include,
    snapshot,
  };
}

export async function searchSenders(actor: Actor, input: unknown) {
  const data = z
    .object({
      q: z.string().trim().max(100).default(''),
      ticketId: uuid.optional(),
      cursor: uuid.optional(),
    })
    .strict()
    .parse(input);
  const clauses = [access(actor)];
  if (data.ticketId) {
    const ticket = await db.ticket.findUnique({
      where: { id: data.ticketId },
      select: { creatorId: true, departmentId: true },
    });
    if (!ticket) fail();
    assertRead(actor, ticket);
    clauses.push(Prisma.sql`m."ticketId"=${data.ticketId}`);
  }
  if (data.q)
    clauses.push(
      Prisma.sql`niticket_search_text(u.name) LIKE ${escapeLike(normalizeSearchText(data.q))}`,
    );
  if (data.cursor) clauses.push(Prisma.sql`u.id>${data.cursor}`);
  const rows = await boundedQuery<{ id: string; name: string }[]>(Prisma.sql`
    SELECT u.id,u.name FROM "User" u WHERE EXISTS (
      SELECT 1 FROM "Message" m JOIN "Ticket" t ON t.id=m."ticketId"
      WHERE m."senderId"=u.id AND ${Prisma.join(clauses, ' AND ')}
    ) ORDER BY u.id ASC LIMIT 21`);
  return { items: rows.slice(0, 20), nextCursor: rows.length > 20 ? rows[19].id : null };
}
