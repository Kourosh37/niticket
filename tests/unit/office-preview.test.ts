import { expect, it } from 'vitest';
import { zipSync, strToU8, unzipSync } from 'fflate';
import { boundedOfficeArchive } from '../../apps/web/src/lib/office-archive';

it('bounds real expanded Office bytes before parsing and rejects sparse oversized sheets', () => {
  const oversized = zipSync({ 'word/document.xml': new Uint8Array(8 * 1024 * 1024 + 1) });
  expect(() => boundedOfficeArchive(oversized.buffer as ArrayBuffer)).toThrow();
  const sparse = zipSync({
    'xl/worksheets/sheet1.xml': strToU8(
      '<worksheet><row r="1048576"><c r="XFD1048576"/></row></worksheet>',
    ),
  });
  expect(() => boundedOfficeArchive(sparse.buffer as ArrayBuffer)).toThrow();
  const normal = zipSync({
    'xl/worksheets/sheet1.xml': strToU8('<worksheet><row r="1"><c r="A1"/></row></worksheet>'),
  });
  expect(
    unzipSync(boundedOfficeArchive(normal.buffer as ArrayBuffer))['xl/worksheets/sheet1.xml'],
  ).toEqual(unzipSync(normal)['xl/worksheets/sheet1.xml']);
});
