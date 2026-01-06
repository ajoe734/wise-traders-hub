import { ReactNode, useMemo, useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getUserSubscriptions, getSignalsForUser, getJournalsForUser } from '@/data/mockData';
import { PlanType } from '@/types';
import { 
  Home, Radio, BookOpen, User, TrendingUp, LogOut, ChevronRight, ChevronLeft,
  Briefcase, BarChart3, GraduationCap, Library, Compass
} from 'lucide-react';
import { cn } from '@/lib/utils';

// localStorage keys for unread tracking
const SIGNALS_LAST_SEEN_KEY = 'app:lastSeen:signals';
const JOURNALS_LAST_SEEN_KEY = 'app:lastSeen:journals';

export function markAppSignalsAsRead() {
  localStorage.setItem(SIGNALS_LAST_SEEN_KEY, Date.now().toString());
}

export function markAppJournalsAsRead() {
  localStorage.setItem(JOURNALS_LAST_SEEN_KEY, Date.now().toString());
}

// Get which nav group a path belongs to
const getNavGroup = (pathname: string): string => {
  if (pathname === '/app') return '/app';
  if (pathname === '/app/dashboard/signals') return '/app/dashboard/signals';
  if (pathname === '/app/dashboard/learning') return '/app/dashboard/learning';
  if (pathname === '/app/signals' || pathname.startsWith('/app/signal/')) return '/app/signals';
  if (pathname === '/app/journals' || pathname.startsWith('/app/journal/')) return '/app/journals';
  if (pathname === '/app/holdings' || pathname.startsWith('/app/holdings')) return '/app/holdings';
  if (pathname === '/app/performance' || pathname.startsWith('/app/performance')) return '/app/performance';
  if (pathname === '/app/courses' || pathname.startsWith('/app/course/')) return '/app/courses';
  if (pathname === '/app/library' || pathname.startsWith('/app/library')) return '/app/library';
  if (pathname === '/app/account' || pathname.startsWith('/app/account')) return '/app/account';
  return '/app';
};

// Breadcrumb configuration
const getBreadcrumbConfig = (pathname: string, mode: 'signals' | 'learning' | 'both') => {
  const crumbs: { label: string; path: string }[] = [];
  const homeLabel = mode === 'learning' ? '學習中心' : mode === 'signals' ? '戰情室' : '首頁';
  crumbs.push({ label: homeLabel, path: '/app' });

  if (pathname === '/app') {
    return crumbs;
  }

  // Special handling for detail pages
  if (pathname.startsWith('/app/signal/')) {
    crumbs.push({ label: '即時訊號', path: '/app/signals' });
    crumbs.push({ label: '訊號詳情', path: pathname });
    return crumbs;
  }

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
    signals: '即時訊號',
    journals: '週記教學',
    holdings: '持倉一覽',
    performance: '績效統計',
    courses: '課程系統',
    library: '知識庫',
    account: '帳號設定',
  };

  const pathSegments = pathname.replace('/app/', '').split('/').filter(Boolean);
  let currentPath = '/app';

  for (let i = 0; i < pathSegments.length; i++) {
    const segment = pathSegments[i];
    currentPath += `/${segment}`;

    const label = routeLabels[segment];
    if (label) {
      crumbs.push({ label, path: currentPath });
    }
  }

  return crumbs;
};

interface UnifiedAppLayoutProps {
  children: ReactNode;
}

type NavItem = {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  group: string;
  badgeKey?: 'signals' | 'journals';
};

