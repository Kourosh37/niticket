import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTicketSchema, uploadSchema } from '@niticket/core/validation';
import { detectFile } from '@niticket/core/infrastructure/scanner';

it('rejects mass assignment and unsafe file names', () => {
  expect(
    createTicketSchema.safeParse({
      departmentId: randomUUID(),
      subject: 'درخواست معتبر',
      body: 'توضیح کافی برای درخواست',
      creatorId: randomUUID(),
    }).success,
  ).toBe(false);
  expect(
    uploadSchema.safeParse({
      ticketId: randomUUID(),
      filename: '../private.txt',
      mime: 'text/plain',
      size: 5,
    }).success,
  ).toBe(false);
});
it('verifies bytes rather than client MIME', async () => {
  await expect(detectFile(Buffer.from('hello'), 'image/png')).rejects.toThrow();
  expect((await detectFile(Buffer.from('سلام دانشگاه'), 'text/plain')).mime).toBe('text/plain');
  await expect(detectFile(Buffer.from([0xff, 0xff]), 'text/plain')).rejects.toThrow();
});
