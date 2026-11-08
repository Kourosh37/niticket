import { createHmac, randomInt } from 'node:crypto';
import { config } from '../infrastructure/config';
import { redis } from '../infrastructure/redis';
import { sendOtpSms } from '../infrastructure/sms';
import { AppError, fail } from '../domain/errors';
import { iranianPhoneSchema, otpCodeSchema } from '../domain/phone';

type Purpose = 'login' | 'reauth';

export const OTP_TTL_SECONDS = 300;

export const OTP_RESEND_SECONDS = 60;

const MAX_ATTEMPTS = 5;

function mac(value: string) {
  return createHmac('sha256', config().BETTER_AUTH_SECRET).update(value).digest('hex');
}

function keyFor(phone: string, purpose: Purpose, binding: string) {
  return `otp:${mac(`${purpose}:${phone}:${binding}`)}`;
}

async function evalOtp(script: string, count: number, ...args: (string | number)[]) {
  try {
    return await redis().eval(script, count, ...args);
  } catch {
    throw new AppError('UNAVAILABLE', 503, 'سرویس ورود موقتاً در دسترس نیست. دوباره تلاش کنید.');
  }
}

export async function issueOtp(phoneInput: string, purpose: Purpose = 'login', binding = '') {
  const phoneNumber = iranianPhoneSchema.parse(phoneInput);
  const digestKey = keyFor(phoneNumber, purpose, binding);
  const code = String(randomInt(0, 1000000)).padStart(6, '0');
  const digest = mac(`${purpose}:${phoneNumber}:${binding}:${code}`);
  const result = Number(
    await evalOtp(
      `
    if redis.call('EXISTS',KEYS[2]) == 1 then return redis.call('TTL',KEYS[2]) end
    if tonumber(redis.call('GET',KEYS[3]) or '0') >= 5 or tonumber(redis.call('GET',KEYS[4]) or '0') >= 20 then return -1 end
    if redis.call('INCR',KEYS[3]) == 1 then redis.call('EXPIRE',KEYS[3],900) end
    if redis.call('INCR',KEYS[4]) == 1 then redis.call('EXPIRE',KEYS[4],86400) end
    redis.call('HSET',KEYS[1],'digest',ARGV[1],'attempts','0')
    redis.call('EXPIRE',KEYS[1],ARGV[2])
    redis.call('SET',KEYS[2],'1','EX',ARGV[3])
    return 0`,
      4,
      digestKey,
      `${digestKey}:resend`,
      `otp-send:${mac(phoneNumber)}`,
      `otp-day:${mac(phoneNumber)}`,
      digest,
      OTP_TTL_SECONDS,
      OTP_RESEND_SECONDS,
    ),
  );
  if (result === -1)
    fail('RATE_LIMITED', 429, 'تعداد درخواست کد زیاد است. کمی بعد دوباره تلاش کنید.');
  if (result > 0) fail('OTP_COOLDOWN', 429, 'برای دریافت کد جدید یک دقیقه صبر کنید.');
  try {
    await sendOtpSms(phoneNumber, code);
  } catch {
    await evalOtp(
      "if redis.call('HGET',KEYS[1],'digest') == ARGV[1] then redis.call('DEL',KEYS[1],KEYS[2]) end",
      2,
      digestKey,
      `${digestKey}:resend`,
      digest,
    );
    fail('SMS_UNAVAILABLE', 503, 'ارسال کد انجام نشد. دوباره تلاش کنید.');
  }
  return { expiresIn: OTP_TTL_SECONDS, resendAfter: OTP_RESEND_SECONDS };
}

export async function consumeOtp(
  phoneInput: string,
  codeInput: string,
  purpose: Purpose = 'login',
  binding = '',
) {
  const phoneNumber = iranianPhoneSchema.parse(phoneInput),
    code = otpCodeSchema.parse(codeInput);
  const digest = mac(`${purpose}:${phoneNumber}:${binding}:${code}`);
  const result = Number(
    await evalOtp(
      `
    local stored = redis.call('HGET',KEYS[1],'digest')
    if not stored then return 0 end
    local attempts = tonumber(redis.call('HGET',KEYS[1],'attempts') or '0')
    if attempts >= tonumber(ARGV[2]) then redis.call('DEL',KEYS[1]); return 0 end
    if stored ~= ARGV[1] then
      attempts = redis.call('HINCRBY',KEYS[1],'attempts',1)
      if attempts >= tonumber(ARGV[2]) then redis.call('DEL',KEYS[1]) end
      return 0
    end
    redis.call('DEL',KEYS[1])
    return 1`,
      1,
      keyFor(phoneNumber, purpose, binding),
      digest,
      MAX_ATTEMPTS,
    ),
  );
  if (result !== 1) fail('INVALID_OTP', 400, 'کد معتبر نیست یا منقضی شده است.');
  return phoneNumber;
}
