import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';

/**
 * Dev/Preview-only 入口：直接設 sessionStorage.lf_force_demo='1' 然後導向 /holding-checkup。
 * 用途：Lovable Preview 路由欄會吃掉 query string，所以 ?demo=1 無法穩定觸發 demo mode。
 * 此路由提供一個乾淨的 path-only 入口，由 CheckupModeContext 的 isPreviewLikeEnv() 把關，
 * production hostname (wise-traders-hub.lovable.app / legendflow.tw) 不會生效。
 */
export default function HoldingCheckupDemoEntry() {
  useEffect(() => {
    try {
      const h = typeof window !== 'undefined' ? window.location.hostname : '';
      const isPreview =
        import.meta.env.DEV ||
        h === 'localhost' ||
        h === '127.0.0.1' ||
        h.endsWith('.lovableproject.com') ||
        (h.startsWith('id-preview--') && h.endsWith('.lovable.app'));
      if (isPreview) {
        sessionStorage.setItem('lf_force_demo', '1');
      }
    } catch {}
  }, []);
  return <Navigate to="/holding-checkup" replace />;
}
