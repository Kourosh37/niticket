'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className={`modal-content ${wide ? 'modal-wide' : ''}`} dir="rtl">
          <Dialog.Title className="modal-title">{title}</Dialog.Title>
          <Dialog.Description className="muted">
            {description ?? 'اطلاعات زیر را تکمیل کنید.'}
          </Dialog.Description>
          <Dialog.Close className="modal-close" aria-label="بستن">
            <X size={18} />
          </Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
