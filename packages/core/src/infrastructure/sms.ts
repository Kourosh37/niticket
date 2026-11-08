import { config } from './config';
import { log } from './log';

export async function sendOtpSms(phoneNumber: string, code: string) {
  if (config().SMS_PROVIDER === 'log') {
    // Explicit temporary transport requested for local SMS integration.
    // Never return the OTP from an HTTP endpoint or persist it in the database.
    log.info({ event: 'sms.otp', phoneNumber, otpCode: code }, 'SMS OTP (log transport)');
    return;
  }
  await sendThroughSmsPanel(phoneNumber, code);
}

async function sendThroughSmsPanel(phoneNumber: string, code: string): Promise<void> {
  // SMS provider API integration belongs here; intentionally not implemented yet.
  void phoneNumber;
  void code;
  throw new Error('SMS_PANEL_NOT_CONFIGURED');
}