export function UnifiedAppLayout({ children }: UnifiedAppLayoutProps) {
  const { user, isLoading, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [unreadSignals, setUnreadSignals] = useState(0);
  const [unreadJournals, setUnreadJournals] = useState(0);

  // Determine user's subscription type
  const subscriptions = user ? getUserSubscriptions(user.id) : [];
  const hasAdvisor = subscriptions.some(s => 
    s.plan.planType === PlanType.ANALYST_SIGNAL_L1 || 
    s.plan.planType === PlanType.ANALYST_SIGNAL_DIAG_L2
  );
  const hasMentor = subscriptions.some(s => 
    s.plan.planType === PlanType.MENTOR_WEEKLY_JOURNAL
  );

  // Determine mode and theme
  const mode: 'signals' | 'learning' | 'both' = 
    hasAdvisor && hasMentor ? 'both' :
    hasAdvisor ? 'signals' :
    hasMentor ? 'learning' : 'signals';

  // Build nav items based on subscription type
  const bottomNavItems: NavItem[] = useMemo(() => {
    if (hasAdvisor && !hasMentor) {
      // Signals only: 戰情室, 訊號, 持倉, 績效, 帳號
      return [
        { href: '/app/dashboard/signals', icon: Home, label: '戰情室', group: '/app/dashboard/signals' },
        { href: '/app/signals', icon: Radio, label: '訊號', group: '/app/signals', badgeKey: 'signals' },
        { href: '/app/holdings', icon: Briefcase, label: '持倉', group: '/app/holdings' },
        { href: '/app/performance', icon: BarChart3, label: '績效', group: '/app/performance' },
        { href: '/app/account', icon: User, label: '帳號', group: '/app/account' },
      ];
    }
    if (hasMentor && !hasAdvisor) {
      // Learning only: 學習中心, 週記, 課程, 知識庫, 帳號
      return [
        { href: '/app/dashboard/learning', icon: Home, label: '首頁', group: '/app/dashboard/learning' },
        { href: '/app/journals', icon: BookOpen, label: '週記', group: '/app/journals', badgeKey: 'journals' },
        { href: '/app/courses', icon: GraduationCap, label: '課程', group: '/app/courses' },
        { href: '/app/library', icon: Library, label: '知識庫', group: '/app/library' },
        { href: '/app/account', icon: User, label: '帳號', group: '/app/account' },
      ];
    }
    // Both or no subscriptions: 首頁, 訊號, 週記, 持倉, 帳號
    return [
      { href: '/app', icon: Home, label: '首頁', group: '/app' },
      { href: '/app/signals', icon: Radio, label: '訊號', group: '/app/signals', badgeKey: 'signals' },
      { href: '/app/journals', icon: BookOpen, label: '週記', group: '/app/journals', badgeKey: 'journals' },
      { href: '/app/holdings', icon: Briefcase, label: '持倉', group: '/app/holdings' },
      { href: '/app/account', icon: User, label: '帳號', group: '/app/account' },
    ];
  }, [hasAdvisor, hasMentor]);

  const breadcrumbs = useMemo(() => 
    getBreadcrumbConfig(location.pathname, mode),
    [location.pathname, mode]
  );

  const currentNavGroup = useMemo(() => getNavGroup(location.pathname), [location.pathname]);
  const isNotHome = location.pathname !== '/app';
  const showBreadcrumbs = breadcrumbs.length > 1;

  // Calculate unread counts
  useEffect(() => {
    if (!user) return;
    
    // Signals
    const signalsLastSeenStr = localStorage.getItem(SIGNALS_LAST_SEEN_KEY);
    const signalsLastSeen = signalsLastSeenStr ? parseInt(signalsLastSeenStr, 10) : 0;
    const allSignals = getSignalsForUser(user.id);
    const advisorSignals = allSignals.filter(s => 
      s.system && 
      (s.planType === PlanType.ANALYST_SIGNAL_L1 || s.planType === PlanType.ANALYST_SIGNAL_DIAG_L2)
    );
    const unreadS = advisorSignals.filter(s => s.timeTrade.getTime() > signalsLastSeen).length;
    setUnreadSignals(unreadS);

    // Journals
    const journalsLastSeenStr = localStorage.getItem(JOURNALS_LAST_SEEN_KEY);
    const journalsLastSeen = journalsLastSeenStr ? parseInt(journalsLastSeenStr, 10) : 0;
    const journals = getJournalsForUser(user.id);
    const unreadJ = journals.filter(j => j.weekEnd.getTime() > journalsLastSeen).length;
    setUnreadJournals(unreadJ);
  }, [user, location.pathname]);

  useEffect(() => {
    if (!isLoading && !user) {
      navigate('/auth/login', { replace: true });
    }
  }, [user, isLoading, navigate]);

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

  const handleBack = () => {
    if (breadcrumbs.length >= 2) {
      navigate(breadcrumbs[breadcrumbs.length - 2].path);
    } else {
      navigate('/app');
    }
  };

  const isActive = (group: string) => currentNavGroup === group;

  const getUnreadCount = (badgeKey?: 'signals' | 'journals') => {
    if (badgeKey === 'signals') return unreadSignals;
    if (badgeKey === 'journals') return unreadJournals;
    return 0;
  };

  // Theme classes
  const themeClass = mode === 'learning' ? 'learning-theme' : mode === 'signals' ? 'signals-theme' : '';
  const accentColor = mode === 'learning' ? 'learning-accent' : mode === 'signals' ? 'signals-accent' : 'primary';
  const headerBg = mode === 'learning' 
    ? 'bg-gradient-to-r from-learning-header via-learning-header to-learning-accent/5 border-learning-border'
    : mode === 'signals'
    ? 'bg-gradient-to-r from-signals-header via-signals-header to-signals-accent/5 border-signals-border'
    : 'bg-background/95 border-border';
  const navBg = mode === 'learning'
    ? 'bg-gradient-to-t from-learning-nav via-learning-nav to-learning-nav/95 border-learning-border'
    : mode === 'signals'
    ? 'bg-gradient-to-t from-signals-nav via-signals-nav to-signals-nav/95 border-signals-border'
    : 'bg-background/95 border-border';

  const headerTitle = mode === 'learning' ? '修煉學習系統' : mode === 'signals' ? '跟單戰情室' : '智富股市實戰學院';
  const headerSubtitle = mode === 'learning' ? 'LEARNING MODE' : mode === 'signals' ? 'SIGNALS MODE' : '';
  const HeaderIcon = mode === 'learning' ? Compass : TrendingUp;

  return (
    <div className={cn("min-h-screen bg-background flex flex-col", themeClass)}>
      {/* Top Header */}
      <header className={cn(
        "sticky top-0 z-50 border-b backdrop-blur supports-[backdrop-filter]:bg-background/80",
        headerBg
      )}>
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            {/* Back Button */}
            {isNotHome && (
              <button
                onClick={handleBack}
                className="p-2 -ml-2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="返回"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            <Link to="/app" className="flex items-center gap-2">
              <div className={cn(
                "flex h-9 w-9 items-center justify-center rounded-xl shadow-lg",
                mode === 'learning' 
                  ? "bg-gradient-to-br from-learning-accent to-learning-accent/80 shadow-[0_0_12px_-3px_hsl(var(--learning-accent)/0.5)]"
                  : mode === 'signals'
                  ? "bg-gradient-to-br from-signals-accent to-signals-accent/80 shadow-[0_0_12px_-3px_hsl(var(--signals-accent)/0.5)]"
                  : "gradient-hero"
              )}>
                <HeaderIcon className="h-4 w-4 text-white" />
              </div>
              <div className="flex flex-col">
                <span className="font-semibold text-foreground text-sm">{headerTitle}</span>
                {headerSubtitle && (
                  <span className={cn(
                    "text-[10px] font-medium tracking-wider",
                    mode === 'learning' ? 'text-learning-accent' : 'text-signals-accent'
                  )}>{headerSubtitle}</span>
                )}
              </div>
            </Link>
          </div>
          <div className="flex items-center gap-2">
            {mode === 'both' && (
              <Link 
                to="/app/mode-switch"
                className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg border border-foreground/10 hover:border-primary/50 hover:bg-primary/5 transition-all"
              >
                切換模式
              </Link>
            )}
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
          <div className={cn(
            "px-4 py-2 border-t",
            mode === 'learning' ? 'bg-learning-accent/5 border-learning-border/50' :
            mode === 'signals' ? 'bg-signals-accent/5 border-signals-border/50' :
            'bg-muted/30 border-border/50'
          )}>
            <nav className="flex items-center gap-1 text-sm overflow-x-auto">
              {breadcrumbs.map((crumb, index) => {
                const isLast = index === breadcrumbs.length - 1;
                return (
                  <div key={crumb.path} className="flex items-center gap-1 whitespace-nowrap">
                    {index > 0 && (
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    )}
                    {isLast ? (
                      <span className={cn(
                        "font-medium",
                        mode === 'learning' ? 'text-learning-accent' :
                        mode === 'signals' ? 'text-signals-accent' : 'text-primary'
                      )}>
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

      {/* Bottom Navigation */}
      <nav className={cn(
        "fixed bottom-0 left-0 right-0 z-50 border-t backdrop-blur supports-[backdrop-filter]:bg-background/80 safe-area-bottom",
        navBg
      )}>
        <div className="flex items-center justify-around h-16">
          {bottomNavItems.map((item) => {
            const active = isActive(item.group);
            const unreadCount = getUnreadCount(item.badgeKey);
            const showBadge = unreadCount > 0;
            
            return (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 px-3 py-2 min-w-[64px] mobile-touch-target transition-all",
                  active 
                    ? mode === 'learning' ? "text-learning-accent" :
                      mode === 'signals' ? "text-signals-accent" : "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <div className={cn(
                  "relative",
                  active && (
                    mode === 'learning' ? "drop-shadow-[0_0_8px_hsl(var(--learning-accent)/0.6)]" :
                    mode === 'signals' ? "drop-shadow-[0_0_8px_hsl(var(--signals-accent)/0.6)]" : ""
                  )
                )}>
                  <item.icon className={cn(
                    "h-5 w-5",
                    active && (
                      mode === 'learning' ? "text-learning-accent" :
                      mode === 'signals' ? "text-signals-accent" : "text-primary"
                    )
                  )} />
                  {showBadge && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 flex items-center justify-center text-[10px] font-bold text-white bg-destructive rounded-full">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </div>
                <span className={cn(
                  "text-[10px] font-medium",
                  active && (
                    mode === 'learning' ? "text-learning-accent" :
                    mode === 'signals' ? "text-signals-accent" : "text-primary"
                  )
                )}>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
