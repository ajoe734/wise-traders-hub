import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { initPerfMetrics, trackRouteChange } from '@/lib/perfMetrics';
import { initTrafficTracker, trackPageView } from '@/lib/trafficTracker';
import { gtmPush } from '@/lib/analytics/gtm';

// path → feature key for GTM "Function" conversion event.
// Each feature fires Function at most once per session (in-memory ref).
function pathToFeature(pathname: string): string | null {
  if (pathname.startsWith('/app/research')) return 'research';
  if (pathname.startsWith('/app/holdings')) return 'holdings';
  if (pathname.startsWith('/app/signals') || pathname.startsWith('/app/signal/')) return 'signals';
  if (pathname.startsWith('/app/journals') || pathname.startsWith('/app/journal/')) return 'journals';
  if (pathname.startsWith('/app')) return 'app';
  if (pathname.startsWith('/holding-checkup') || pathname.startsWith('/checkup')) return 'checkup';
  if (pathname.startsWith('/learning')) return 'learning';
  return null;
}

export const PerfMetricsTracker = () => {
  const { pathname } = useLocation();
  const firedFeatures = useRef<Set<string>>(new Set());

  useEffect(() => { initPerfMetrics(); initTrafficTracker(); }, []);
  useEffect(() => {
    trackRouteChange(pathname);
    trackPageView(pathname);
    const feature = pathToFeature(pathname);
    if (feature && !firedFeatures.current.has(feature)) {
      firedFeatures.current.add(feature);
      gtmPush('Function', { feature });
    }
  }, [pathname]);
  return null;
};
