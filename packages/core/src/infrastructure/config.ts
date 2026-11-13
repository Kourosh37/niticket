import { z } from 'zod';
import { iranianPhoneSchema } from '../domain/phone';

const schema = z.object({
  DATABASE_URL: z.url(),
  QUEUE_NAME: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .default('niticket'),
  REDIS_URL: z.url(),
  CACHE_REDIS_URL: z.preprocess((value) => (value === '' ? undefined : value), z.url().optional()),
  WORKER_ROLE: z.enum(['all', 'events', 'media']).default('all'),
  MEDIA_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  OUTBOX_RETENTION_DAYS: z.coerce.number().int().min(7).max(3650).default(30),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32)
    .refine((v) => !v.includes('CHANGE_ME')),
  BETTER_AUTH_URL: z.url(),
  APP_ORIGIN: z.url(),
  ADMIN_PHONE: z.union([z.literal(''), iranianPhoneSchema]).default(''),
  SMS_PROVIDER: z.enum(['log', 'panel']).default('log'),
  SESSION_DAYS: z.coerce.number().int().min(7).max(90).default(30),
  S3_ENDPOINT: z.url(),
  S3_PUBLIC_ENDPOINT: z.url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_PROVIDER: z.enum(['minio', 's3']).default('minio'),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY: z.string().min(8),
  S3_SECRET_KEY: z.string().min(16),
  CLAMAV_HOST: z.string().default('localhost'),
  CLAMAV_PORT: z.coerce.number().default(3310),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().max(52428800).default(10485760),
  MAX_VOICE_SECONDS: z.coerce.number().int().positive().max(600).default(180),
  REOPEN_DAYS: z.coerce.number().int().min(0).max(365).default(7),
});
let cached: z.infer<typeof schema> | undefined;

export function config() {
  return (cached ??= schema.parse(process.env));
}
