import { useEffect, useState } from 'react';
import { FILING_CHECK_MS, taipeiDate } from '../../../supabase/functions/_shared/filingRefreshCore';

/** One clock shared by every valuation consumer; background tabs recheck on return. */
let revision = 0;
let lastCheck = Date.now();
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
function check() {
  const now = Date.now();
  if (taipeiDate(now) !== taipeiDate(lastCheck) || now - lastCheck >= FILING_CHECK_MS) {
    lastCheck = now; revision++;
    for (const notify of listeners) notify();
  }
}
function schedule() {
  timer = setTimeout(() => { check(); schedule(); }, 1000);
}
export function useFilingRefresh(): number {
  const [value, setValue] = useState(revision);
  useEffect(() => {
    const notify = () => setValue(revision);
    listeners.add(notify);
    if (listeners.size === 1) {
      check(); schedule();
      window.addEventListener('focus', check);
      document.addEventListener('visibilitychange', check);
    }
    setValue(revision);
    return () => {
      listeners.delete(notify);
      if (!listeners.size) {
        clearTimeout(timer);
        window.removeEventListener('focus', check);
        document.removeEventListener('visibilitychange', check);
      }
    };
  }, []);
  return value;
}