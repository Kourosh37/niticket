'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { useRef } from 'react';
import { X } from 'lucide-react';

const focusTargets = new WeakMap<HTMLElement, HTMLElement>();

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide = false,
  presentation = 'dialog',
  className = '',
  id,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  wide?: boolean;
  presentation?: 'dialog' | 'sheet' | 'drawer';
  className?: string;
  id?: string;
  onCloseAutoFocus?: React.ComponentProps<typeof Dialog.Content>['onCloseAutoFocus'];
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className={`modal-content ${wide ? 'modal-wide' : ''} modal-${presentation} ${className}`}
          id={id}
          dir="rtl"
          onOpenAutoFocus={(event) => {
            const active = document.activeElement;
            if (!(active instanceof HTMLElement)) return;
            const previousDialog = active.closest<HTMLElement>('[role="dialog"]');
            // A menu can hand over to another dialog while its exit animation runs.
            returnFocus.current =
              previousDialog?.dataset.state === 'closed'
                ? (focusTargets.get(previousDialog) ?? null)
                : active;
            if (event.target instanceof HTMLElement && returnFocus.current)
              focusTargets.set(event.target, returnFocus.current);
          }}
          onCloseAutoFocus={(event) => {
            onCloseAutoFocus?.(event);
            if (!event.defaultPrevented && returnFocus.current?.isConnected) {
              event.preventDefault();
              returnFocus.current.focus({ preventScroll: true });
            }
          }}
        >
          <div className="modal-heading">
            <Dialog.Title className="modal-title">{title}</Dialog.Title>
            <Dialog.Description className="muted">
              {description ?? 'اطلاعات زیر را تکمیل کنید.'}
            </Dialog.Description>
            <Dialog.Close className="modal-close" aria-label="بستن">
              <X size={18} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
