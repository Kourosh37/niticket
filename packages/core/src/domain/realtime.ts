import { z } from 'zod';

export const realtimeTopics = [
  'conversation',
  'inbox',
  'receipts',
  'notifications',
  'attachments',
  'saved-replies',
  'access',
] as const;

const topics = z.array(z.enum(realtimeTopics)).min(1).max(realtimeTopics.length);
const uuid = z.uuid();

// Routing hints stay on the server. No message bodies, filenames or credentials
// cross this channel; every recipient is checked again before SSE delivery.
export const realtimeChangeSchema = z.discriminatedUnion('scope', [
  z
    .object({
      scope: z.literal('ticket'),
      ticketId: uuid,
      creatorId: uuid,
      departmentId: uuid,
      internal: z.boolean().default(false),
      topics,
    })
    .strict(),
  z.object({ scope: z.literal('user'), userId: uuid, topics }).strict(),
  z.object({ scope: z.literal('department'), departmentId: uuid, topics }).strict(),
  z.object({ scope: z.literal('everyone'), topics }).strict(),
]);

export type RealtimeChange = z.infer<typeof realtimeChangeSchema>;

export type RealtimeTopic = (typeof realtimeTopics)[number];

export type RealtimeUpdate = { topics: RealtimeTopic[]; ticketIds: string[] };

export const realtimeEnvelopeSchema = z.object({ id: uuid, change: realtimeChangeSchema }).strict();

export type RealtimeEnvelope = z.infer<typeof realtimeEnvelopeSchema>;
