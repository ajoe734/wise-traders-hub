import { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  LayoutDashboard, Users, UserCheck, BarChart3, ShieldCheck, CreditCard,
  LogOut, Moon, Sun, Building2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from 'next-themes';

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

  const isActive = (path: string, exact?: boolean) => {
    if (exact) return location.pathname === path;
    return location.pathname.startsWith(path) && path !== '/company';
  };

  return (
    <div className="min-h-screen bg-background flex pb-16">
      {/* Sidebar */}
      <aside className="w-64 border-r bg-card flex flex-col shrink-0 sticky top-0 h-screen">
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
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto p-6">
          {children}
        </div>
      </main>

      {/* Bottom Tab Bar */}
      <nav className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-t z-50 safe-area-bottom">
        <div className="flex items-center justify-around h-16">
          <button
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            className={cn(
              "flex flex-col items-center justify-center gap-1 px-3 py-2 min-w-[64px] mobile-touch-target relative",
              "transition-all duration-150 ease-out",
              "active:scale-95",
              "text-muted-foreground hover:text-foreground"
            )}
          >
            <div className="relative transition-transform duration-150 active:scale-90">
              {resolvedTheme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </div>
            <span className="text-xs">{resolvedTheme === 'dark' ? '淺色模式' : '深色模式'}</span>
          </button>

          <button
            onClick={() => { logout(); navigate('/auth/login'); }}
            className={cn(
              "flex flex-col items-center justify-center gap-1 px-3 py-2 min-w-[64px] mobile-touch-target relative",
              "transition-all duration-150 ease-out",
              "active:scale-95",
              "text-destructive hover:text-destructive"
            )}
          >
            <div className="relative transition-transform duration-150 active:scale-90">
              <LogOut className="h-5 w-5" />
            </div>
            <span className="text-xs">登出</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
