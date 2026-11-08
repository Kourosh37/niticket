import { db, Prisma } from '@niticket/database';

// Maintenance only: never called by Compose, startup, migrations, or HTTP routes.
const args = process.argv.slice(2),
  nameIndex = args.indexOf('--database');
const requested = nameIndex >= 0 ? args[nameIndex + 1] : undefined;
const configured = process.env.DATABASE_URL
  ? decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1))
  : '';
if (
  !args.includes('--confirm-reset') ||
  !requested ||
  requested !== configured ||
  ['postgres', 'template0', 'template1'].includes(requested)
)
  throw new Error(
    'Refusing reset. Supply --database with the exact configured database name and --confirm-reset.',
  );

try {
  const tables = Prisma.dmmf.datamodel.models.map((model) =>
    Prisma.raw(`public."${(model.dbName ?? model.name).replace(/"/g, '""')}"`),
  );
  await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7149821)`;
      // The maintenance owner may reset the append-only audit log only in this transaction.
      // DDL and TRUNCATE roll back together if any step fails.
      await tx.$executeRaw`ALTER TABLE public."AuditLog" DISABLE TRIGGER audit_immutable`;
      // All application tables together; RESTRICT prevents cascading into unrelated tables.
      // Keep migration records, schema, indexes and functions intact.
      await tx.$executeRaw(Prisma.sql`TRUNCATE TABLE ${Prisma.join(tables)} RESTART IDENTITY`);
      await tx.$executeRaw`ALTER TABLE public."AuditLog" ENABLE TRIGGER audit_immutable`;
    },
    { timeout: 30000 },
  );
  console.log(
    `Cleared ${tables.length} application tables in ${requested}. Schema and migration history are preserved.`,
  );
} finally {
  await db.$disconnect();
}
