import { z } from 'zod';
import { db } from '@niticket/database';
import { config } from '../infrastructure/config';
import { assertAdmin, type Actor } from '../domain/authorization';
import { requireFresh, refreshActor } from './context';
import { transaction } from '../infrastructure/transaction';
import { cachedRead } from '../infrastructure/read-cache';
import { enqueueRealtime } from '../infrastructure/realtime';

export const settingsSchema = z
  .object({
    reopenDays: z.number().int().min(0).max(365),
    maxUploadBytes: z.number().int().min(1024).max(52428800),
    maxVoiceSeconds: z.number().int().min(10).max(600),
    allowUserUrgent: z.boolean(),
    universityName: z.string().trim().min(2).max(150).default('دانشگاه صنعتی نوشیروانی بابل'),
    supportDescription: z.string().max(1000).default('سامانه ارتباط و پشتیبانی دانشگاه'),
  })
  .strict();

export async function settings() {
  const c = config();
  const saved = await db.systemSetting.findUnique({ where: { key: 'policy' } });
  return saved
    ? settingsSchema.parse(saved.value)
    : settingsSchema.parse({
        reopenDays: c.REOPEN_DAYS,
        maxUploadBytes: c.MAX_UPLOAD_BYTES,
        maxVoiceSeconds: c.MAX_VOICE_SECONDS,
        allowUserUrgent: false,
      });
}

/** Display cache only. Mutation limits always call the authoritative settings(). */
export const displayPolicy = () => cachedRead('display-policy', ['settings'], 60000, settings);

export async function saveSettings(actor: Actor, input: unknown) {
  assertAdmin(actor);
  await requireFresh(actor);
  const value = settingsSchema.parse(input);
  return transaction(async (tx) => {
    actor = await refreshActor(tx, actor);
    assertAdmin(actor);
    await tx.systemSetting.upsert({
      where: { key: 'policy' },
      create: { key: 'policy', value, updatedBy: actor.id },
      update: { value, updatedBy: actor.id },
    });
    await tx.auditLog.create({
      data: { actorId: actor.id, action: 'POLICY_CHANGED', resourceId: 'policy', metadata: value },
    });
    await enqueueRealtime(tx, { scope: 'everyone', topics: ['settings'] });
    return value;
  });
}
