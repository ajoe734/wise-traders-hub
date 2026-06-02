import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { trackPageView } from '@/lib/trafficTracker';
import { trackRaw } from '@/lib/analytics/events';

/**
 * Mounts once at App root. Fires:
 *  - legacy page-view batch (trackPageView) for traffic_events page-view rows
 *  - GA-style `page_view` named event with from/to path
 * on every React Router navigation.
 */
export function useAutoPageView() {
  const location = useLocation();
  const prevRef = useRef<string | null>(null);

  useEffect(() => {
    const path = location.pathname;
    const from = prevRef.current;
    prevRef.current = path;
    trackPageView(path);
    trackRaw('page_view', { path, from: from || undefined });
  }, [location.pathname]);
}
