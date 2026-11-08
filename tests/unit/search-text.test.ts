import { expect, it } from 'vitest';
import {
  normalizeSearchText,
  searchTerms,
  searchHighlights,
  searchExcerpt,
} from '@niticket/core/domain/search-text';

it('folds Persian forms and builds phrases and exclusion terms without regex execution', () => {
  expect(normalizeSearchText(' كلاس‌ رياضي ۱۲۳ ٤٥٦ ')).toBe('کلاس ریاضی 123 456');
  expect(searchTerms('"ثبت نام" کلاس -لغو', 'all')).toEqual({
    include: ['ثبت نام', 'کلاس'],
    exclude: ['لغو'],
  });
  expect(searchTerms('ثبت نام', 'phrase').include).toEqual(['ثبت نام']);
});
it('highlights original Persian text safely and finds a matching excerpt in a long message', () => {
  const text = '😀 نتیجهٔ كلاس‌ رياضي ۱۲۳ <script>';
  const ranges = searchHighlights(text, ['کلاس ریاضی', '123', '<script>']);
  expect(ranges.map(([start, end]) => text.slice(start, end))).toEqual([
    'كلاس‌ رياضي',
    '۱۲۳',
    '<script>',
  ]);
  expect(searchExcerpt('prefix '.repeat(1000) + text, ['کلاس ریاضی'])).toContain('كلاس‌ رياضي');
  expect(searchExcerpt('a'.repeat(20000), [])).toHaveLength(361);
});
