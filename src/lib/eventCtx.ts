import { createContext, useContext, useEffect, useState } from 'react';
import type { EventData } from './useEvent';

export const EventCtx = createContext<EventData | null>(null);
export const useEv = () => useContext(EventCtx)!;

export function useNow(ms = 15000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

let toastSet: ((m: string | null) => void) | null = null;
export const registerToast = (f: typeof toastSet) => { toastSet = f; };
export function toast(m: string) {
  toastSet?.(m);
  setTimeout(() => toastSet?.(null), 3500);
}
