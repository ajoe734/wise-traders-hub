import { ReactNode, useState } from 'react';
import { Link, useLocation, useParams, useNavigate } from 'react-router-dom';
import { PersonRole } from '@/types';
import { getPersonBySlug } from '@/data/mockData';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  LayoutDashboard, Radio, Users, UserCog, BarChart3,
  ChevronLeft, LogOut, Moon, Sun, Building2, Menu
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from 'next-themes';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';

interface AdminLayoutProps {
  children: ReactNode;
}

export function AdminLayout({ children }: AdminLayoutProps) {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, hasRole } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const expert = expertSlug ? getPersonBySlug(expertSlug) : undefined;
  const isMobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);

  if (!expert) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center">
          <h1 className="text-xl font-bold mb-2">找不到此專家</h1>
          <p className="text-muted-foreground mb-4">請確認連結是否正確</p>
          <Button variant="ghost" onClick={() => navigate('/')}>返回首頁</Button>
        </div>
      </div>
    );
  }

  const isAdvisor = expert.role === PersonRole.ADVISOR;
  const basePath = `/admin/${expertSlug}`;

  const navItems = [
    { path: basePath, icon: LayoutDashboard, label: '總覽', exact: true },
    { path: `${basePath}/signals`, icon: Radio, label: '訊號管理' },
    { path: `${basePath}/subscribers`, icon: Users, label: '訂閱者' },
    { path: `${basePath}/profile`, icon: UserCog, label: '個人檔案' },
    { path: `${basePath}/performance`, icon: BarChart3, label: '績效總覽' },
  ];

  const isActive = (path: string, exact?: boolean) => {
    if (exact) return location.pathname === path;
    return location.pathname.startsWith(path);
  };

  const sidebarContent = (
    <>
      {/* Expert Header */}
      <div className="p-4 border-b">
        <div className="flex items-center gap-3 mb-2">
          <img
            src={expert.avatarUrl || '/placeholder.svg'}
            alt={expert.name}
            className="h-10 w-10 rounded-full object-cover"
          />
          <div className="min-w-0">
            <h2 className="font-semibold truncate">{expert.name}</h2>
            <Badge variant={isAdvisor ? 'advisor' : 'mentor'} className="text-[10px] px-1.5 py-0">
              {isAdvisor ? '投顧分析師' : '實戰導師'}
            </Badge>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">分析師後台管理</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => {
          const active = isActive(item.path, item.exact);
          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={() => setSheetOpen(false)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                active
                  ? isAdvisor
                    ? "bg-advisor/10 text-advisor"
                    : "bg-mentor/10 text-mentor"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t space-y-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
        >
          {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {resolvedTheme === 'dark' ? '淺色模式' : '深色模式'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={() => { setSheetOpen(false); navigate(`/line/${expertSlug}/home`); }}
        >
          <ChevronLeft className="h-4 w-4" />
          前往前台
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-destructive hover:text-destructive"
          onClick={() => logout()}
        >
          <LogOut className="h-4 w-4" />
          登出
        </Button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-background flex">
      {/* Desktop Sidebar */}
      {!isMobile && (
        <aside className="w-64 border-r bg-card flex flex-col shrink-0 sticky top-0 h-screen">
          {sidebarContent}
        </aside>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-auto">
        {/* Mobile Header */}
        {isMobile && (
          <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60 px-4 h-14 flex items-center gap-3">
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="shrink-0">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0 flex flex-col">
                {sidebarContent}
              </SheetContent>
            </Sheet>
            <div className="flex items-center gap-2 min-w-0">
              <img src={expert.avatarUrl || '/placeholder.svg'} alt={expert.name} className="h-7 w-7 rounded-full object-cover" />
              <span className="font-semibold text-sm truncate">{expert.name}</span>
            </div>
          </header>
        )}

        <main className="flex-1">
          <div className="max-w-5xl mx-auto p-4 md:p-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
