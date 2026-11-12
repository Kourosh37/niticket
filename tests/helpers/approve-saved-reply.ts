import { expect } from '@playwright/test';

// The isolated test queue has no consumer. Advance the real scanner while the
// browser correctly keeps saving pending, including FFmpeg for audio/video.
export async function approveSavedReplyFiles(title: string, count: number) {
  const { db } = await import('@niticket/database');
  const { processScan } = await import('@niticket/core/application/jobs');
  const { scanInContainer } = await import('./scan-in-container');
  await expect
    .poll(() =>
      db.attachment.count({
        where: {
          savedReply: { title },
          scanStatus: { in: ['QUARANTINED', 'CLEAN'] },
          archivedAt: null,
        },
      }),
    )
    .toBe(count);
  const files = await db.attachment.findMany({
    where: { savedReply: { title }, archivedAt: null },
  });
  for (const file of files) {
    if (file.scanStatus === 'CLEAN') continue;
    const event = await db.outboxEvent.findFirstOrThrow({
      where: { type: 'SCAN_ATTACHMENT', payload: { path: ['attachmentId'], equals: file.id } },
    });
    if (/^(audio|video)\//.test(file.declaredMime)) await scanInContainer(event.id);
    else await processScan(event.id, event.payload);
  }
}
