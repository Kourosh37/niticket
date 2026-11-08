export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.SYNC_ROOT_ADMIN_ON_STARTUP === 'true') {
    const { synchronizeRootAdministrator } =
      await import('@niticket/core/application/mobile-identity');
    const { log } = await import('@niticket/core/infrastructure/log');
    const result = await synchronizeRootAdministrator();
    log.info(
      { operation: 'root-admin-sync', changed: result.changed },
      'Configured administrator synchronized',
    );
  }
}
