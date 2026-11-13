'use client';

import { Fragment, useId, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react';
import { digits } from '@/lib/utils';
import { Button } from './button';

/** Keep all fields mounted: navigating a wizard must preserve drafts, files and recordings. */
export function ModalForm({
  sections,
  disabled = false,
  lockNavigation = false,
  submitDisabled = false,
  submitLabel,
  busyLabel = 'در حال ذخیره…',
  onSubmit,
  onCancel,
  children,
  className = '',
}: {
  sections: { title: string; content: React.ReactNode }[];
  disabled?: boolean;
  lockNavigation?: boolean;
  submitDisabled?: boolean;
  submitLabel: string;
  busyLabel?: string;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
  onCancel?: () => void;
  children?: React.ReactNode;
  className?: string;
}) {
  const id = useId();
  const [active, setActive] = useState(0),
    [reached, setReached] = useState(0);
  const form = useRef<HTMLFormElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const pendingFocus = useRef<{
    step: number;
    invalid?: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  } | null>(null);
  const last = active === sections.length - 1;
  const locked = disabled || lockNavigation;

  useLayoutEffect(() => {
    const request = pendingFocus.current;
    pendingFocus.current = null;
    if (!request || request.step !== active) return;
    // Focus after the panel becomes visible, before paint. A deferred animation
    // frame can steal a newer field focus and discard the user's first keystrokes.
    (request.invalid ?? tabs.current[active])?.focus({ preventScroll: true });
    request.invalid?.reportValidity();
  }, [active]);

  function validate(through: number) {
    const panels = form.current?.querySelectorAll<HTMLElement>('[data-form-section]');
    for (let index = 0; index <= through; index++) {
      const invalid = panels?.[index]?.querySelector<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >('input:invalid, textarea:invalid, select:invalid');
      if (!invalid) continue;
      if (index === active) {
        invalid.focus({ preventScroll: true });
        invalid.reportValidity();
      } else {
        pendingFocus.current = { step: index, invalid };
        setActive(index);
      }
      return false;
    }
    return true;
  }

  function move(next: number) {
    if (locked || next < 0 || next >= sections.length || next > Math.max(reached, active + 1))
      return;
    if (next > active && !validate(next - 1)) return;
    if (next === active) {
      tabs.current[next]?.focus({ preventScroll: true });
      return;
    }
    pendingFocus.current = { step: next };
    setActive(next);
    setReached((previous) => Math.max(previous, next));
  }

  return (
    <form
      ref={form}
      className={`modal-form ${className}`}
      noValidate
      onKeyDown={(event) => {
        if (
          last ||
          event.key !== 'Enter' ||
          event.nativeEvent.isComposing ||
          !(event.target instanceof HTMLInputElement) ||
          ['file', 'checkbox', 'radio', 'button', 'submit'].includes(event.target.type)
        )
          return;
        event.preventDefault();
        if (!event.repeat) move(active + 1);
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (locked) return;
        if (!last) {
          move(active + 1);
          return;
        }
        if (!submitDisabled && validate(sections.length - 1)) onSubmit(event);
      }}
    >
      {sections.length > 1 && (
        <>
          <div className="modal-form-tabs modal-form-steps" role="tablist" aria-label="مراحل فرم">
            {sections.map((section, index) => (
              <Fragment key={section.title}>
                {index > 0 && (
                  <ChevronLeft className="modal-step-arrow" size={14} aria-hidden="true" />
                )}
                <button
                  ref={(element) => {
                    tabs.current[index] = element;
                  }}
                  id={`${id}-tab-${index}`}
                  type="button"
                  role="tab"
                  aria-selected={active === index}
                  aria-current={active === index ? 'step' : undefined}
                  aria-controls={`${id}-panel-${index}`}
                  data-complete={index < reached || undefined}
                  tabIndex={active === index ? 0 : -1}
                  disabled={locked || index > reached}
                  onClick={() => move(index)}
                  onKeyDown={(event) => {
                    let next = active;
                    if (event.key === 'ArrowLeft') next = Math.min(reached, active + 1);
                    else if (event.key === 'ArrowRight') next = Math.max(0, active - 1);
                    else if (event.key === 'Home') next = 0;
                    else if (event.key === 'End') next = reached;
                    else return;
                    event.preventDefault();
                    move(next);
                  }}
                >
                  <span className="modal-step-number" aria-hidden="true">
                    {index < reached && active !== index ? <Check size={13} /> : digits(index + 1)}
                  </span>
                  <span className="modal-step-name">{section.title}</span>
                </button>
              </Fragment>
            ))}
          </div>
          <span className="sr-only" role="status">
            مرحله {digits(active + 1)} از {digits(sections.length)}: {sections[active].title}
          </span>
        </>
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
      <div className="modal-form-footer">
        {children}
        <div className="modal-form-actions">
          {active > 0 && (
            <Button
              type="button"
              variant="outline"
              disabled={locked}
              onClick={() => move(active - 1)}
            >
              <ChevronRight size={16} />
              مرحله قبل
            </Button>
          )}
          {last ? (
            <Button
              key="confirm"
              type="submit"
              className="modal-form-primary"
              disabled={locked || submitDisabled}
              aria-busy={disabled}
              onClick={(event) => {
                if (event.detail > 1) event.preventDefault();
              }}
            >
              {disabled ? (
                <LoaderCircle className="modal-form-spinner" size={16} />
              ) : (
                <Check size={16} />
              )}
              {disabled ? busyLabel : submitLabel}
            </Button>
          ) : (
            <Button
              key="next"
              type="button"
              className="modal-form-primary"
              disabled={locked}
              onClick={() => move(active + 1)}
            >
              مرحله بعد
              <ChevronLeft size={16} />
            </Button>
          )}
          {onCancel && (
            <Button type="button" variant="ghost" disabled={disabled} onClick={onCancel}>
              انصراف
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
