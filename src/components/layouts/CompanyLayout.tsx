import { ReactNode, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  LayoutDashboard, Users, UserCheck, BarChart3, ShieldCheck, CreditCard,
  LogOut, Moon, Sun, Building2, Menu
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from 'next-themes';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';

interface CompanyLayoutProps {
  children: ReactNode;
}

const navItems = [
  { path: '/company', icon: LayoutDashboard, label: '總覽', exact: true },
  { path: '/company/analysts', icon: Users, label: '分析師管理' },
  { path: '/company/subscribers', icon: UserCheck, label: '訂閱者管理' },
  { path: '/company/revenue', icon: BarChart3, label: '營收數據' },
  { path: '/company/payments', icon: CreditCard, label: '金流管理' },
  { path: '/company/review', icon: ShieldCheck, label: '內容監管' },
];

export function CompanyLayout({ children }: CompanyLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const isMobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);

  const isActive = (path: string, exact?: boolean) => {
    if (exact) return location.pathname === path;
    return location.pathname.startsWith(path) && path !== '/company';
  };

  const sidebarContent = (
    <>
      {/* Header */}
      <div className="p-4 border-b">
        <div className="flex items-center gap-3 mb-1">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold truncate">公司管理後台</h2>
            <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
          </div>
        </div>
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
                  ? "bg-primary/10 text-primary"
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
          className="w-full justify-start gap-2 text-destructive hover:text-destructive"
          onClick={() => { logout(); navigate('/auth/login'); }}
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
              <Building2 className="h-5 w-5 text-primary shrink-0" />
              <span className="font-semibold text-sm truncate">公司管理後台</span>
            </div>
          </header>
        )}

        <main className="flex-1">
          <div className="max-w-6xl mx-auto p-4 md:p-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
