import { ReactNode, useMemo } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { PersonRole } from '@/types';
import { getPersonBySlug } from '@/data/mockData';
import { Badge } from '@/components/ui/badge';
import { Home, Radio, BarChart3, BookOpen, User, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LineLayoutProps {
  children: ReactNode;
}

// Breadcrumb configuration for different routes
const getBreadcrumbConfig = (pathname: string, basePath: string, isAdvisor: boolean) => {
  const pathSegments = pathname.replace(basePath, '').split('/').filter(Boolean);
  const crumbs: { label: string; path: string }[] = [];

  // Always start with 首頁
  crumbs.push({ label: '首頁', path: `${basePath}/home` });

  if (pathSegments.length === 0 || pathSegments[0] === 'home') {
    return crumbs; // Just home, no additional crumbs needed
  }

  const routeLabels: Record<string, string> = {
    signals: isAdvisor ? '即時訊號' : '週報',
    signal: '訊號詳情',
    performance: '績效',
    teaching: '教學',
    trades: '交易紀錄',
    xai: 'AI 解盤',
    diagnosis: '持股健檢',
    history: '歷史紀錄',
    account: '帳號',
  };

  // Add intermediate crumbs
  let currentPath = basePath;
  for (let i = 0; i < pathSegments.length; i++) {
    const segment = pathSegments[i];
    currentPath += `/${segment}`;
    
    // Skip ID segments (like signal/:signalId)
    if (i > 0 && pathSegments[i - 1] === 'signal') {
      // This is the signal ID, update previous label to include context
      continue;
    }

    const label = routeLabels[segment];
    if (label) {
      crumbs.push({ label, path: currentPath });
    }
  }

  return crumbs;
};

export function LineLayout({ children }: LineLayoutProps) {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const location = useLocation();
  const expert = expertSlug ? getPersonBySlug(expertSlug) : undefined;

  if (!expert) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center">
          <h1 className="text-xl font-bold mb-2">找不到此專家</h1>
          <Link to="/experts" className="text-primary underline">返回專家列表</Link>
        </div>
      </div>
    );
  }

  const isAdvisor = expert.role === PersonRole.ADVISOR;
  const basePath = `/line/${expertSlug}`;

  const navItems = [
    { path: `${basePath}/home`, icon: Home, label: '首頁' },
    { 
      path: `${basePath}/signals`, 
      icon: Radio, 
      label: isAdvisor ? '即時訊號' : '週報' 
    },
    { path: `${basePath}/performance`, icon: BarChart3, label: '績效' },
    { path: `${basePath}/teaching`, icon: BookOpen, label: '教學' },
    { path: `${basePath}/account`, icon: User, label: '帳號' },
  ];

  const isActive = (path: string) => {
    // Exact match for home
    if (path.endsWith('/home')) {
      return location.pathname === path;
    }
    // For signals, also match signal detail pages
    if (path.endsWith('/signals')) {
      return location.pathname === path || location.pathname.includes('/signal/');
    }
    // Default: exact match
    return location.pathname === path;
  };

  // Generate breadcrumbs based on current path
  const breadcrumbs = useMemo(() => 
    getBreadcrumbConfig(location.pathname, basePath, isAdvisor),
    [location.pathname, basePath, isAdvisor]
  );

  // Only show breadcrumbs if we're not on the home page
  const showBreadcrumbs = breadcrumbs.length > 1;

  return (
    <div className="min-h-screen bg-background flex flex-col pb-16">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-2">
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
                "flex flex-col items-center justify-center gap-1 flex-1 h-full mobile-touch-target",
                isActive(item.path)
                  ? isAdvisor ? "text-advisor" : "text-mentor"
                  : "text-muted-foreground"
              )}
            >
              <item.icon className="h-5 w-5" />
              <span className="text-xs">{item.label}</span>
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}