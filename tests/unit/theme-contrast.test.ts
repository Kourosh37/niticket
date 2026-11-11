import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

function luminance(hex: string) {
  const rgb = [1, 3, 5]
    .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

function themeColors(mode: string) {
  const css = readFileSync('apps/web/src/app/theme.css', 'utf8');
  const block = css.match(new RegExp(`:root\\[data-theme='${mode}'\\] \\{([^}]+)\\}`))![1];
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*(#[a-f\d]{6});/g)].map((match) => [match[1], match[2]]),
  );
}

function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((a, b) => a - b);
  return (values[1] + 0.05) / (values[0] + 0.05);
}

it('keeps semantic text and button pairings above WCAG AA contrast in both themes', () => {
  for (const mode of ['light', 'dark']) {
    const colors = themeColors(mode);
    for (const [fg, bg] of [
      ['foreground', 'surface'],
      ['foreground', 'background'],
      ['foreground', 'surface-alt'],
      ['foreground', 'surface-hover'],
      ['muted', 'background'],
      ['muted', 'surface'],
      ['muted', 'surface-alt'],
      ['muted', 'surface-hover'],
      ['muted', 'bubble-own'],
      ['muted', 'warning-surface'],
      ['on-primary', 'primary'],
      ['on-primary', 'primary-hover'],
      ['accent-foreground', 'accent'],
      ['danger', 'danger-surface'],
      ['success', 'success-surface'],
      ['warning', 'warning-surface'],
    ]) {
      expect(contrast(colors[fg], colors[bg]), `${mode}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
    for (const background of ['background', 'surface', 'surface-alt'])
      expect(
        contrast(colors['border-strong'], colors[background]),
        `${mode}: control edge on ${background}`,
      ).toBeGreaterThanOrEqual(3);
  }
});

it('keeps light surfaces warm and below pure-white brightness with distinct paper layers', () => {
  const colors = themeColors('light');
  for (const role of ['background', 'surface', 'surface-alt', 'surface-hover']) {
    const [red, green, blue] = [1, 3, 5].map((index) =>
      parseInt(colors[role].slice(index, index + 2), 16),
    );
    expect(red, role).toBeGreaterThan(green);
    expect(green, role).toBeGreaterThan(blue);
    expect(luminance(colors[role]), role).toBeLessThan(0.9);
  }
  // A perceptible elevation difference is part of the light theme, independent of shadows.
  expect(contrast(colors.surface, colors.background)).toBeGreaterThanOrEqual(1.1);
  expect(contrast(colors.surface, colors['surface-alt'])).toBeGreaterThanOrEqual(1.2);
  expect(contrast(colors.surface, colors['surface-hover'])).toBeGreaterThanOrEqual(1.2);
});
