import { z } from 'zod';
import { iranianPhoneSchema } from '../domain/phone';

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

export const conversationSchema = z.object({ departmentId: uuid }).strict();

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
  view: z.enum(['all', 'action', 'answered', 'done']).default('all'),
});

export const versionSchema = z.object({ version: z.number().int().positive() });

export const messageSchema = versionSchema
  .extend({
    body: z.string().trim().max(20000).default(''),
    savedReplyId: uuid.optional(),
    savedReplyVersion: z.number().int().positive().optional(),
    visibility: z.enum(['PUBLIC', 'INTERNAL']).default('PUBLIC'),
    clientId: uuid.optional(),
  })
  .strict()
  .refine((data) => (data.savedReplyId ? !data.body : !!data.body), {
    message: 'متن یا یک پیام آماده انتخاب کنید.',
  })
  .refine((data) => !data.savedReplyVersion || !!data.savedReplyId);

export const statusSchema = versionSchema.extend({ status: statuses }).strict();

export const assignSchema = versionSchema.extend({ assigneeId: uuid.nullable() }).strict();

export const transferSchema = versionSchema
  .extend({ departmentId: uuid, reason: z.string().trim().min(5).max(1000) })
  .strict();

export const departmentSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(80)
      .optional(),
    description: z.string().max(1000).optional(),
    active: z.boolean().optional(),
    visible: z.boolean().optional(),
    acceptingTickets: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.values(data).some((value) => value !== undefined));

export const memberSchema = z
  .object({ userId: uuid, role: z.enum(['AGENT', 'MANAGER']), active: z.boolean().default(true) })
  .strict();

export const profileSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
  })
  .strict();

export const responsibleSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    phoneNumber: iranianPhoneSchema,
  })
  .strict();

export const provisionDepartmentSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    description: z.string().max(1000).default(''),
    responsible: responsibleSchema,
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
      'video/mp4',
      'video/webm',
    ]),
    size: z.number().int().positive(),
  })
  .strict();
