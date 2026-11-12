'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOptimistic, useTransition, type CSSProperties } from 'react';

export function InboxTabs({
  active,
  tabs,
}: {
  active: string;
  tabs: { key: string; label: string; href: string }[];
}) {
  const router = useRouter();
  const [selected, select] = useOptimistic(active);
  const [pending, startTransition] = useTransition();
  const index = Math.max(
    0,
    tabs.findIndex((tab) => tab.key === selected),
  );
  return (
    <nav
      className="inbox-tabs"
      aria-label="نمایش گفتگوها"
      aria-busy={pending}
      style={{ '--inbox-tab-index': index, '--inbox-tab-count': tabs.length } as CSSProperties}
    >
      <span className="inbox-tabs-indicator" aria-hidden="true" />
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          scroll={false}
          aria-current={active === tab.key ? 'page' : undefined}
          data-selected={selected === tab.key ? 'true' : undefined}
          onNavigate={(event) => {
            event.preventDefault();
            startTransition(() => {
              select(tab.key);
              router.push(tab.href, { scroll: false });
            });
          }}
        >
          {tab.label}
        </Link>
      ))}
      {pending && (
        <span role="status" className="sr-only">
          در حال دریافت گفتگوها…
        </span>
      )}
    </nav>
  );
}
