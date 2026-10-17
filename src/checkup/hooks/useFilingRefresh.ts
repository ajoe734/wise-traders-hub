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
  clearTimeout(timer);
  const now = Date.now();
  const midnight = Date.parse(`${taipeiDate(now)}T00:00:00+08:00`) + 86400000;
  const delay = Math.max(1, Math.min(midnight - now, FILING_CHECK_MS - (now - lastCheck)));
  timer = setTimeout(() => { check(); schedule(); }, delay);
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