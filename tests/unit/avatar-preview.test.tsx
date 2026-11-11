// @vitest-environment jsdom
import { createElement, useState, type ImgHTMLAttributes } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AvatarPreview } from '../../apps/web/src/components/avatar-preview';

vi.mock('next/image', () => ({
  default: ({
    unoptimized: _unoptimized,
    ...props
  }: ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) => {
    void _unoptimized;
    return createElement('img', props);
  },
}));
afterEach(cleanup);

function Harness({ image = '/api/v1/avatars/officer?v=version' }: { image?: string | null }) {
  const [open, setOpen] = useState(false);
  return <AvatarPreview name="مسئول آزمون" image={image} open={open} onOpenChange={setOpen} />;
}

it('opens the full uncropped source in an accessible dialog and restores focus when dismissed', async () => {
  render(<Harness />);
  const trigger = screen.getByRole('button', { name: 'نمایش تصویر مسئول واحد، مسئول آزمون' });
  trigger.focus();
  fireEvent.click(trigger);
  expect(screen.getByRole('dialog', { name: 'تصویر مسئول واحد' })).toBeTruthy();
  expect(screen.getByAltText('تصویر کامل مسئول آزمون').getAttribute('src')).toBe(
    '/api/v1/avatars/officer?v=version',
  );
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

it('keeps initials noninteractive when no authorized photo exists', () => {
  const view = render(<Harness image={null} />);
  expect(screen.queryByRole('button')).toBeNull();
  expect(view.container.textContent).toBe('م');
  view.rerender(<Harness image="https://untrusted.example/photo.png" />);
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByRole('img')).toBeNull();
});

it('offers a retry on image failure and resets the error when a new source is supplied', () => {
  const view = render(<Harness />);
  fireEvent.click(screen.getByRole('button'));
  fireEvent.error(screen.getByAltText('تصویر کامل مسئول آزمون'));
  expect(screen.getByRole('alert').textContent).toContain('تصویر دریافت نشد');
  fireEvent.click(screen.getByRole('button', { name: 'تلاش دوباره' }));
  expect(screen.getByAltText('تصویر کامل مسئول آزمون')).toBeTruthy();
  fireEvent.error(screen.getByAltText('تصویر کامل مسئول آزمون'));
  view.rerender(<Harness image="/api/v1/avatars/officer?v=new" />);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByAltText('تصویر کامل مسئول آزمون').getAttribute('src')).toContain('v=new');
});
