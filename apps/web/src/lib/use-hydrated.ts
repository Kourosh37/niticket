'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const ready = () => true;
const server = () => false;

/** Keep controlled inputs inert until React can retain their first interaction. */
export function useHydrated() {
  return useSyncExternalStore(subscribe, ready, server);
}
