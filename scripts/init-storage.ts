import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutBucketVersioningCommand,
  PutBucketCorsCommand,
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
  type LifecycleRule,
} from '@aws-sdk/client-s3';
import { config } from '@niticket/core/infrastructure/config';

const c = config();
const client = new S3Client({
  endpoint: c.S3_ENDPOINT,
  region: c.S3_REGION,
  forcePathStyle: true,
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
  credentials: { accessKeyId: c.S3_ACCESS_KEY, secretAccessKey: c.S3_SECRET_KEY },
});
let ready = false;
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: c.S3_BUCKET }));
    ready = true;
    break;
  } catch (error) {
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) {
      await client.send(new CreateBucketCommand({ Bucket: c.S3_BUCKET }));
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
if (!ready) throw new Error('Storage unavailable');
console.log('Enabling object versioning.');
await client.send(
  new PutBucketVersioningCommand({
    Bucket: c.S3_BUCKET,
    ChecksumAlgorithm: 'SHA256',
    VersioningConfiguration: { Status: 'Enabled' },
  }),
);
// Preserve unrelated bucket rules; these IDs belong to the application.
const managedRules: LifecycleRule[] = [
  {
    ID: 'niticket-pending-expiration',
    Status: 'Enabled',
    Filter: { Prefix: 'pending/' },
    Expiration: { Days: 1 },
    AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
  },
  {
    ID: 'niticket-noncurrent-expiration',
    Status: 'Enabled',
    Filter: { Prefix: '' },
    NoncurrentVersionExpiration: { NoncurrentDays: 1 },
  },
  {
    ID: 'niticket-delete-marker-expiration',
    Status: 'Enabled',
    Filter: { Prefix: '' },
    Expiration: { ExpiredObjectDeleteMarker: true },
  },
];
let existingRules: LifecycleRule[] = [];
try {
  existingRules =
    (await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: c.S3_BUCKET })))
      .Rules ?? [];
} catch (error) {
  if ((error as { name?: string }).name !== 'NoSuchLifecycleConfiguration') throw error;
}
await client.send(
  new PutBucketLifecycleConfigurationCommand({
    Bucket: c.S3_BUCKET,
    LifecycleConfiguration: {
      Rules: [
        ...existingRules.filter((rule) => !managedRules.some((managed) => managed.ID === rule.ID)),
        ...managedRules,
      ],
    },
  }),
);
if (c.S3_PROVIDER === 's3')
  await client.send(
    new PutBucketCorsCommand({
      Bucket: c.S3_BUCKET,
      ChecksumAlgorithm: 'SHA256',
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: [c.APP_ORIGIN],
            AllowedMethods: ['PUT'],
            AllowedHeaders: ['content-type', 'x-amz-*'],
            ExposeHeaders: ['ETag'],
            MaxAgeSeconds: 300,
          },
        ],
      },
    }),
  );
else console.log('MinIO CORS is restricted through MINIO_API_CORS_ALLOW_ORIGIN in Compose.');
console.log('Private bucket initialized with versioning and same-origin upload CORS.');
