import { config } from '@niticket/core/infrastructure/config';

const c = config();
if (!c.ADMIN_PHONE) throw new Error('Set ADMIN_PHONE in .env before signing in.');
console.log(
  'Administrator phone is configured. Sign in with its OTP to create or link the administrator account. No password or email bootstrap is required.',
);
