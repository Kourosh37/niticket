import { db } from '@niticket/database';
import { outboxRetentionCutoff, purgeCompletedOutbox } from '@niticket/core/application/retention';

try {
  const cutoff = outboxRetentionCutoff();
  const eligible = await db.outboxEvent.count({
    where: { processedAt: { lt: cutoff }, failedAt: null },
  });
  console.log(
    JSON.stringify({
      cutoff,
      eligible,
      batchLimit: 200,
      mode: process.argv.includes('--apply') ? 'apply' : 'preview',
    }),
  );
  if (process.argv.includes('--apply'))
    console.log(JSON.stringify({ removed: await purgeCompletedOutbox() }));
} finally {
  await db.$disconnect();
}
