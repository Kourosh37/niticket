'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { realtime } from '../lib/realtime-client';

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  useEffect(() => realtime.start(), []);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = realtime.subscribe((signal) => {
      if (signal.kind === 'change' && signal.topics.includes('access') && !timer)
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
