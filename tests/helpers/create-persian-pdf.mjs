// Regenerate with `node tests/helpers/create-persian-pdf.mjs` (installed Chromium/Edge).
// Chromium shapes Persian and embeds the bundled, OFL-licensed Vazirmatn subsets.
import { chromium } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';

const browser = await chromium.launch({
  ...(existsSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
    ? { channel: 'msedge' }
    : {}),
});
try {
  const page = await browser.newPage();
  const fonts = ['arabic', 'latin'].map((subset) => {
    const data = readFileSync(
      `node_modules/@fontsource/vazirmatn/files/vazirmatn-${subset}-400-normal.woff2`,
    ).toString('base64');
    return `@font-face { font-family: Fixture-${subset}; src: url(data:font/woff2;base64,${data}) }`;
  });
  await page.setContent(`<html lang="fa" dir="rtl"><style>
    ${fonts.join('\n')}
    @page { size: A4; margin: 20mm }
    body { margin: 0; font: 20px Fixture-arabic, Fixture-latin; color: #000; background: #fff }
    section { break-after: page }
    section:last-child { break-after: auto }
    h1 { font-size: 30px; font-weight: 400 }
    p { line-height: 2 }
  </style><body>
    <section><h1>پیش‌نمایش فارسی</h1>
    <p>این یک سند آزمایشی برای بررسی حروف فارسی، پیوستگی کلمات و نیم‌فاصله است.</p>
    <p>پژوهش، دانشگاه، مسئول واحد، گفت‌وگو و پاسخ‌های جدید</p>
    <p>اعداد فارسی: ۰۱۲۳۴۵۶۷۸۹ — تاریخ: ۱۴۰۵/۰۸/۲۱</p>
    <p dir="ltr">Latin font: NITicket PDF preview 0123456789</p></section>
    <section><h1>صفحه دوم سند</h1><p>پایان فایل؛ اسکرول باید به این صفحه برسد.</p></section>
  </body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: 'tests/fixtures/persian.pdf', printBackground: true });
} finally {
  await browser.close();
}
