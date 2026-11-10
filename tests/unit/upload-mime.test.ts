import { expect, it } from 'vitest';
import { uploadMime } from '../../apps/web/src/lib/file-type';

it('infers allowed extensions only when a browser omits a useful media type', () => {
  expect(uploadMime({ name: 'Document.PDF', type: '' })).toBe('application/pdf');
  expect(uploadMime({ name: 'workbook.xlsx', type: 'application/octet-stream' })).toContain(
    'spreadsheetml',
  );
  expect(uploadMime({ name: 'recording.webm', type: 'audio/webm;codecs=opus' })).toBe('audio/webm');
  expect(uploadMime({ name: 'recording.wav', type: 'audio/x-wav' })).toBe('audio/wav');
  expect(uploadMime({ name: 'spoof.png', type: 'application/pdf' })).toBe('application/pdf');
  expect(() => uploadMime({ name: 'program.exe', type: '' })).toThrow();
});
