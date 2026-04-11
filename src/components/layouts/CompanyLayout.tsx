import { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  LayoutDashboard, Users, UserCheck, BarChart3, CreditCard,
  LogOut, Moon, Sun, Building2, Megaphone
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from 'next-themes';
import { NotificationBell } from '@/components/NotificationBell';

interface CompanyLayoutProps {
  children: ReactNode;
}

const navItems = [
  { path: '/company', icon: LayoutDashboard, label: '總覽', exact: true },
  { path: '/company/analysts', icon: Users, label: '分析師管理' },
  { path: '/company/subscribers', icon: UserCheck, label: '訂閱者管理' },
  { path: '/company/revenue', icon: BarChart3, label: '營收數據' },
  { path: '/company/payments', icon: CreditCard, label: '金流管理' },
  
  { path: '/company/announcements', icon: Megaphone, label: '系統公告' },
];

export function CompanyLayout({ children }: CompanyLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();

  const isActive = (path: string, exact?: boolean) => {
    if (exact) return location.pathname === path;
    return location.pathname.startsWith(path) && path !== '/company';
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className="w-64 border-r bg-card flex flex-col shrink-0 sticky top-0 h-screen">
        {/* Header */}
        <div className="p-4 border-b">
          <div className="flex items-center gap-3 mb-1">
            <div className="h-10 w-10 rounded-lg bg-company/10 flex items-center justify-center">
              <Building2 className="h-5 w-5 text-company" />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold truncate">海洋福星</h2>
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
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  active
                    ? "bg-company/10 text-company"
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
        <div className="p-3 border-t space-y-1">
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
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
