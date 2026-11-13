import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaClient, Prisma } from '@prisma/client';
import {
  S3Client,
  ListObjectVersionsCommand,
  DeleteObjectsCommand,
  DeleteBucketCommand,
} from '@aws-sdk/client-s3';
import Redis from 'ioredis';
import { Queue } from 'bullmq';
import { assertEphemeralDatabase, testResourceNames } from './test-resources.ts';

try {
  loadEnvFile('.env');
} catch {
  /* CI supplies environment. */
}
const suite = process.argv[2];
const suiteArgs = process.argv.slice(3);
if (suite === 'e2e' && !suiteArgs.some((arg) => arg.startsWith('--project')))
  suiteArgs.push('--project=chromium');
if (!['integration', 'e2e'].includes(suite)) throw new Error('Choose integration or e2e');
const names = testResourceNames(randomUUID().replaceAll('-', '').slice(0, 16));
const database = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL);
database.pathname = `/${names.database}`;
const adminUrl = new URL(process.env.TEST_ADMIN_DATABASE_URL ?? process.env.DATABASE_URL);
adminUrl.pathname = '/postgres';
const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
const env = {
  ...process.env,
  DATABASE_URL: database.toString(),
  TEST_DATABASE_URL: database.toString(),
  TEST_QUEUE_NAME: names.queue,
  QUEUE_NAME: names.queue,
  S3_BUCKET: names.bucket,
};
if (suite === 'e2e') {
  env.APP_ORIGIN = 'http://localhost:3001';
  env.BETTER_AUTH_URL = env.APP_ORIGIN;
}
let created = false,
  bucketAttempted = false,
  child;
const terminate = () => child?.kill('SIGINT');
process.on('SIGINT', terminate);
process.on('SIGTERM', terminate);

async function run(args) {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, args, { env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => {
      child = undefined;
      resolve(code ?? 1);
    });
  });
}

async function cleanBucket() {
  const s3 = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION ?? 'us-east-1',
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
    requestHandler: { connectionTimeout: 3000, requestTimeout: 30000, throwOnRequestTimeout: true },
  });
  try {
    let KeyMarker, VersionIdMarker;
    do {
      const page = await s3.send(
        new ListObjectVersionsCommand({ Bucket: names.bucket, KeyMarker, VersionIdMarker }),
      );
      const Objects = [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])].map(
        ({ Key, VersionId }) => ({ Key, VersionId }),
      );
      if (Objects.length) {
        const deleted = await s3.send(
          new DeleteObjectsCommand({ Bucket: names.bucket, Delete: { Objects, Quiet: true } }),
        );
        if (deleted.Errors?.length) throw new Error('Failed to clean isolated storage versions');
      }
      KeyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
      VersionIdMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
    } while (KeyMarker);
    await s3.send(new DeleteBucketCommand({ Bucket: names.bucket }));
  } catch (error) {
    if (error?.$metadata?.httpStatusCode !== 404) throw error;
  } finally {
    s3.destroy();
  }
}

async function cleanRedis() {
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 3000 });
  const queues = [names.queue, `${names.queue}-media`].map(
    (name) => new Queue(name, { connection }),
  );
  try {
    await Promise.all(queues.map((queue) => queue.obliterate({ force: true })));
  } finally {
    await Promise.all(queues.map((queue) => queue.close()));
    connection.disconnect();
  }
  for (const url of new Set([env.REDIS_URL, env.CACHE_REDIS_URL ?? 'redis://127.0.0.1:6380'])) {
    const client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      connectTimeout: 500,
      commandTimeout: 1000,
      retryStrategy: () => null,
    });
    client.on('error', () => {});
    try {
      await client.connect();
      let cursor = '0';
      do {
        const [next, keys] = await client.scan(
          cursor,
          'MATCH',
          `niticket:${names.queue}:/${names.database}:*`,
          'COUNT',
          100,
        );
        if (keys.length) await client.unlink(...keys);
        cursor = next;
      } while (cursor !== '0');
    } catch {
      console.warn('Optional test cache unavailable during namespace cleanup.');
    } finally {
      client.disconnect();
    }
  }
}

try {
  assertEphemeralDatabase(database.toString(), names.database);
  await admin.$executeRaw(Prisma.raw(`CREATE DATABASE "${names.database}"`));
  created = true;
  console.log(`Isolated ${suite} resources: ${names.database}`);
  if (
    await run([
      resolve('node_modules/prisma/build/index.js'),
      'migrate',
      'deploy',
      '--schema',
      'packages/database/prisma/schema.prisma',
    ])
  )
    throw new Error('Test migrations failed');
  bucketAttempted = true;
  if (await run(['scripts/init-storage.ts'])) throw new Error('Test storage initialization failed');
  process.exitCode = await run(
    suite === 'integration'
      ? [resolve('node_modules/vitest/vitest.mjs'), 'run', '--project', 'integration', ...suiteArgs]
      : [resolve('node_modules/@playwright/test/cli.js'), 'test', ...suiteArgs],
  );
} catch (error) {
  process.exitCode = 1;
  console.error(
    `Isolated test setup failed: ${error instanceof Error ? error.name : 'unknown error'}`,
  );
} finally {
  for (const cleanup of [
    () => bucketAttempted && cleanBucket(),
    () => created && cleanRedis(),
    async () => {
      if (!created) return;
      assertEphemeralDatabase(database.toString(), names.database);
      await admin.$executeRaw(Prisma.raw(`DROP DATABASE "${names.database}" WITH (FORCE)`));
    },
  ]) {
    try {
      await cleanup();
    } catch (error) {
      process.exitCode = 1;
      console.error(
        `Isolated resource cleanup failed: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
    }
  }
  process.off('SIGINT', terminate);
  process.off('SIGTERM', terminate);
  await admin.$disconnect();
}
