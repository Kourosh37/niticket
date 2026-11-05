import next from 'eslint-config-next/core-web-vitals';
import ts from 'eslint-config-next/typescript';

const config = [
  {
    ignores: [
      '**/.next/**',
      '**/node_modules/**',
      'playwright-report/**',
      'test-results/**',
      '.local/**',
      'apps/web/public/pdf.worker.min.mjs',
      'apps/web/public/pdf-assets/**',
    ],
  },
  ...next,
  ...ts,
  {
    settings: { next: { rootDir: 'apps/web/' } },
    rules: {
      'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: 'directive', next: '*' },
        { blankLine: 'always', prev: 'import', next: '*' },
        { blankLine: 'any', prev: 'import', next: 'import' },
        { blankLine: 'always', prev: '*', next: 'function' },
        { blankLine: 'always', prev: 'function', next: '*' },
        { blankLine: 'always', prev: '*', next: 'export' },
        { blankLine: 'always', prev: 'export', next: '*' },
      ],
    },
  },
];

export default config;
