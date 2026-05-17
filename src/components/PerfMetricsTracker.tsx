import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { initPerfMetrics, trackRouteChange } from '@/lib/perfMetrics';

export const PerfMetricsTracker = () => {
  const { pathname } = useLocation();
  useEffect(() => { initPerfMetrics(); }, []);
  useEffect(() => { trackRouteChange(pathname); }, [pathname]);
  return null;
};
