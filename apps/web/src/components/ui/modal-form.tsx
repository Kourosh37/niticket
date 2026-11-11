'use client';

import { useId, useRef, useState } from 'react';
import { digits } from '@/lib/utils';

/** Keep every field mounted so switching sections never discards uncontrolled values or files. */
export function ModalForm({
  sections,
  disabled = false,
  lockNavigation = false,
  onSubmit,
  children,
  className = '',
}: {
  sections: { title: string; content: React.ReactNode }[];
  disabled?: boolean;
  lockNavigation?: boolean;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
  children: React.ReactNode;
  className?: string;
}) {
  const id = useId();
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <form
      className={`modal-form ${className}`}
      noValidate
      onSubmit={(event) => {
        const invalid = event.currentTarget.querySelector<
          HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
        >('input:invalid, textarea:invalid, select:invalid');
        if (invalid) {
          event.preventDefault();
          const panel = invalid.closest<HTMLElement>('[data-form-section]');
          if (panel) setActive(Number(panel.dataset.formSection));
          requestAnimationFrame(() => {
            invalid.focus({ preventScroll: true });
            invalid.reportValidity();
          });
          return;
        }
        onSubmit(event);
      }}
    >
      {sections.length > 1 && (
        <div className="modal-form-tabs" role="tablist" aria-label="بخش‌های فرم">
          {sections.map((section, index) => (
            <button
              key={section.title}
              ref={(element) => {
                tabs.current[index] = element;
              }}
              id={`${id}-tab-${index}`}
              type="button"
              role="tab"
              aria-selected={active === index}
              aria-controls={`${id}-panel-${index}`}
              tabIndex={active === index ? 0 : -1}
              disabled={disabled || lockNavigation}
              onClick={() => setActive(index)}
              onKeyDown={(event) => {
                let next = active;
                if (event.key === 'ArrowLeft') next = (active + 1) % sections.length;
                else if (event.key === 'ArrowRight')
                  next = (active - 1 + sections.length) % sections.length;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = sections.length - 1;
                else return;
                event.preventDefault();
                setActive(next);
                tabs.current[next]?.focus();
              }}
            >
              <span aria-hidden="true">{digits(index + 1)}</span>
              {section.title}
            </button>
          ))}
        </div>
      )}
      <fieldset className="modal-form-fields" disabled={disabled}>
        {sections.map((section, index) => (
          <section
            key={section.title}
            id={`${id}-panel-${index}`}
            role={sections.length > 1 ? 'tabpanel' : undefined}
            aria-labelledby={sections.length > 1 ? `${id}-tab-${index}` : undefined}
            data-form-section={index}
            hidden={active !== index}
            className="modal-form-panel"
          >
            {section.content}
          </section>
        ))}
      </fieldset>
      <div className="modal-form-footer">{children}</div>
    </form>
  );
}
