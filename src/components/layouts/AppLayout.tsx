import { ReactNode, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Home, Radio, BookOpen, User, TrendingUp, LogOut, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEffect } from 'react';

// Breadcrumb configuration for different routes
const getBreadcrumbConfig = (pathname: string) => {
  const crumbs: { label: string; path: string }[] = [];

  // Always start with 首頁
  crumbs.push({ label: '首頁', path: '/app' });

  if (pathname === '/app') {
    return crumbs;
  }

  const routeLabels: Record<string, string> = {
    signals: '即時訊號',
    signal: '訊號詳情',
    journals: '週記教學',
    journal: '週記詳情',
    account: '帳號',
    system: '策略詳情',
  };

  const pathSegments = pathname.replace('/app/', '').split('/').filter(Boolean);
  let currentPath = '/app';

  for (let i = 0; i < pathSegments.length; i++) {
    const segment = pathSegments[i];
    currentPath += `/${segment}`;

    // Skip ID segments
    if (i > 0 && ['signal', 'journal', 'system'].includes(pathSegments[i - 1])) {
      continue;
    }

    const label = routeLabels[segment];
    if (label) {
      crumbs.push({ label, path: currentPath });
    }
  }

  return crumbs;
};

interface AppLayoutProps {
  children: ReactNode;
}

const bottomNavItems = [
  { href: '/app', icon: Home, label: '首頁' },
  { href: '/app/signals', icon: Radio, label: '即時訊號' },
  { href: '/app/journals', icon: BookOpen, label: '週記教學' },
  { href: '/app/account', icon: User, label: '帳號' },
];

export function AppLayout({ children }: AppLayoutProps) {
  const { user, isLoading, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Generate breadcrumbs based on current path - must be before early returns
  const breadcrumbs = useMemo(() => 
    getBreadcrumbConfig(location.pathname),
    [location.pathname]
  );

  useEffect(() => {
    if (!isLoading && !user) {
      navigate('/auth/login', { replace: true });
    }
  }, [user, isLoading, navigate]);

  // Only show breadcrumbs if we're not on the home page
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
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top Header - minimal for mobile */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-14 items-center justify-between px-4">
          <Link to="/app" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-hero">
              <TrendingUp className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-semibold text-foreground">智富股市實戰學院</span>
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

        {/* Breadcrumbs */}
        {showBreadcrumbs && (
          <div className="px-4 py-2 bg-muted/30 border-t border-border/50">
            <nav className="flex items-center gap-1 text-sm overflow-x-auto">
              {breadcrumbs.map((crumb, index) => {
                const isLast = index === breadcrumbs.length - 1;
                return (
                  <div key={crumb.path} className="flex items-center gap-1 whitespace-nowrap">
                    {index > 0 && (
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    )}
                    {isLast ? (
                      <span className="font-medium text-primary">
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

      {/* Main Content - with bottom padding for nav */}
      <main className="flex-1 pb-20">
        {children}
      </main>

      {/* Bottom Navigation - Mobile-first */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 safe-area-bottom">
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
                    ? "text-primary" 
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <item.icon className={cn("h-5 w-5", active && "text-primary")} />
                <span className="text-[10px] font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
