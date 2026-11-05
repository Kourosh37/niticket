import { db } from '@niticket/database';
import { hashPassword } from '@niticket/core/infrastructure/auth';
import { userSchema } from '@niticket/core/validation';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';

if (process.env.BOOTSTRAP_ENABLED !== 'true')
  throw new Error('Bootstrap disabled. Explicitly set BOOTSTRAP_ENABLED=true for this invocation.');
// Read a JSON object over stdin so credentials never enter shell arguments or logs.
const lines = createInterface({ input: process.stdin, terminal: false });
let raw = '';
for await (const line of lines) raw += line;
const input = userSchema.parse(JSON.parse(raw));
const password = await hashPassword(input.password);
try {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(7149821)`;
    const existing = await tx.user.findFirst({ where: { isAdmin: true } });
    if (existing) {
      if (existing.email === input.email) {
        console.log('Administrator already exists; no changes made.');
        return;
      }
      throw new Error('Initial administrator already exists. Use audited administration.');
    }
    const id = randomUUID();
    await tx.user.create({
      data: {
        id,
        name: input.name,
        email: input.email,
        isAdmin: true,
        role: 'ADMIN',
        emailVerified: true,
        accountType: 'STAFF',
        accounts: { create: { providerId: 'credential', accountId: id, password } },
      },
    });
    await tx.auditLog.create({
      data: { actorId: id, action: 'ADMIN_BOOTSTRAPPED', resourceId: id, metadata: {} },
    });
    console.log('Initial administrator created. Disable BOOTSTRAP_ENABLED.');
  });
} finally {
  await db.$disconnect();
}
