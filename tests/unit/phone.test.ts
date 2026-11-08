import { expect, it } from 'vitest';
import { iranianPhoneSchema, otpCodeSchema, passwordSchema } from '@niticket/core/domain/phone';

it('canonicalizes Iranian numbers and Persian and Arabic digits', () => {
  for (const value of [
    '09113709021',
    '۰۹۱۱۳۷۰۹۰۲۱',
    '٠٩١١٣٧٠٩٠٢١',
    '+98 911 370 9021',
    '00989113709021',
    '989113709021',
    '9113709021',
  ])
    expect(iranianPhoneSchema.parse(value)).toBe('+989113709021');
  for (const value of [
    '02112345678',
    '+12025550123',
    '0911370902',
    '091137090211',
    '09113709021abc',
    '',
    'a'.repeat(100),
  ])
    expect(iranianPhoneSchema.safeParse(value).success).toBe(false);
  expect(otpCodeSchema.parse('۰۰۱۲۳۴')).toBe('001234');
  expect(otpCodeSchema.safeParse('12345').success).toBe(false);
  expect(passwordSchema.safeParse('short').success).toBe(false);
});
