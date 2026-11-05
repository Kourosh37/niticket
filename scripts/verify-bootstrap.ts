import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

const url = new URL(process.env.DATABASE_URL!);
url.pathname = '/niticket_bootstrap_test';
const input = {
  name: 'مدیر آزمون راه‌اندازی',
  email: `bootstrap-${randomUUID()}@example.test`,
  password: randomBytes(24).toString('base64url'),
  accountType: 'STAFF',
};

async function run(args: string[], env: NodeJS.ProcessEnv, body?: unknown) {
  return new Promise<number>((done, reject) => {
    const child = spawn(process.execPath, args, { env, stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', reject);
    if (body) child.stdin.end(JSON.stringify(body));
    else child.stdin.end();
    child.on('exit', (code) => done(code ?? 1));
  });
}

const env = { ...process.env, DATABASE_URL: url.toString(), BOOTSTRAP_ENABLED: 'true' };
if (
  (await run(
    [
      resolve('node_modules/prisma/build/index.js'),
      'migrate',
      'deploy',
      '--schema',
      'packages/database/prisma/schema.prisma',
    ],
    env,
  )) !== 0
)
  throw new Error(
    'Create niticket_bootstrap_test and apply migrations before verifying bootstrap.',
  );
const db = new PrismaClient({ datasourceUrl: url.toString() });
try {
  if (await db.user.count())
    throw new Error(
      'Bootstrap verification requires an empty dedicated test database; it will not reset existing data.',
    );
  const results = await Promise.all([
    run(['--import', 'tsx', 'scripts/bootstrap.ts'], env, input),
    run(['--import', 'tsx', 'scripts/bootstrap.ts'], env, input),
  ]);
  if (results.some((code) => code !== 0)) throw new Error('Concurrent bootstrap failed');
  if ((await db.user.count({ where: { isAdmin: true } })) !== 1)
    throw new Error('Concurrent bootstrap created multiple administrators');
  const account = await db.account.findFirstOrThrow();
  if (!account.password?.startsWith('$argon2id$'))
    throw new Error('Password was not stored with Argon2id');
  if (
    (await run(['--import', 'tsx', 'scripts/bootstrap.ts'], env, {
      ...input,
      password: randomBytes(24).toString('base64url'),
    })) !== 0
  )
    throw new Error('Idempotent bootstrap failed');
  if (
    (await db.account.findUniqueOrThrow({ where: { id: account.id } })).password !==
    account.password
  )
    throw new Error('Rerun changed credentials');
  if (
    (await run(['--import', 'tsx', 'scripts/bootstrap.ts'], env, {
      ...input,
      email: 'different@example.test',
    })) === 0
  )
    throw new Error('Second initial administrator was allowed');
  if (
    (await run(
      ['--import', 'tsx', 'scripts/bootstrap.ts'],
      { ...env, BOOTSTRAP_ENABLED: 'false' },
      input,
    )) === 0
  )
    throw new Error('Disabled bootstrap was allowed');
  console.log(
    JSON.stringify(
      {
        concurrentSingleAdministrator: true,
        argon2id: true,
        idempotentWithoutCredentialChange: true,
        secondIdentityRejected: true,
        disabledByDefault: true,
        auditRecords: await db.auditLog.count(),
      },
      null,
      2,
    ),
  );
} finally {
  await db.$disconnect();
}
