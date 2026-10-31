import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { ga4PageView } from '@/lib/analytics/ga4';

/** 單頁應用每次切換路由送一次 GA4 page_view（後台頁不送）。 */
export default function Ga4PageViewTracker() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    // 等 Helmet 更新 document.title
    const t = window.setTimeout(() => ga4PageView(pathname, search), 300);
    return () => window.clearTimeout(t);
  }, [pathname, search]);
  return null;
}
