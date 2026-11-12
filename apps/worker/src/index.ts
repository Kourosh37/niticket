import { startJobs } from '@niticket/core/application/jobs';
import { db } from '@niticket/database';
import { log } from '@niticket/core/infrastructure/log';
import { drainRealtime } from '@niticket/core/infrastructure/realtime';
import { redis } from '@niticket/core/infrastructure/redis';
import { closeReadCache } from '@niticket/core/infrastructure/read-cache';

const jobs = startJobs();
log.info({ operation: 'startup' }, 'Worker started');
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    await jobs.close();
    await drainRealtime();
    closeReadCache();
    redis().disconnect();
    await db.$disconnect();
    process.exit(0);
  });
