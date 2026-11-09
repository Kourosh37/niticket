import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

function luminance(hex: string) {
  const rgb = [1, 3, 5]
    .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

it('keeps semantic text and button pairings above WCAG AA contrast in both themes', () => {
  const css = readFileSync('apps/web/src/app/theme.css', 'utf8');
  for (const mode of ['light', 'dark']) {
    const block = css.match(new RegExp(`:root\\[data-theme='${mode}'\\] \\{([^}]+)\\}`))![1];
    const colors = Object.fromEntries(
      [...block.matchAll(/--([\w-]+):\s*(#[a-f\d]{6});/g)].map((match) => [match[1], match[2]]),
    );
    for (const [fg, bg] of [
      ['foreground', 'surface'],
      ['foreground', 'background'],
      ['muted', 'surface-alt'],
      ['muted', 'bubble-own'],
      ['on-primary', 'primary'],
      ['on-primary', 'primary-hover'],
      ['danger', 'danger-surface'],
      ['success', 'success-surface'],
      ['warning', 'warning-surface'],
    ]) {
      const values = [luminance(colors[fg]), luminance(colors[bg])].sort((a, b) => a - b);
      expect(
        (values[1] + 0.05) / (values[0] + 0.05),
        `${mode}: ${fg} on ${bg}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
});
