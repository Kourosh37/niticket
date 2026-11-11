// @vitest-environment jsdom
import { useState } from 'react';
import { it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Modal } from '../../apps/web/src/components/ui/dialog';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>باز کردن</button>
      <Modal open={open} onOpenChange={setOpen} title="تأیید عملیات">
        <label htmlFor="value">مقدار</label>
        <input id="value" />
      </Modal>
    </>
  );
}

it('provides a labelled modal and closes by Escape', async () => {
  render(<Harness />);
  screen.getByText('باز کردن').focus();
  fireEvent.click(screen.getByText('باز کردن'));
  expect(screen.getByRole('dialog', { name: 'تأیید عملیات' })).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(screen.getByText('باز کردن')));
});
