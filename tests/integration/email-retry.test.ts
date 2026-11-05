import { it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '@niticket/database';
import { fixtures } from '../helpers/fixtures';
import { deliverEmails } from '@niticket/core/application/jobs';

// An actual closed local TCP port exercises durable failure handling without sending mail externally.
process.env.SMTP_HOST = '127.0.0.1';
process.env.SMTP_PORT = '1';
afterAll(async () => {
  await db.$disconnect();
});
it('persists exponential SMTP backoff and does not retry before the scheduled time', async () => {
  const f = await fixtures();
  const notification = await db.notification.create({
    data: {
      eventId: randomUUID(),
      userId: f.student.id,
      title: 'آزمون زمان‌بندی تلاش دوباره',
      deliveries: { create: {} },
    },
    include: { deliveries: true },
  });
  const id = notification.deliveries[0].id;
  for (let attempt = 0; attempt < 10; attempt++) {
    if ((await db.notificationDelivery.findUniqueOrThrow({ where: { id } })).attempts) break;
    await deliverEmails();
  }
  const failed = await db.notificationDelivery.findUniqueOrThrow({ where: { id } });
  expect(failed.attempts).toBe(1);
  expect(failed.status).toBe('PENDING');
  expect(failed.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 20000);
  expect(failed.lastError).toBe('SMTP_DELIVERY_FAILED');
  await deliverEmails();
  expect((await db.notificationDelivery.findUniqueOrThrow({ where: { id } })).attempts).toBe(1);
});
