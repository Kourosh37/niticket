import { z } from 'zod';

export const uuid = z.uuid();

export const statuses = z.enum([
  'OPEN',
  'IN_PROGRESS',
  'WAITING_FOR_USER',
  'WAITING_FOR_DEPARTMENT',
  'RESOLVED',
  'CLOSED',
  'REOPENED',
]);

export const priorities = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);

export const createTicketSchema = z
  .object({
    departmentId: uuid,
    categoryId: uuid.nullish(),
    subject: z.string().trim().min(5).max(180),
    body: z.string().trim().min(10).max(20000),
    priority: priorities.default('NORMAL'),
  })
  .strict();

export const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: uuid.optional(),
  q: z.string().trim().max(100).optional(),
  status: statuses.optional(),
  departmentId: uuid.optional(),
  scope: z.enum(['mine', 'department', 'assigned', 'unassigned']).default('mine'),
  view: z.enum(['all', 'action', 'done']).default('all'),
});

export const versionSchema = z.object({ version: z.number().int().positive() });

export const messageSchema = versionSchema
  .extend({
    body: z.string().trim().min(1).max(20000),
    visibility: z.enum(['PUBLIC', 'INTERNAL']).default('PUBLIC'),
  })
  .strict();

export const statusSchema = versionSchema.extend({ status: statuses }).strict();

export const assignSchema = versionSchema.extend({ assigneeId: uuid.nullable() }).strict();

export const transferSchema = versionSchema
  .extend({ departmentId: uuid, reason: z.string().trim().min(5).max(1000) })
  .strict();

export const departmentSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(80)
      .optional(),
    description: z.string().max(1000).default(''),
    active: z.boolean().default(true),
    visible: z.boolean().default(true),
    acceptingTickets: z.boolean().default(true),
  })
  .strict();

export const memberSchema = z
  .object({ userId: uuid, role: z.enum(['AGENT', 'MANAGER']), active: z.boolean().default(true) })
  .strict();

export const userSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    password: z.string().min(12).max(128),
    accountType: z.enum(['STUDENT', 'FACULTY', 'STAFF', 'OTHER']).default('STUDENT'),
  })
  .strict();

export const profileSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    phone: z
      .string()
      .transform((v) => asciiDigits(v.trim()))
      .pipe(
        z
          .string()
          .regex(/^(\+98|0)?9\d{9}$/)
          .or(z.literal('')),
      )
      .optional(),
    emailNotifications: z.boolean(),
  })
  .strict();

export const asciiDigits = (value: string) =>
  value
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632));

export const studentNumberSchema = z
  .string()
  .transform((v) => asciiDigits(v.trim()))
  .pipe(z.string().regex(/^\d{7,14}$/, 'شماره دانشجویی باید بین ۷ تا ۱۴ رقم باشد.'));

export const usernameSchema = z
  .string()
  .trim()
  .transform((v) => asciiDigits(v.toLowerCase()))
  .pipe(
    z
      .string()
      .regex(
        /^[a-z0-9][a-z0-9._-]{2,39}$/,
        'نام کاربری باید بین ۳ تا ۴۰ نویسهٔ لاتین یا عدد باشد.',
      ),
  );

export const phoneSchema = z
  .string()
  .transform((v) => asciiDigits(v.trim()))
  .pipe(z.string().regex(/^(\+98|0)?9\d{9}$/, 'شماره همراه معتبر نیست.'));

export const responsibleSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    username: usernameSchema,
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    password: z.string().min(12).max(128),
    phone: phoneSchema,
  })
  .strict();

export const provisionDepartmentSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    description: z.string().max(1000).default(''),
    responsible: responsibleSchema,
  })
  .strict();

export const registrationSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    studentNumber: studentNumberSchema,
    password: z.string().min(12).max(128),
  })
  .strict();

export const uploadSchema = z
  .object({
    ticketId: uuid,
    messageId: uuid.optional(),
    noteId: uuid.optional(),
    filename: z
      .string()
      .min(1)
      .max(180)
      .refine((v) => !/[\x00-\x1f/\\]/.test(v)),
    mime: z.enum([
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/webp',
      'text/plain',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'audio/webm',
      'audio/ogg',
      'audio/mp4',
      'audio/mpeg',
      'audio/wav',
    ]),
    size: z.number().int().positive(),
  })
  .strict();
