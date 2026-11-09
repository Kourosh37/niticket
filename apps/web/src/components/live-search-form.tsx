'use client';

import { useEffect, useRef, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';

/** Debounced, in-place server filtering; Next cancels superseded navigations. */
export function LiveSearchForm({
  action,
  children,
  className,
  preserve = [],
}: {
  preserve?: string[];
  action?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const composing = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);

  function search(form: HTMLFormElement, immediate = false) {
    clearTimeout(timer.current);
    if (composing.current) return;
    const current = new URLSearchParams(window.location.search);
    const params = new URLSearchParams();
    for (const key of preserve) {
      const value = current.get(key);
      if (value) params.set(key, value);
    }
    new FormData(form).forEach((value, key) => {
      if (typeof value === 'string' && value.trim()) params.set(key, value.trim());
    });
    params.delete('cursor');
    const target = `${action ?? pathname}?${params}`;
    timer.current = setTimeout(
      () => {
        if (target === `${window.location.pathname}${window.location.search}`) return;
        startTransition(() => router.replace(target, { scroll: false }));
      },
      immediate ? 0 : 300,
    );
  }

  return (
    <form
      role="search"
      className={className}
      action={action}
      aria-busy={pending}
      onChange={(event) => search(event.currentTarget)}
      onCompositionStart={() => {
        composing.current = true;
        clearTimeout(timer.current);
      }}
      onCompositionEnd={(event) => {
        composing.current = false;
        search(event.currentTarget);
      }}
      onSubmit={(event) => {
        event.preventDefault();
        search(event.currentTarget, true);
      }}
    >
      {children}
      <span className="sr-only" role="status">
        {pending ? 'در حال جستجو…' : ''}
      </span>
    </form>
  );
}
