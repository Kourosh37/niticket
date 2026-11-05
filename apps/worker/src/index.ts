import { startJobs } from '@niticket/core/application/jobs';
import { db } from '@niticket/database';
import { log } from '@niticket/core/infrastructure/log';

const jobs = startJobs();
log.info({ operation: 'startup' }, 'Worker started');
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    await jobs.close();
    await db.$disconnect();
    process.exit(0);
  });
