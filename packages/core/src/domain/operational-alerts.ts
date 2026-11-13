export function operationalAlerts(state: {
  failedOutbox: number;
  oldestPendingMs: number;
  overdueStorage: number;
  failedJobs: number;
}) {
  const alerts: { code: string; severity: 'warning' | 'critical' }[] = [];
  if (state.failedOutbox > 0 || state.failedJobs > 0)
    alerts.push({ code: 'FAILED_BACKGROUND_WORK', severity: 'critical' });
  if (state.oldestPendingMs > 5 * 60000) alerts.push({ code: 'OUTBOX_LAG', severity: 'warning' });
  if (state.overdueStorage > 0)
    alerts.push({ code: 'STORAGE_RECONCILIATION_LAG', severity: 'warning' });
  return alerts;
}
