import { PrismaClient } from '@prisma/client';

const globalDb = globalThis as unknown as { niticketDb?: PrismaClient };

export const db = globalDb.niticketDb ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalDb.niticketDb = db;

export { Prisma } from '@prisma/client';
