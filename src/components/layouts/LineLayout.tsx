import { ReactNode, useMemo, useEffect, useState } from 'react';
import { Link, useLocation, useParams, useNavigate } from 'react-router-dom';
import { PersonRole } from '@/types';
import { getPersonBySlug, getSignalsForUser, getJournalsForUser } from '@/data/mockData';
import { Badge } from '@/components/ui/badge';
import { Home, Radio, BarChart3, BookOpen, User, ChevronRight, ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';

interface LineLayoutProps {
  children: ReactNode;
}

// Route groupings for bottom nav highlighting
const getNavGroup = (pathname: string, basePath: string): string | null => {
  const relativePath = pathname.replace(basePath, '');
  
  if (relativePath === '' || relativePath === '/' || relativePath === '/home') {
    return 'home';
  }
  if (relativePath === '/signals' || relativePath.startsWith('/signal/')) {
    return 'signals';
  }
  if (relativePath === '/performance' || relativePath === '/trades' || relativePath === '/history' || relativePath === '/diagnosis') {
    return 'performance';
  }
  if (relativePath === '/teaching' || relativePath.startsWith('/xai')) {
    return 'teaching';
  }
  if (relativePath === '/account') {
    return 'account';
  }
  return null;
};

// Breadcrumb configuration for different routes
const getBreadcrumbConfig = (pathname: string, basePath: string, isAdvisor: boolean) => {
  const relativePath = pathname.replace(basePath, '');
  const crumbs: { label: string; path: string }[] = [];

  // Always start with 首頁
  crumbs.push({ label: '首頁', path: `${basePath}/home` });

  if (relativePath === '' || relativePath === '/' || relativePath === '/home') {
    return crumbs;
  }

  // Signal detail: 首頁 → 即時訊號/週報 → 訊號詳情
  if (relativePath.startsWith('/signal/')) {
    crumbs.push({ 
      label: isAdvisor ? '即時訊號' : '週報', 
      path: `${basePath}/signals` 
    });
    crumbs.push({ label: '訊號詳情', path: pathname });
    return crumbs;
  }

  // Signals list
  if (relativePath === '/signals') {
    crumbs.push({ label: isAdvisor ? '即時訊號' : '週報', path: pathname });
    return crumbs;
  }

  // Performance related pages
  if (relativePath === '/performance') {
    crumbs.push({ label: '績效', path: pathname });
    return crumbs;
  }
  if (relativePath === '/trades') {
    crumbs.push({ label: '績效', path: `${basePath}/performance` });
    crumbs.push({ label: '交易紀錄', path: pathname });
    return crumbs;
  }
  if (relativePath === '/history') {
    crumbs.push({ label: '績效', path: `${basePath}/performance` });
    crumbs.push({ label: '歷史紀錄', path: pathname });
    return crumbs;
  }
  if (relativePath === '/diagnosis') {
    crumbs.push({ label: '績效', path: `${basePath}/performance` });
    crumbs.push({ label: '持股健檢', path: pathname });
    return crumbs;
  }

  // Teaching related pages
  if (relativePath === '/teaching') {
    crumbs.push({ label: '教學', path: pathname });
    return crumbs;
  }
  if (relativePath.startsWith('/xai')) {
    crumbs.push({ label: '教學', path: `${basePath}/teaching` });
    crumbs.push({ label: 'AI 解盤', path: pathname });
    return crumbs;
  }

  // Account
  if (relativePath === '/account') {
    crumbs.push({ label: '帳號', path: pathname });
    return crumbs;
  }

  return crumbs;
};

// Get localStorage key for last seen timestamp
const getLastSeenKey = (userId: string, expertSlug: string, type: 'signals' | 'journals') => {
  return `line:lastSeen:${userId}:${expertSlug}:${type}`;
};

export function LineLayout({ children }: LineLayoutProps) {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const expert = expertSlug ? getPersonBySlug(expertSlug) : undefined;
  const [unreadCount, setUnreadCount] = useState(0);

  const isAdvisor = expert?.role === PersonRole.ADVISOR;
  const basePath = `/line/${expertSlug}`;

  // Calculate unread count for signals/journals
  useEffect(() => {
    if (!user || !expert || !expertSlug) {
      setUnreadCount(0);
      return;
    }

    const type = isAdvisor ? 'signals' : 'journals';
    const lastSeenKey = getLastSeenKey(user.id, expertSlug, type);
    const lastSeenStr = localStorage.getItem(lastSeenKey);
    const lastSeen = lastSeenStr ? new Date(lastSeenStr).getTime() : 0;

    if (isAdvisor) {
      const signals = getSignalsForUser(user.id);
      const expertSignals = signals.filter(s => s.person.slug === expertSlug);
      const unread = expertSignals.filter(s => new Date(s.timeTrade).getTime() > lastSeen).length;
      setUnreadCount(unread);
    } else {
      const journals = getJournalsForUser(user.id);
      const expertJournals = journals.filter(j => j.person.slug === expertSlug);
      const unread = expertJournals.filter(j => new Date(j.weekEnd).getTime() > lastSeen).length;
      setUnreadCount(unread);
    }
  }, [user, expert, expertSlug, isAdvisor, location.pathname]);

  if (!expert) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center">
          <h1 className="text-xl font-bold mb-2">找不到此專家</h1>
          <p className="text-muted-foreground">請確認連結是否正確</p>
        </div>
      </div>
    );
  }

  const navItems = [
    { path: `${basePath}/home`, icon: Home, label: '首頁', group: 'home' },
    { 
      path: `${basePath}/signals`, 
      icon: Radio, 
      label: isAdvisor ? '即時訊號' : '週報',
      group: 'signals',
      badge: unreadCount
    },
    { path: `${basePath}/performance`, icon: BarChart3, label: '績效', group: 'performance' },
    { path: `${basePath}/teaching`, icon: BookOpen, label: '教學', group: 'teaching' },
    { path: `${basePath}/account`, icon: User, label: '帳號', group: 'account' },
  ];

  const currentGroup = getNavGroup(location.pathname, basePath);
  const isActive = (group: string) => currentGroup === group;

  // Generate breadcrumbs based on current path
  const breadcrumbs = useMemo(() => 
    getBreadcrumbConfig(location.pathname, basePath, isAdvisor),
    [location.pathname, basePath, isAdvisor]
  );

  // Only show breadcrumbs if we're not on the home page
  const showBreadcrumbs = breadcrumbs.length > 1;

  // Determine back navigation target
  const getBackPath = () => {
    if (breadcrumbs.length >= 2) {
      return breadcrumbs[breadcrumbs.length - 2].path;
    }
    return `${basePath}/home`;
  };

  const isHomePage = location.pathname === `${basePath}/home` || location.pathname === basePath;

  return (
    <div className="min-h-screen bg-background flex flex-col pb-16">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-2">
            {/* Back button - only show when not on home */}
            {!isHomePage && (
              <button
                onClick={() => navigate(getBackPath())}
                className={cn(
                  "flex items-center justify-center w-8 h-8 -ml-2 rounded-full transition-colors",
                  "hover:bg-muted active:bg-muted/80",
                  isAdvisor ? "text-advisor" : "text-mentor"
                )}
                aria-label="返回"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            <img
              src={expert.avatarUrl || '/placeholder.svg'}
              alt={expert.name}
              className="h-8 w-8 rounded-full object-cover"
            />
            <span className="font-semibold">{expert.name}</span>
            <Badge variant={isAdvisor ? 'advisor' : 'mentor'} className="text-[10px] px-1.5 py-0">
              {isAdvisor ? '投顧分析師' : '實戰導師'}
            </Badge>
          </div>
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
                      <span className={cn(
                        "font-medium",
                        isAdvisor ? "text-advisor" : "text-mentor"
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
      <main className="flex-1 overflow-auto">
        {children}
      </main>

      {/* Bottom Tab Bar */}
      <nav className="fixed bottom-0 left-0 right-0 bg-background border-t z-50">
        <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex flex-col items-center justify-center gap-1 flex-1 h-full mobile-touch-target relative",
                isActive(item.group)
                  ? isAdvisor ? "text-advisor" : "text-mentor"
                  : "text-muted-foreground"
              )}
            >
              <div className="relative">
                <item.icon className="h-5 w-5" />
                {/* Unread badge */}
                {item.badge > 0 && (
                  <span className={cn(
                    "absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 flex items-center justify-center",
                    "text-[10px] font-bold rounded-full",
                    "bg-destructive text-destructive-foreground"
                  )}>
                    {item.badge > 9 ? '9+' : item.badge}
                  </span>
                )}
              </div>
              <span className="text-xs">{item.label}</span>
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}

// Export helper for marking signals as read
export const markSignalsAsRead = (userId: string, expertSlug: string, isAdvisor: boolean) => {
  const type = isAdvisor ? 'signals' : 'journals';
  const key = getLastSeenKey(userId, expertSlug, type);
  localStorage.setItem(key, new Date().toISOString());
};
