import { describe, it, expect } from 'vitest';
import { pcmWaveform } from '@niticket/core/infrastructure/audio';
import { registrationSchema, responsibleSchema } from '@niticket/core/validation';

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
  it('normalizes Persian student numbers and mobile numbers', () => {
    expect(
      registrationSchema.parse({
        name: 'دانشجوی نمونه',
        studentNumber: '۴۰۱۱۲۳۴۵۶',
        email: 'Student@stu.nit.ac.ir',
        password: 'testPassword1234',
      }),
    ).toMatchObject({ studentNumber: '401123456', email: 'student@stu.nit.ac.ir' });
    expect(
      responsibleSchema.parse({
        name: 'مسئول واحد',
        username: 'UNIT.۱',
        email: 'unit@stu.nit.ac.ir',
        phone: '۰۹۱۲۳۴۵۶۷۸۹',
        password: 'testPassword1234',
      }),
    ).toMatchObject({ username: 'unit.1', phone: '09123456789' });
  });
});
