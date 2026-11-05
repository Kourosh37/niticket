import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config';

let client: S3Client | undefined;

export function storage(publicEndpoint = false) {
  const c = config();
  const create = () =>
    new S3Client({
      endpoint: publicEndpoint ? c.S3_PUBLIC_ENDPOINT : c.S3_ENDPOINT,
      region: c.S3_REGION,
      forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      credentials: { accessKeyId: c.S3_ACCESS_KEY, secretAccessKey: c.S3_SECRET_KEY },
    });
  return publicEndpoint ? create() : (client ??= create());
}

export async function signedUpload(key: string, mime: string) {
  return getSignedUrl(
    storage(true),
    new PutObjectCommand({ Bucket: config().S3_BUCKET, Key: key, ContentType: mime }),
    { expiresIn: 180 },
  );
}

export async function objectBytes(key: string, max: number) {
  const result = await storage().send(
    new GetObjectCommand({ Bucket: config().S3_BUCKET, Key: key }),
  );
  if (!result.Body || !result.ContentLength || result.ContentLength > max)
    throw new Error('Invalid object size');
  const bytes = await result.Body.transformToByteArray();
  if (bytes.length > max) throw new Error('Object too large');
  return Buffer.from(bytes);
}

export async function headObject(key: string) {
  return storage().send(new HeadObjectCommand({ Bucket: config().S3_BUCKET, Key: key }));
}

export async function putObject(key: string, bytes: Buffer, mime: string) {
  await storage().send(
    new PutObjectCommand({ Bucket: config().S3_BUCKET, Key: key, Body: bytes, ContentType: mime }),
  );
}

export async function deleteObject(key: string) {
  await storage().send(new DeleteObjectCommand({ Bucket: config().S3_BUCKET, Key: key }));
}
