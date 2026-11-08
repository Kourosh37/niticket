import { describe, it, expect } from 'vitest';
import { pcmWaveform } from '@niticket/core/infrastructure/audio';
import { responsibleSchema } from '@niticket/core/validation';

describe('measured audio waveform and identity input', () => {
  it('derives different bar heights from the actual sample amplitudes', () => {
    const pcm = Buffer.alloc(160);
    for (let i = 0; i < 80; i++) pcm.writeInt16LE(i < 40 ? 0 : i < 60 ? 1000 : 20000, i * 2);
    const values = pcmWaveform(pcm, 4);
    expect(values.slice(0, 2)).toEqual([0, 0]);
    expect(values[2]).toBeGreaterThan(0);
    expect(values[2]).toBeLessThan(values[3]);
    expect(values[3]).toBe(1);
    expect(pcmWaveform(Buffer.alloc(0))).toHaveLength(80);
  });
  it('provisions officers with only a name and canonical mobile number', () => {
    expect(responsibleSchema.parse({ name: 'مسئول واحد', phoneNumber: '۰۹۱۲۳۴۵۶۷۸۹' })).toEqual({
      name: 'مسئول واحد',
      phoneNumber: '+989123456789',
    });
    expect(
      responsibleSchema.safeParse({
        name: 'مسئول واحد',
        phoneNumber: '09123456789',
        password: 'unexpected',
        isAdmin: true,
      }).success,
    ).toBe(false);
  });
});
