'use client';

import { useEffect, useLayoutEffect } from 'react';
import { useRouter } from 'next/navigation';
import { realtime } from '../lib/realtime-client';
import { clientCache } from '../lib/client-cache';
import { clearMediaCache } from '../lib/media-cache';
// Register persisted-draft cleanup even when this document opens on a settings page.
import '../lib/conversation-memory';

export function RealtimeProvider({
  children,
  userId,
}: {
  children: React.ReactNode;
  userId: string;
}) {
  useLayoutEffect(() => {
    clientCache.activate(userId);
    return () => clientCache.clear();
  }, [userId]);
  const router = useRouter();
  useEffect(() => realtime.start(), []);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = realtime.subscribe((signal) => {
      clientCache.changed(signal);
      if (signal.kind === 'change' && signal.topics.includes('access')) clearMediaCache();
      if (
        signal.kind === 'change' &&
        signal.topics.some((topic) => ['access', 'catalog', 'settings'].includes(topic)) &&
        !timer
      )
        timer = setTimeout(() => {
          timer = undefined;
          router.refresh();
        }, 750);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [router]);
  return children;
}
