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
      <>
        <label>
          نام
          <input required name="name" />
        </label>
        <label>
          متن
          <textarea name="body" />
        </label>
      </>
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

it('shows Next until the last step, prevents jumping ahead and never submits while advancing', () => {
  const save = vi.fn();
  render(<ModalForm sections={sections} onSubmit={save} submitLabel="ذخیره" />);
  expect(screen.queryByRole('button', { name: 'ذخیره' })).toBeNull();
  expect(screen.getByRole('tab', { name: 'پیوست' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'مرحله بعد' }));
  expect(screen.getByRole('tab', { name: 'اطلاعات' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.change(screen.getByLabelText('نام'), { target: { value: 'نام محفوظ' } });
  fireEvent.click(screen.getByRole('button', { name: 'مرحله بعد' }));
  expect(screen.getByRole('tab', { name: 'پیوست' }).getAttribute('aria-current')).toBe('step');
  expect(screen.queryByRole('button', { name: 'مرحله بعد' })).toBeNull();
  expect(screen.getByRole('button', { name: 'ذخیره' })).toBeTruthy();
  expect(save).not.toHaveBeenCalled();
});

it('keeps files, text and checkboxes mounted across Back and Next and submits every section together', () => {
  const save = vi.fn();
  render(
    <ModalForm
      sections={sections}
      submitLabel="ذخیره"
      onSubmit={(event) => save(new FormData(event.currentTarget))}
    />,
  );
  fireEvent.change(screen.getByLabelText('نام'), { target: { value: 'نام محفوظ' } });
  fireEvent.change(screen.getByLabelText('متن'), { target: { value: 'متن محفوظ' } });
  fireEvent.click(screen.getByRole('button', { name: 'مرحله بعد' }));
  const fileInput = screen.getByLabelText('فایل');
  fireEvent.change(fileInput, { target: { files: [new File(['contents'], 'file.txt')] } });
  fireEvent.click(screen.getByLabelText('انتشار'));
  fireEvent.click(screen.getByRole('button', { name: 'مرحله قبل' }));
  expect((screen.getByLabelText('متن') as HTMLTextAreaElement).value).toBe('متن محفوظ');
  fireEvent.click(screen.getByRole('button', { name: 'مرحله بعد' }));
  expect(screen.getByLabelText('فایل')).toBe(fileInput);
  expect((fileInput as HTMLInputElement).files?.[0].name).toBe('file.txt');
  fireEvent.click(screen.getByRole('button', { name: 'ذخیره' }));
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][0].get('name')).toBe('نام محفوظ');
  expect(save.mock.calls[0][0].get('body')).toBe('متن محفوظ');
  expect(save.mock.calls[0][0].get('publish')).toBe('on');
});

it('revalidates all sections at confirmation and reveals a hidden invalid field', async () => {
  const save = vi.fn();
  render(<ModalForm sections={sections} onSubmit={save} submitLabel="ذخیره" />);
  fireEvent.change(screen.getByLabelText('نام'), { target: { value: 'نام معتبر' } });
  fireEvent.click(screen.getByRole('button', { name: 'مرحله بعد' }));
  fireEvent.change(screen.getByLabelText('نام'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'ذخیره' }));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole('tab', { name: 'اطلاعات' }).getAttribute('aria-selected')).toBe('true');
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('نام')));
});

it('uses RTL keyboard navigation for reached steps and does not advance during composition or textarea Enter', async () => {
  render(<ModalForm sections={sections} onSubmit={vi.fn()} submitLabel="ذخیره" />);
  const name = screen.getByLabelText('نام');
  fireEvent.change(name, { target: { value: 'نام معتبر' } });
  fireEvent.keyDown(screen.getByRole('tab', { name: 'اطلاعات' }), { key: 'End' });
  expect(screen.getByRole('tab', { name: 'پیوست' }).hasAttribute('disabled')).toBe(true);
  fireEvent.keyDown(name, { key: 'Enter', isComposing: true });
  fireEvent.keyDown(screen.getByLabelText('متن'), { key: 'Enter' });
  expect(screen.queryByRole('button', { name: 'ذخیره' })).toBeNull();
  fireEvent.keyDown(name, { key: 'Enter' });
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'پیوست' })),
  );
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'اطلاعات' })),
  );
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'پیوست' })),
  );
});

it('locks navigation while recording, blocks all submission while busy and only applies payload restrictions on the final step', () => {
  const save = vi.fn();
  const view = render(
    <ModalForm sections={sections} onSubmit={save} submitLabel="ذخیره" lockNavigation />,
  );
  expect(screen.getByRole('button', { name: 'مرحله بعد' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getAllByRole('tab').every((tab) => tab.hasAttribute('disabled'))).toBe(true);
  expect(screen.getByLabelText('نام').matches(':disabled')).toBe(false);
  view.rerender(<ModalForm sections={sections} onSubmit={save} submitLabel="ذخیره" disabled />);
  expect(screen.getByLabelText('نام').matches(':disabled')).toBe(true);
  fireEvent.submit(view.container.querySelector('form')!);
  expect(save).not.toHaveBeenCalled();
  view.rerender(
    <ModalForm sections={sections} onSubmit={save} submitLabel="ذخیره" submitDisabled />,
  );
  fireEvent.change(screen.getByLabelText('نام'), { target: { value: 'نام معتبر' } });
  expect(screen.getByRole('button', { name: 'مرحله بعد' }).hasAttribute('disabled')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'مرحله بعد' }));
  expect(screen.getByRole('button', { name: 'ذخیره' }).hasAttribute('disabled')).toBe(true);
});

it('allows optional steps to be empty and requires an intentional final confirmation', () => {
  const save = vi.fn();
  const optional = [
    { title: 'متن', content: <textarea /> },
    { title: 'فایل', content: <input type="file" /> },
    { title: 'وویس', content: <p>وویس اختیاری</p> },
  ];
  const view = render(<ModalForm sections={optional} onSubmit={save} submitLabel="تأیید" />);
  fireEvent.submit(view.container.querySelector('form')!);
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'مرحله بعد' }));
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'تأیید' }), { detail: 2 });
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'تأیید' }), { detail: 1 });
  expect(save).toHaveBeenCalledTimes(1);
});

it('keeps a single-section form directly submittable', () => {
  const save = vi.fn();
  render(
    <ModalForm
      sections={[{ title: 'نام', content: <input defaultValue="مقدار" required /> }]}
      onSubmit={save}
      submitLabel="ذخیره"
    />,
  );
  expect(screen.queryByRole('tablist')).toBeNull();
  expect(screen.queryByRole('button', { name: 'مرحله بعد' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'ذخیره' }));
  expect(save).toHaveBeenCalledTimes(1);
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
  const next = within(screen.getByRole('navigation', { name: 'صفحه‌بندی متن' })).getByRole(
    'button',
    { name: 'صفحه بعدی' },
  );
  let restored = '';
  for (;;) {
    restored += document.querySelector('.modal-text-page')!.textContent;
    if (next.hasAttribute('disabled')) break;
    fireEvent.click(next);
  }
  expect(restored).toBe(text);
});
