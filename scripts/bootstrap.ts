import { db } from '@niticket/database';
import { synchronizeRootAdministrator } from '@niticket/core/application/mobile-identity';

try {
  const result = await synchronizeRootAdministrator();
  console.log(
    result.changed
      ? 'Administrator synchronized. Sign in with the configured phone and OTP.'
      : 'Administrator configuration is unchanged.',
  );
} finally {
  await db.$disconnect();
}
