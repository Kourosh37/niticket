import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutBucketVersioningCommand,
  PutBucketCorsCommand,
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
