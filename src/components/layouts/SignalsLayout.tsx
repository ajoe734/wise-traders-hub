import { ReactNode, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Home, Radio, BarChart3, User, TrendingUp, LogOut, ChevronRight, Briefcase } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEffect } from 'react';

// Breadcrumb configuration for signals routes
const getBreadcrumbConfig = (pathname: string) => {
  const crumbs: { label: string; path: string }[] = [];
  crumbs.push({ label: '戰情室', path: '/app' });

  if (pathname === '/app' || pathname === '/app/signals-home') {
    return crumbs;
  }

  const routeLabels: Record<string, string> = {
    signals: '即時訊號',
    signal: '訊號詳情',
    holdings: '持倉一覽',
    performance: '績效統計',
    account: '帳號設定',
  };

  const pathSegments = pathname.replace('/app/', '').split('/').filter(Boolean);
  let currentPath = '/app';

  for (let i = 0; i < pathSegments.length; i++) {
    const segment = pathSegments[i];
    currentPath += `/${segment}`;

    if (i > 0 && ['signal'].includes(pathSegments[i - 1])) {
      continue;
    }

    const label = routeLabels[segment];
    if (label) {
      crumbs.push({ label, path: currentPath });
    }
  }

  return crumbs;
};

interface SignalsLayoutProps {
  children: ReactNode;
}

const bottomNavItems = [
  { href: '/app', icon: Home, label: '戰情室' },
  { href: '/app/signals', icon: Radio, label: '訊號' },
  { href: '/app/holdings', icon: Briefcase, label: '持倉' },
  { href: '/app/performance', icon: BarChart3, label: '績效' },
  { href: '/app/account', icon: User, label: '帳號' },
];

export function SignalsLayout({ children }: SignalsLayoutProps) {
  const { user, isLoading, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const breadcrumbs = useMemo(() => 
    getBreadcrumbConfig(location.pathname),
    [location.pathname]
  );

  useEffect(() => {
    if (!isLoading && !user) {
      navigate('/auth/login', { replace: true });
    }
  }, [user, isLoading, navigate]);

  const showBreadcrumbs = breadcrumbs.length > 1;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">載入中...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const isActive = (href: string) => {
    if (href === '/app') {
      return location.pathname === '/app';
    }
    return location.pathname.startsWith(href);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col signals-theme">
      {/* Top Header - Signals theme (Red accent) */}
      <header className="sticky top-0 z-50 border-b border-signals-border bg-signals-header/95 backdrop-blur supports-[backdrop-filter]:bg-signals-header/60">
        <div className="flex h-14 items-center justify-between px-4">
          <Link to="/app" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-signals-accent">
              <TrendingUp className="h-4 w-4 text-white" />
            </div>
            <div className="flex flex-col">
              <span className="font-semibold text-foreground text-sm">跟單戰情室</span>
              <span className="text-[10px] text-signals-accent font-medium">SIGNALS MODE</span>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <Link 
              to="/app/mode-switch"
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border hover:border-signals-accent/50 transition-colors"
            >
              切換模式
            </Link>
            <button
              onClick={() => {
                logout();
                navigate('/');
              }}
              className="p-2 text-muted-foreground hover:text-foreground transition-colors"
              title="登出"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Breadcrumbs */}
        {showBreadcrumbs && (
          <div className="px-4 py-2 bg-signals-accent/5 border-t border-signals-border/50">
            <nav className="flex items-center gap-1 text-sm overflow-x-auto">
              {breadcrumbs.map((crumb, index) => {
                const isLast = index === breadcrumbs.length - 1;
                return (
                  <div key={crumb.path} className="flex items-center gap-1 whitespace-nowrap">
                    {index > 0 && (
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    )}
                    {isLast ? (
                      <span className="font-medium text-signals-accent">
                        {crumb.label}
                      </span>
                    ) : (
                      <Link 
                        to={crumb.path} 
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {crumb.label}
                      </Link>
                    )}
                  </div>
                );
              })}
            </nav>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1 pb-20">
        {children}
      </main>

      {/* Bottom Navigation - Signals theme */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-signals-border bg-signals-nav/95 backdrop-blur supports-[backdrop-filter]:bg-signals-nav/60 safe-area-bottom">
        <div className="flex items-center justify-around h-16">
          {bottomNavItems.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 px-3 py-2 min-w-[64px] mobile-touch-target transition-colors",
                  active 
                    ? "text-signals-accent" 
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <item.icon className={cn("h-5 w-5", active && "text-signals-accent")} />
                <span className="text-[10px] font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
