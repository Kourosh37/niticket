// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ModalForm } from '../../apps/web/src/components/ui/modal-form';
import { PagedItems, PagedText } from '../../apps/web/src/components/ui/paged-content';

const listeners = new Set<() => void>();
let compact = false;
beforeEach(() => {
  compact = false;
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: compact,
      addEventListener: (_type: string, callback: () => void) => listeners.add(callback),
      removeEventListener: (_type: string, callback: () => void) => listeners.delete(callback),
    })),
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(0), 0),
  );
});
afterEach(() => {
  cleanup();
  listeners.clear();
  vi.unstubAllGlobals();
});

const sections = [
  {
    title: 'اطلاعات',
    content: (
      <label>
        نام
        <input required name="name" />
      </label>
    ),
  },
  {
    title: 'پیوست',
    content: (
      <>
        <label>
          فایل
          <input type="file" name="file" />
        </label>
        <label>
          انتشار
          <input type="checkbox" name="publish" />
        </label>
      </>
    ),
  },
];

it('keeps hidden fields, files and checkboxes mounted and submits all sections together', () => {
  const save = vi.fn();
  render(
    <ModalForm
      sections={sections}
      onSubmit={(event) => {
        event.preventDefault();
        save(new FormData(event.currentTarget));
      }}
    >
      <button type="submit">ذخیره</button>
    </ModalForm>,
  );
  fireEvent.change(screen.getByLabelText('نام'), { target: { value: 'نام محفوظ' } });
  fireEvent.click(screen.getByRole('tab', { name: 'پیوست' }));
  const fileInput = screen.getByLabelText('فایل');
  fireEvent.change(fileInput, { target: { files: [new File(['contents'], 'file.txt')] } });
  fireEvent.click(screen.getByLabelText('انتشار'));
  fireEvent.click(screen.getByRole('tab', { name: 'اطلاعات' }));
  expect(screen.getByLabelText('فایل')).toBe(fileInput);
  expect((fileInput as HTMLInputElement).files?.[0].name).toBe('file.txt');
  expect((screen.getByLabelText('نام') as HTMLInputElement).value).toBe('نام محفوظ');
  fireEvent.click(screen.getByRole('button', { name: 'ذخیره' }));
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][0].get('name')).toBe('نام محفوظ');
  expect(save.mock.calls[0][0].get('publish')).toBe('on');
});

it('reveals and focuses an invalid field in another section before submitting', async () => {
  const save = vi.fn();
  render(
    <ModalForm sections={sections} onSubmit={save}>
      <button type="submit">ذخیره</button>
    </ModalForm>,
  );
  fireEvent.click(screen.getByRole('tab', { name: 'پیوست' }));
  fireEvent.click(screen.getByRole('button', { name: 'ذخیره' }));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole('tab', { name: 'اطلاعات' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByLabelText('نام').closest('[hidden]')).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('نام')));
});

it('provides RTL roving tab navigation and locks sections during recording or submission', () => {
  const view = render(
    <ModalForm sections={sections} onSubmit={vi.fn()}>
      <button>ذخیره</button>
    </ModalForm>,
  );
  fireEvent.keyDown(screen.getByRole('tab', { name: 'اطلاعات' }), { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'پیوست' }));
  fireEvent.keyDown(document.activeElement!, { key: 'Home' });
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'اطلاعات' }));
  view.rerender(
    <ModalForm sections={sections} onSubmit={vi.fn()} lockNavigation>
      <button>ذخیره</button>
    </ModalForm>,
  );
  expect(screen.getAllByRole('tab').every((tab) => tab.hasAttribute('disabled'))).toBe(true);
  expect((screen.getByLabelText('نام') as HTMLInputElement).disabled).toBe(false);
  view.rerender(
    <ModalForm sections={sections} onSubmit={vi.fn()} disabled>
      <button>ذخیره</button>
    </ModalForm>,
  );
  expect(screen.getByLabelText('نام').matches(':disabled')).toBe(true);
});

it('bounds rendered list items, keeps the current item on rotation and clamps pages after deletion', () => {
  const items = Array.from({ length: 7 }, (_, index) => index);
  const props = {
    label: 'فهرست',
    pageSize: 3,
    compactSize: 1,
    renderItem: (item: number) => <p key={item}>آیتم {item}</p>,
  };
  const view = render(<PagedItems items={items} {...props} />);
  expect(screen.getAllByText(/آیتم/).length).toBe(3);
  fireEvent.click(screen.getByRole('button', { name: 'صفحه بعدی' }));
  expect(screen.getByText('آیتم 3')).toBeTruthy();
  act(() => {
    compact = true;
    listeners.forEach((listener) => listener());
  });
  expect(screen.getAllByText(/آیتم/).length).toBe(1);
  expect(screen.getByText('آیتم 3')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'آخرین صفحه' }));
  expect(screen.getByText('آیتم 6')).toBeTruthy();
  view.rerender(<PagedItems items={[0, 1]} {...props} />);
  expect(screen.getByText('آیتم 1')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'صفحه بعدی' }).hasAttribute('disabled')).toBe(true);
});

it('paginates long Persian text without losing whitespace or splitting emoji characters', () => {
  const text = 'متن فارسی 👩‍💻\n'.repeat(70) + 'پایان';
  render(<PagedText text={text} />);
  const navigation = screen.getByRole('navigation', { name: 'صفحه‌بندی متن' });
  const next = within(navigation).getByRole('button', { name: 'صفحه بعدی' });
  let restored = '';
  for (;;) {
    restored += document.querySelector('.modal-text-page')!.textContent;
    if (next.hasAttribute('disabled')) break;
    fireEvent.click(next);
  }
  expect(restored).toBe(text);
});
