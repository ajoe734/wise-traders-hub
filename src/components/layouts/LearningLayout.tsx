import { ReactNode, useMemo, useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Home, BookOpen, GraduationCap, User, Compass, LogOut, ChevronRight, Library, ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

// localStorage keys for unread tracking
const JOURNALS_LAST_SEEN_KEY = 'app:lastSeen:journals';

export function markAppJournalsAsRead() {
  localStorage.setItem(JOURNALS_LAST_SEEN_KEY, Date.now().toString());
}

// Breadcrumb configuration for learning routes
const getBreadcrumbConfig = (pathname: string) => {
  const crumbs: { label: string; path: string }[] = [];
  crumbs.push({ label: '學習中心', path: '/app' });

  if (pathname === '/app' || pathname === '/app/learning-home') return crumbs;

  if (pathname.startsWith('/app/journal/')) {
    crumbs.push({ label: '週記教學', path: '/app/journals' });
    crumbs.push({ label: '週記詳情', path: pathname });
    return crumbs;
  }

  if (pathname.startsWith('/app/course/')) {
    crumbs.push({ label: '課程系統', path: '/app/courses' });
    crumbs.push({ label: '課程詳情', path: pathname });
    return crumbs;
  }

  const routeLabels: Record<string, string> = {
    journals: '週記教學',
    courses: '課程系統',
    roadmap: '學習路徑',
    library: '知識庫',
    account: '帳號設定',
  };

  const pathSegments = pathname.replace('/app/', '').split('/').filter(Boolean);
  let currentPath = '/app';

  for (let i = 0; i < pathSegments.length; i++) {
    const segment = pathSegments[i];
    currentPath += `/${segment}`;
    const label = routeLabels[segment];
    if (label) crumbs.push({ label, path: currentPath });
  }

  return crumbs;
};

const getNavGroup = (pathname: string): string => {
  if (pathname === '/app') return '/app';
  if (pathname === '/app/journals' || pathname.startsWith('/app/journal/')) return '/app/journals';
  if (pathname === '/app/courses' || pathname.startsWith('/app/course/')) return '/app/courses';
  if (pathname === '/app/library' || pathname.startsWith('/app/library')) return '/app/library';
  if (pathname === '/app/account' || pathname.startsWith('/app/account')) return '/app/account';
  return '/app';
};

interface LearningLayoutProps {
  children: ReactNode;
}

const bottomNavItems = [
  { href: '/app', icon: Home, label: '首頁', group: '/app' },
  { href: '/app/journals', icon: BookOpen, label: '週記', group: '/app/journals' },
  { href: '/app/courses', icon: GraduationCap, label: '課程', group: '/app/courses' },
  { href: '/app/library', icon: Library, label: '知識庫', group: '/app/library' },
  { href: '/app/account', icon: User, label: '帳號', group: '/app/account' },
];

export function LearningLayout({ children }: LearningLayoutProps) {
  const { user, isLoading, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  // No journals table yet, so unread count is 0
  const unreadCount = 0;

  const breadcrumbs = useMemo(() => getBreadcrumbConfig(location.pathname), [location.pathname]);
  const currentNavGroup = useMemo(() => getNavGroup(location.pathname), [location.pathname]);
  const isNotHome = location.pathname !== '/app';

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

  if (!user) return null;

  const handleBack = () => {
    if (breadcrumbs.length >= 2) {
      navigate(breadcrumbs[breadcrumbs.length - 2].path);
    } else {
      navigate('/app');
    }
  };

  const isActive = (group: string) => currentNavGroup === group;

  return (
    <div className="min-h-screen bg-background flex flex-col learning-theme">
      <header className="sticky top-0 z-50 border-b border-learning-border bg-gradient-to-r from-learning-header via-learning-header to-learning-accent/5 backdrop-blur supports-[backdrop-filter]:bg-learning-header/80">
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            {isNotHome && (
              <button onClick={handleBack} className="p-2 -ml-2 text-muted-foreground hover:text-foreground transition-colors" aria-label="返回">
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            <Link to="/app" className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-learning-accent to-learning-accent/80 shadow-[0_0_12px_-3px_hsl(var(--learning-accent)/0.5)]">
                <Compass className="h-4 w-4 text-white" />
              </div>
              <div className="flex flex-col">
                <span className="font-semibold text-foreground text-sm">修煉學習系統</span>
                <span className="text-[10px] text-learning-accent font-medium tracking-wider">LEARNING MODE</span>
              </div>
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/app/mode-switch" className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg border border-foreground/10 hover:border-learning-accent/50 hover:bg-learning-accent/5 transition-all">
              切換模式
            </Link>
            <button onClick={() => { logout(); navigate('/'); }} className="p-2 text-muted-foreground hover:text-foreground transition-colors" title="登出">
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>

        {showBreadcrumbs && (
          <div className="px-4 py-2 bg-learning-accent/5 border-t border-learning-border/50">
            <nav className="flex items-center gap-1 text-sm overflow-x-auto">
              {breadcrumbs.map((crumb, index) => {
                const isLast = index === breadcrumbs.length - 1;
                return (
                  <div key={crumb.path} className="flex items-center gap-1 whitespace-nowrap">
                    {index > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
                    {isLast ? (
                      <span className="font-medium text-learning-accent">{crumb.label}</span>
                    ) : (
                      <Link to={crumb.path} className="text-muted-foreground hover:text-foreground transition-colors">{crumb.label}</Link>
                    )}
                  </div>
                );
              })}
            </nav>
          </div>
        )}
      </header>

      <main className="flex-1 pb-20">{children}</main>

      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-learning-border bg-gradient-to-t from-learning-nav via-learning-nav to-learning-nav/95 backdrop-blur supports-[backdrop-filter]:bg-learning-nav/80 safe-area-bottom">
        <div className="flex items-center justify-around h-16">
          {bottomNavItems.map((item) => {
            const active = isActive(item.group);
            const showBadge = item.group === '/app/journals' && unreadCount > 0;
            return (
              <Link key={item.href} to={item.href} className={cn("flex flex-col items-center justify-center gap-1 px-3 py-2 min-w-[64px] mobile-touch-target transition-all", active ? "text-learning-accent" : "text-muted-foreground hover:text-foreground")}>
                <div className={cn("relative", active && "drop-shadow-[0_0_8px_hsl(var(--learning-accent)/0.6)]")}>
                  <item.icon className={cn("h-5 w-5", active && "text-learning-accent")} />
                  {showBadge && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 flex items-center justify-center text-[10px] font-bold text-white bg-destructive rounded-full">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </div>
                <span className={cn("text-[10px] font-medium", active && "text-learning-accent")}>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
