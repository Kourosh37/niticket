import { expect, it } from 'vitest';
import { zipSync, strToU8, unzipSync } from 'fflate';
import { boundedOfficeArchive } from '../../apps/web/src/lib/office-archive';
import { formatOfficeRows } from '../../apps/web/src/lib/office-content';

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

it('caps text transferred from a spreadsheet worker even when many cells repeat a large shared string', () => {
  const shared = 'x'.repeat(1000000);
  const rows = formatOfficeRows(Array.from({ length: 600 }, () => Array(40).fill(shared)));
  expect(rows).toHaveLength(500);
  expect(rows.every((row) => row.length === 30)).toBe(true);
  expect(rows.flat().reduce((total, value) => total + value.length, 0)).toBeLessThanOrEqual(300000);
  expect(rows.flat().every((value) => value.length <= 10000)).toBe(true);
  expect(formatOfficeRows([[0, false, null, 'سلام']])).toEqual([['0', 'false', '', 'سلام']]);
});
