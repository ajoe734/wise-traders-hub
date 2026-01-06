import { ReactNode, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Home, BookOpen, GraduationCap, User, Compass, LogOut, ChevronRight, Library } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEffect } from 'react';

// Breadcrumb configuration for learning routes
const getBreadcrumbConfig = (pathname: string) => {
  const crumbs: { label: string; path: string }[] = [];
  crumbs.push({ label: '學習中心', path: '/app' });

  if (pathname === '/app' || pathname === '/app/learning-home') {
    return crumbs;
  }

  const routeLabels: Record<string, string> = {
    journals: '週記教學',
    journal: '週記詳情',
    courses: '課程系統',
    course: '課程詳情',
    roadmap: '學習路徑',
    library: '知識庫',
    account: '帳號設定',
  };

  const pathSegments = pathname.replace('/app/', '').split('/').filter(Boolean);
  let currentPath = '/app';

  for (let i = 0; i < pathSegments.length; i++) {
    const segment = pathSegments[i];
    currentPath += `/${segment}`;

    if (i > 0 && ['journal', 'course'].includes(pathSegments[i - 1])) {
      continue;
    }

    const label = routeLabels[segment];
    if (label) {
      crumbs.push({ label, path: currentPath });
    }
  }

  return crumbs;
};

interface LearningLayoutProps {
  children: ReactNode;
}

const bottomNavItems = [
  { href: '/app', icon: Home, label: '首頁' },
  { href: '/app/journals', icon: BookOpen, label: '週記' },
  { href: '/app/courses', icon: GraduationCap, label: '課程' },
  { href: '/app/library', icon: Library, label: '知識庫' },
  { href: '/app/account', icon: User, label: '帳號' },
];

export function LearningLayout({ children }: LearningLayoutProps) {
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
    <div className="min-h-screen bg-background flex flex-col learning-theme">
      {/* Top Header - Learning theme (Blue accent) */}
      <header className="sticky top-0 z-50 border-b border-learning-border bg-learning-header/95 backdrop-blur supports-[backdrop-filter]:bg-learning-header/60">
        <div className="flex h-14 items-center justify-between px-4">
          <Link to="/app" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-learning-accent">
              <Compass className="h-4 w-4 text-white" />
            </div>
            <div className="flex flex-col">
              <span className="font-semibold text-foreground text-sm">修煉學習系統</span>
              <span className="text-[10px] text-learning-accent font-medium">LEARNING MODE</span>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <Link 
              to="/app/mode-switch"
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border hover:border-learning-accent/50 transition-colors"
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
          <div className="px-4 py-2 bg-learning-accent/5 border-t border-learning-border/50">
            <nav className="flex items-center gap-1 text-sm overflow-x-auto">
              {breadcrumbs.map((crumb, index) => {
                const isLast = index === breadcrumbs.length - 1;
                return (
                  <div key={crumb.path} className="flex items-center gap-1 whitespace-nowrap">
                    {index > 0 && (
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    )}
                    {isLast ? (
                      <span className="font-medium text-learning-accent">
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

      {/* Bottom Navigation - Learning theme */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-learning-border bg-learning-nav/95 backdrop-blur supports-[backdrop-filter]:bg-learning-nav/60 safe-area-bottom">
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
                    ? "text-learning-accent" 
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <item.icon className={cn("h-5 w-5", active && "text-learning-accent")} />
                <span className="text-[10px] font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
