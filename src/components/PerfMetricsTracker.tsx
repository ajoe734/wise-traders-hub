import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { initPerfMetrics, trackRouteChange } from '@/lib/perfMetrics';
import { initTrafficTracker, trackPageView } from '@/lib/trafficTracker';

export const PerfMetricsTracker = () => {
  const { pathname } = useLocation();
  useEffect(() => { initPerfMetrics(); initTrafficTracker(); }, []);
  useEffect(() => { trackRouteChange(pathname); trackPageView(pathname); }, [pathname]);
  return null;
};
