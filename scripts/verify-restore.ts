import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import {
  S3Client,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';

const sourceUrl = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!);
if (!process.env.TEST_DATABASE_URL) sourceUrl.pathname = '/niticket_test';
const restoredUrl = new URL(sourceUrl);
restoredUrl.pathname = '/niticket_restore_test';
if (!sourceUrl.pathname.endsWith('_test')) throw new Error('Test source database required');
const source = new PrismaClient({ datasourceUrl: sourceUrl.toString() });
const restored = new PrismaClient({ datasourceUrl: restoredUrl.toString() });
try {
  const countModels = async (client: PrismaClient) => ({
    users: await client.user.count(),
    tickets: await client.ticket.count(),
    messages: await client.message.count(),
    attachments: await client.attachment.count(),
    auditLogs: await client.auditLog.count(),
    outboxEvents: await client.outboxEvent.count(),
  });
  const originalCounts = await countModels(source);
  const counts = await countModels(restored);
  if (JSON.stringify(originalCounts) !== JSON.stringify(counts))
    throw new Error('Restored table counts differ');
  const audit = await restored.auditLog.findFirstOrThrow();
  let immutable = false;
  try {
    await restored.auditLog.update({ where: { id: audit.id }, data: { action: 'TAMPER' } });
  } catch (error) {
    immutable = error instanceof Error && error.message.includes('append only');
  }
  if (!immutable) throw new Error('Restored audit trigger missing');
  const file = await source.attachment.findFirstOrThrow({ where: { scanStatus: 'CLEAN' } });
  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY!,
      secretAccessKey: process.env.S3_SECRET_KEY!,
    },
  });
  const result = await client.send(
    new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: file.objectKey }),
  );
  const bytes = await result.Body!.transformToByteArray();
  const bucket = 'niticket-restore-test';
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error) {
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404)
      throw error;
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: file.objectKey,
      Body: bytes,
      ContentType: file.detectedMime!,
    }),
  );
  const copy = await client.send(new GetObjectCommand({ Bucket: bucket, Key: file.objectKey }));
  const checksum = createHash('sha256')
    .update(await copy.Body!.transformToByteArray())
    .digest('hex');
  if (checksum !== file.checksum) throw new Error('Restored object checksum mismatch');
  console.log(
    JSON.stringify(
      {
        counts,
        auditImmutable: true,
        representativeObjectChecksumVerified: true,
        limitations:
          'Representative object copy plus full database restore; not an off-host full-versioned-storage disaster recovery rehearsal.',
      },
      null,
      2,
    ),
  );
} finally {
  await source.$disconnect();
  await restored.$disconnect();
}
