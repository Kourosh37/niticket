// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ViewportLayout } from '../../apps/web/src/components/viewport-layout';

class Viewport extends EventTarget {
  height = 800;
  width = 390;
  offsetTop = 0;
  scale = 1;
}
let viewport: Viewport;

beforeEach(() => {
  vi.useFakeTimers();
  viewport = new Viewport();
  vi.stubGlobal('visualViewport', viewport);
  vi.stubGlobal('innerHeight', 800);
  vi.stubGlobal('innerWidth', 390);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function update(target: EventTarget = viewport) {
  act(() => {
    target.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(20);
  });
}

it('keeps fixed tools in the visible viewport and recognizes an editing keyboard', () => {
  render(
    <>
      <ViewportLayout />
      <textarea aria-label="reply" />
    </>,
  );
  act(() => screen.getByLabelText('reply').focus());
  viewport.height = 440;
  viewport.offsetTop = 30;
  update();
  expect(document.documentElement.style.getPropertyValue('--app-viewport-height')).toBe('440px');
  expect(document.documentElement.style.getPropertyValue('--app-viewport-top')).toBe('30px');
  expect(document.documentElement.dataset.keyboardOpen).toBe('true');
  viewport.height = 800;
  viewport.offsetTop = 0;
  update();
  expect(document.documentElement.dataset.keyboardOpen).toBeUndefined();
});

it('supports browsers that resize the layout viewport and does not mistake rotation for a keyboard', () => {
  vi.stubGlobal('visualViewport', undefined);
  render(
    <>
      <ViewportLayout />
      <textarea aria-label="reply" />
    </>,
  );
  act(() => screen.getByLabelText('reply').focus());
  vi.stubGlobal('innerHeight', 400);
  update(window);
  expect(document.documentElement.dataset.keyboardOpen).toBe('true');
  vi.stubGlobal('innerWidth', 844);
  vi.stubGlobal('innerHeight', 390);
  update(window);
  expect(document.documentElement.dataset.keyboardOpen).toBeUndefined();
  expect(document.documentElement.style.getPropertyValue('--app-viewport-height')).toBe('390px');
});

it('leaves pinch zoom to the browser without treating it as a keyboard resize', () => {
  render(
    <>
      <ViewportLayout />
      <textarea aria-label="reply" />
    </>,
  );
  act(() => screen.getByLabelText('reply').focus());
  viewport.scale = 2;
  viewport.height = 300;
  update();
  expect(document.documentElement.style.getPropertyValue('--app-viewport-height')).toBe('800px');
  expect(document.documentElement.dataset.keyboardOpen).toBeUndefined();
});

it('does not classify read-only text areas as keyboard input', () => {
  render(
    <>
      <ViewportLayout />
      <textarea readOnly aria-label="preview" />
    </>,
  );
  act(() => screen.getByLabelText('preview').focus());
  viewport.height = 440;
  update();
  expect(document.documentElement.dataset.keyboardOpen).toBeUndefined();
});

it('cancels pending viewport work and removes document state on unmount', () => {
  const { unmount } = render(<ViewportLayout />);
  viewport.height = 450;
  viewport.dispatchEvent(new Event('resize'));
  unmount();
  update();
  expect(document.documentElement.style.getPropertyValue('--app-viewport-height')).toBe('');
  expect(document.documentElement.dataset.keyboardOpen).toBeUndefined();
});
