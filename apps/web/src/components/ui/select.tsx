'use client';

import { useState } from 'react';
import * as Primitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';

type Option = { value: string; label: string; disabled?: boolean };

/** Shared RTL select. Keep the submitted value separate from Radix's nonempty item keys. */
export function Select({
  options,
  value,
  defaultValue = '',
  onValueChange,
  name,
  disabled,
  id,
  'aria-label': ariaLabel,
}: {
  options: Option[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  name?: string;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
}) {
  const [selection, setSelection] = useState(defaultValue);
  const selected = value ?? selection;
  return (
    <Primitive.Root
      dir="rtl"
      value={`value:${selected}`}
      disabled={disabled}
      onValueChange={(key) => {
        const next = key.slice(6);
        setSelection(next);
        onValueChange?.(next);
      }}
    >
      {name && <input type="hidden" name={name} value={selected} disabled={disabled} />}
      <Primitive.Trigger className="select-trigger" id={id} aria-label={ariaLabel}>
        <Primitive.Value />
        <Primitive.Icon className="select-chevron">
          <ChevronDown size={18} aria-hidden="true" />
        </Primitive.Icon>
      </Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content
          className="select-content"
          position="popper"
          sideOffset={6}
          collisionPadding={12}
        >
          <Primitive.ScrollUpButton className="select-scroll">
            <ChevronUp size={16} />
          </Primitive.ScrollUpButton>
          <Primitive.Viewport className="select-viewport">
            {options.map((option) => (
              <Primitive.Item
                className="select-item"
                key={option.value}
                value={`value:${option.value}`}
                disabled={option.disabled}
              >
                <Primitive.ItemText>{option.label}</Primitive.ItemText>
                <Primitive.ItemIndicator className="select-check">
                  <Check size={16} aria-hidden="true" />
                </Primitive.ItemIndicator>
              </Primitive.Item>
            ))}
          </Primitive.Viewport>
          <Primitive.ScrollDownButton className="select-scroll">
            <ChevronDown size={16} />
          </Primitive.ScrollDownButton>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
