import { afterAll, expect, it } from 'vitest';
import { db } from '@niticket/database';
import { fixtures } from '../helpers/fixtures';
import { dispatch } from '@niticket/core/http/router';

afterAll(() => db.$disconnect());

it('restricts telemetry to administrators and reports overdue work without payloads', async () => {
  const f = await fixtures();
  const request = new Request('http://localhost/api/v1/admin/metrics');
  for (const user of [f.student, f.agent, f.manager])
    await expect(
      dispatch(request, ['admin', 'metrics'], await f.actor(user.id)),
    ).rejects.toMatchObject({ status: 403 });
  const event = await db.outboxEvent.create({
    data: {
      type: 'TEST_TELEMETRY',
      payload: { privateText: 'never-expose-this' },
      createdAt: new Date(Date.now() - 600000),
    },
  });
  try {
    const result = await dispatch(request, ['admin', 'metrics'], await f.actor(f.admin.id));
    expect(result).toMatchObject({
      outbox: { oldestPendingMs: expect.any(Number) },
      alerts: expect.arrayContaining([{ code: 'OUTBOX_LAG', severity: 'warning' }]),
    });
    expect(JSON.stringify(result)).not.toContain('never-expose-this');
  } finally {
    await db.outboxEvent.delete({ where: { id: event.id } });
  }
});
