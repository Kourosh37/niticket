import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config';

let client: S3Client | undefined;
let uploadClient: S3Client | undefined;

export function storage(publicEndpoint = false) {
  const c = config();
  const create = () =>
    new S3Client({
      endpoint: publicEndpoint ? c.S3_PUBLIC_ENDPOINT : c.S3_ENDPOINT,
      region: c.S3_REGION,
      forcePathStyle: true,
      requestHandler: { connectionTimeout: 3000, requestTimeout: 30000, socketTimeout: 30000 },
      maxAttempts: 3,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      credentials: { accessKeyId: c.S3_ACCESS_KEY, secretAccessKey: c.S3_SECRET_KEY },
    });
  return publicEndpoint ? (uploadClient ??= create()) : (client ??= create());
}

export async function signedUpload(key: string, mime: string, size: number) {
  return getSignedUrl(
    storage(true),
    new PutObjectCommand({
      Bucket: config().S3_BUCKET,
      Key: key,
      ContentType: mime,
      ContentLength: size,
    }),
    { expiresIn: 180, signableHeaders: new Set(['content-type', 'content-length']) },
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

/** Backpressure and cancellation propagate to S3; no full-file buffer in the web process. */
export async function objectStream(key: string, max: number, signal?: AbortSignal, range?: string) {
  const result = await storage().send(
    new GetObjectCommand({ Bucket: config().S3_BUCKET, Key: key, Range: range }),
    { abortSignal: signal },
  );
  const source = result.Body?.transformToWebStream();
  const size = result.ContentLength;
  if (!source || !size || size > max) {
    await source?.cancel();
    throw new Error('Invalid object size');
  }
  let transferred = 0;
  const stream = source.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        transferred += chunk.byteLength;
        if (transferred > size || transferred > max) throw new Error('Object too large');
        controller.enqueue(chunk);
      },
      flush() {
        if (transferred !== size) throw new Error('Incomplete object');
      },
    }),
    signal ? { signal } : undefined,
  );
  return { stream, size };
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
  const Bucket = config().S3_BUCKET;
  let KeyMarker: string | undefined;
  let VersionIdMarker: string | undefined;
  do {
    const page = await storage().send(
      new ListObjectVersionsCommand({ Bucket, Prefix: key, KeyMarker, VersionIdMarker }),
    );
    const objects = [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])]
      .filter((version) => version.Key === key && version.VersionId)
      .map((version) => ({ Key: key, VersionId: version.VersionId! }));
    if (objects.length) {
      const result = await storage().send(
        new DeleteObjectsCommand({ Bucket, Delete: { Objects: objects, Quiet: true } }),
      );
      if (result.Errors?.length) throw new Error('Object version cleanup failed');
    }
    KeyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
    VersionIdMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
  } while (KeyMarker);
}
