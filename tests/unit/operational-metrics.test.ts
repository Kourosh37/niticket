import { expect, it } from 'vitest';
import { operationalAlerts } from '@niticket/core/domain/operational-alerts';
import { measure, processMetrics } from '@niticket/core/infrastructure/metrics';

it('reports actionable backlog alerts without treating idle queues as unhealthy', () => {
  expect(
    operationalAlerts({ failedOutbox: 0, failedJobs: 0, oldestPendingMs: 0, overdueStorage: 0 }),
  ).toEqual([]);
  expect(
    operationalAlerts({
      failedOutbox: 1,
      failedJobs: 3,
      oldestPendingMs: 300001,
      overdueStorage: 1,
    }),
  ).toEqual([
    { code: 'FAILED_BACKGROUND_WORK', severity: 'critical' },
    { code: 'OUTBOX_LAG', severity: 'warning' },
    { code: 'STORAGE_RECONCILIATION_LAG', severity: 'warning' },
  ]);
});

it('counts failures and latency with detached process-local snapshots', () => {
  measure('search', 10);
  measure('search', 30, true);
  measure('search', NaN);
  const first = processMetrics();
  expect(first.scope).toBe('process');
  expect(first.samples.search).toEqual({
    count: 2,
    failures: 1,
    totalMs: 40,
    maxMs: 30,
    meanMs: 20,
  });
  first.samples.search.count = 100;
  expect(processMetrics().samples.search.count).toBe(2);
});
