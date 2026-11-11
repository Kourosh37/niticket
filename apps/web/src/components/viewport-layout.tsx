'use client';

import { useEffect } from 'react';

/** Keep fixed chat tools and dialogs inside the visible area, including mobile keyboards. */
export function ViewportLayout() {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let frame = 0;
    let baseline = { width: window.innerWidth, height: window.innerHeight };

    function update() {
      frame = 0;
      // Browser zoom keeps its native pan/scale behavior.
      if (viewport && Math.abs(viewport.scale - 1) > 0.05) return;
      const height = Math.round(viewport?.height ?? window.innerHeight);
      const width = Math.round(viewport?.width ?? window.innerWidth);
      const target = document.activeElement;
      const editing =
        (target instanceof HTMLTextAreaElement && !target.readOnly && !target.disabled) ||
        (target instanceof HTMLInputElement &&
          !target.readOnly &&
          !target.disabled &&
          !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'range', 'color'].includes(
            target.type,
          )) ||
        (target instanceof HTMLElement && target.isContentEditable);
      if (!editing || Math.abs(width - baseline.width) > 80)
        baseline = { width, height: window.innerHeight };
      root.style.setProperty('--app-viewport-height', `${height}px`);
      root.style.setProperty('--app-viewport-top', `${Math.round(viewport?.offsetTop ?? 0)}px`);
      if (editing && baseline.height - height > 120) root.dataset.keyboardOpen = 'true';
      else delete root.dataset.keyboardOpen;
    }

    function schedule() {
      if (!frame) frame = requestAnimationFrame(update);
    }

    update();
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      document.removeEventListener('focusin', schedule);
      document.removeEventListener('focusout', schedule);
      root.style.removeProperty('--app-viewport-height');
      root.style.removeProperty('--app-viewport-top');
      delete root.dataset.keyboardOpen;
    };
  }, []);
  return null;
}
