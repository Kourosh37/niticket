'use client';

import { useState, useSyncExternalStore } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { digits } from '@/lib/utils';
import { Button } from './button';

const compactQuery = '(max-height: 640px)';

function subscribe(callback: () => void) {
  const media = window.matchMedia(compactQuery);
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}

export function PageControls({
  page,
  pages,
  onChange,
  label = 'صفحه‌بندی',
  disabled = false,
}: {
  page: number;
  pages: number;
  onChange: (page: number) => void;
  label?: string;
  disabled?: boolean;
}) {
  if (pages <= 1) return null;
  return (
    <nav className="modal-pagination" aria-label={label}>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="اولین صفحه"
        disabled={disabled || page <= 0}
        onClick={() => onChange(0)}
      >
        <ChevronsRight size={18} />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="outline"
        aria-label="صفحه قبلی"
        disabled={disabled || page <= 0}
        onClick={() => onChange(page - 1)}
      >
        <ChevronRight size={18} />
      </Button>
      <span role="status">
        {digits(page + 1)} از {digits(pages)}
      </span>
      <Button
        type="button"
        size="icon"
        variant="outline"
        aria-label="صفحه بعدی"
        disabled={disabled || page >= pages - 1}
        onClick={() => onChange(page + 1)}
      >
        <ChevronLeft size={18} />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="آخرین صفحه"
        disabled={disabled || page >= pages - 1}
        onClick={() => onChange(pages - 1)}
      >
        <ChevronsLeft size={18} />
      </Button>
    </nav>
  );
}

export function PagedItems<T>({
  items,
  renderItem,
  pageSize = 3,
  compactSize = 1,
  label,
  disabled = false,
}: {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  pageSize?: number;
  compactSize?: number;
  label: string;
  disabled?: boolean;
}) {
  const compact = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(compactQuery).matches,
    () => false,
  );
  const size = compact ? compactSize : pageSize;
  // Store the first item's offset, so rotation keeps the current item on screen.
  const [offset, setOffset] = useState(0);
  const pages = Math.ceil(items.length / size);
  const page = Math.min(Math.floor(offset / size), Math.max(0, pages - 1));
  return (
    <div className="modal-paged-content">
      <div className="modal-page-items">
        {items
          .slice(page * size, (page + 1) * size)
          .map((item, index) => renderItem(item, page * size + index))}
      </div>
      <PageControls
        page={page}
        pages={pages}
        onChange={(next) => setOffset(next * size)}
        label={label}
        disabled={disabled}
      />
    </div>
  );
}

export function PagedText({ text }: { text: string }) {
  const compact = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(compactQuery).matches,
    () => false,
  );
  const limit = compact ? 180 : 420;
  const characters = Array.from(text);
  const chunks: string[] = [];
  let chunk = '',
    lines = 0;
  for (const character of characters) {
    chunk += character;
    if (character === '\n') lines++;
    if (chunk.length >= limit || lines >= 5) {
      chunks.push(chunk);
      chunk = '';
      lines = 0;
    }
  }
  if (chunk) chunks.push(chunk);
  return (
    <PagedItems
      key={text}
      items={chunks}
      pageSize={1}
      compactSize={1}
      label="صفحه‌بندی متن"
      renderItem={(chunk, index) => (
        <p key={index} className="message-body modal-text-page">
          {chunk}
        </p>
      )}
    />
  );
}
