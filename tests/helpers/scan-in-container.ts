import { spawn } from 'node:child_process';

/** Uses the project's Linux ffmpeg/ClamAV runtime when the host lacks ffmpeg. */
export async function scanInContainer(eventId: string) {
  const internal = new URL(process.env.DATABASE_URL!);
  if (!internal.pathname.endsWith('_test')) throw new Error('Test database required');
  internal.hostname = 'postgres';
  const code =
    "import {processScan} from './packages/core/src/application/jobs.ts';import {drainRealtime} from './packages/core/src/infrastructure/realtime.ts';import {closeReadCache} from './packages/core/src/infrastructure/read-cache.ts';import {redis} from './packages/core/src/infrastructure/redis.ts';import {db} from './packages/database/src/index.ts';try{let raw='';for await(const chunk of process.stdin)raw+=chunk;const e=await db.outboxEvent.findUniqueOrThrow({where:{id:JSON.parse(raw).eventId}});await processScan(e.id,e.payload);}finally{await drainRealtime();closeReadCache();redis().disconnect();await db.$disconnect();}";
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'docker',
      [
        'compose',
        'exec',
        '-T',
        '-e',
        'DATABASE_URL',
        '-e',
        'QUEUE_NAME=niticket-test',
        'media-worker',
        'bun',
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
      status === 0 ? resolve() : reject(new Error('Container media scan failed')),
    );
  });
}
