import { useEffect, useRef } from 'react';
import { trackRaw } from '@/lib/analytics/events';

interface Props {
  event: string;
  props?: Record<string, unknown>;
  /** % visible before firing (0-1). Default 0.4. */
  threshold?: number;
  /** Fire only once per mount. Default true. */
  once?: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * Fires a single analytics event when the wrapped element scrolls into view.
 * Uses IntersectionObserver — zero cost when off-screen.
 */
export function TrackOnVisible({ event, props, threshold = 0.4, once = true, children, className }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (once && firedRef.current) continue;
          firedRef.current = true;
          trackRaw(event, props);
          if (once) obs.disconnect();
        }
      },
      { threshold },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [event, JSON.stringify(props), threshold, once]);

  return <div ref={ref} className={className}>{children}</div>;
}
