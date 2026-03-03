import { ReactNode, useMemo, useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from 'next-themes';
import { getUserSubscriptions, getJournalsForUser } from '@/data/mockData';
import { supabase } from '@/integrations/supabase/client';
import { PlanType } from '@/types';
import { 
  Home, Radio, BookOpen, User, LogOut, ChevronRight, ChevronLeft,
  Target, Compass, Moon, Sun
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
  if (pathname === '/app/signals' || pathname.startsWith('/app/signal/')) return '/app/signals';
  if (pathname === '/app/journals' || pathname.startsWith('/app/journal/')) return '/app/journals';
  if (pathname === '/app/performance' || pathname.startsWith('/app/performance')) return '/app/performance';
  if (pathname === '/app/courses' || pathname.startsWith('/app/course/')) return '/app/courses';
  if (pathname === '/app/library' || pathname.startsWith('/app/library')) return '/app/library';
  if (pathname === '/app/account' || pathname.startsWith('/app/account')) return '/app/account';
  if (pathname === '/app/explore') return '/app/explore';
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

// Theme toggle button component
function ThemeToggleButton() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return <div className="w-9 h-9" />;

  return (
    <button
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      className={cn(
        "p-2 rounded-lg transition-colors",
        resolvedTheme === 'dark' 
          ? "text-amber-400 hover:bg-amber-500/10"
          : "text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10"
      )}
      aria-label={resolvedTheme === 'dark' ? '切換至淺色模式' : '切換至深色模式'}
    >
      {resolvedTheme === 'dark' ? (
        <Sun className="h-5 w-5" />
      ) : (
        <Moon className="h-5 w-5" />
      )}
    </button>
  );
}

export function UnifiedAppLayout({ children }: UnifiedAppLayoutProps) {
  const { user, supabaseUser, isLoading, logout } = useAuth();
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

  // Build nav items based on subscription type - unified navigation for all users
  const bottomNavItems: NavItem[] = useMemo(() => {
    // All users get the same unified navigation: 戰情室, 訊號, 週記, 探索, 帳號
    return [
      { href: '/app', icon: Home, label: '戰情室', group: '/app' },
      { href: '/app/signals', icon: Radio, label: '訊號', group: '/app/signals', badgeKey: 'signals' },
      { href: '/app/journals', icon: BookOpen, label: '週記', group: '/app/journals', badgeKey: 'journals' },
      { href: '/app/explore', icon: Compass, label: '探索名師', group: '/app/explore' },
      { href: '/app/account', icon: User, label: '帳號', group: '/app/account' },
    ];
  }, []);

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

    const loadUnreadCounts = async () => {
      // Signals: only count from subscribed experts
      const signalsLastSeenStr = localStorage.getItem(SIGNALS_LAST_SEEN_KEY);
      const signalsLastSeen = signalsLastSeenStr ? parseInt(signalsLastSeenStr, 10) : 0;
      const sinceIso = signalsLastSeen > 0 ? new Date(signalsLastSeen).toISOString() : '1970-01-01T00:00:00.000Z';

      // Get subscribed expert IDs first
      const { data: activeSubs } = await supabase
        .from('member_subscriptions')
        .select('plan_id, expert_plans(expert_id)')
        .eq('user_id', user.id)
        .eq('status', 'active');

      const expertIds = (activeSubs || [])
        .map((s: any) => s.expert_plans?.expert_id)
        .filter(Boolean);

      if (expertIds.length > 0) {
        const { count: unreadSignalsCount } = await supabase
          .from('expert_signals')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'published')
          .in('expert_id', expertIds)
          .gt('published_at', sinceIso);

        setUnreadSignals(unreadSignalsCount ?? 0);
      } else {
        setUnreadSignals(0);
      }

      // Journals
      const journalsLastSeenStr = localStorage.getItem(JOURNALS_LAST_SEEN_KEY);
      const journalsLastSeen = journalsLastSeenStr ? parseInt(journalsLastSeenStr, 10) : 0;
      const journals = getJournalsForUser(user.id);
      const unreadJ = journals.filter(j => j.weekEnd.getTime() > journalsLastSeen).length;
      setUnreadJournals(unreadJ);
    };

    loadUnreadCounts();
  }, [user, location.pathname]);

  useEffect(() => {
    if (!isLoading && !user && !supabaseUser) {
      navigate('/auth/login', { replace: true });
    }
  }, [user, isLoading, supabaseUser, navigate]);

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

  // Unified theme - no mode switching
  const headerBg = 'bg-background/95 border-border';
  const navBg = 'bg-background/95 border-border';
  const headerTitle = '會員戰情室';
  const HeaderIcon = Target;

  return (
    <div className="min-h-screen bg-background flex flex-col">
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
              <div className="flex h-9 w-9 items-center justify-center rounded-xl shadow-lg gradient-hero">
                <HeaderIcon className="h-4 w-4 text-white" />
              </div>
              <span className="font-semibold text-foreground text-sm">{headerTitle}</span>
            </Link>
          </div>
          <div className="flex items-center gap-1">
            {/* Theme Toggle */}
            <ThemeToggleButton />
            
            {/* Logout Button */}
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
          <div className="px-4 py-2 border-t bg-muted/30 border-border/50">
            <nav className="flex items-center gap-1 text-sm overflow-x-auto">
              {breadcrumbs.map((crumb, index) => {
                const isLast = index === breadcrumbs.length - 1;
                return (
                  <div key={crumb.path} className="flex items-center gap-1 whitespace-nowrap">
                    {index > 0 && (
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    )}
                    {isLast ? (
                      <span className="font-medium text-primary">{crumb.label}</span>
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
