import { expect, it } from 'vitest';
import { version } from 'pdfjs-dist/package.json';
import { PDF_ASSETS } from '../../apps/web/src/lib/pdf-assets';

it('uses the same immutable release for the parser worker, fonts, CMaps and WASM', () => {
  expect(PDF_ASSETS).toBe(`/pdf-assets/releases/${version}`);
  expect(PDF_ASSETS).not.toContain('..');
});
