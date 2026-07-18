import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { SEO } from "@/components/SEO";
import { trackRaw } from "@/lib/analytics/events";

interface FromNotificationState {
  fromNotification?: {
    id?: string;
    type?: string;
    source?: string;
  };
}

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
    const state = (location.state ?? null) as FromNotificationState | null;
    const from = state?.fromNotification;
    if (from) {
      trackRaw('notification_link_404', {
        notification_id: from.id,
        notification_type: from.type,
        source: from.source,
        path: location.pathname,
      });
    }
  }, [location.pathname, location.state]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <SEO
        title="找不到頁面 (404) | legendflow"
        description="您要找的頁面不存在。回到首頁繼續探索專家與訂閱方案。"
        path={location.pathname}
        noindex
      />
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">Oops! Page not found</p>
        <a href="/" className="text-primary underline hover:text-primary/90">
          Return to Home
        </a>
      </div>
    </div>
  );
};

export default NotFound;
