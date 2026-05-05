import { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  LayoutDashboard, Users, UserCheck, BarChart3, CreditCard,
  LogOut, Moon, Sun, Building2, Megaphone, FileClock, Receipt, Settings, Layers, Activity, Brain, Gauge, AlertTriangle, ScrollText, History, Shield
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from 'next-themes';


interface CompanyLayoutProps {
  children: ReactNode;
}

const navItems = [
  { path: '/company/users', icon: Shield, label: '帳號權限' },
  { path: '/company', icon: LayoutDashboard, label: '總覽', exact: true },
  { path: '/company/analysts', icon: Users, label: '分析師管理' },
  { path: '/company/plans', icon: Layers, label: '方案管理' },
  { path: '/company/subscribers', icon: UserCheck, label: '訂閱者管理' },
  { path: '/company/revenue', icon: BarChart3, label: '對帳中心' },
  { path: '/company/payments', icon: CreditCard, label: '金流工具' },
  { path: '/company/remittance', icon: Receipt, label: '匯款審核' },
  { path: '/company/payment-settings', icon: Settings, label: '分潤設定' },
  { path: '/company/audit-logs', icon: FileClock, label: '審計日誌' },
  { path: '/company/system-jobs', icon: Activity, label: '系統任務' },
  { path: '/company/function-logs', icon: ScrollText, label: '函式日誌' },
  { path: '/company/announcements', icon: Megaphone, label: '系統公告' },
  { path: '/company/knowledge-base', icon: Brain, label: '知識庫' },
  { path: '/company/checkup-usage', icon: Gauge, label: '健檢配額' },
  { path: '/company/missing-prices', icon: AlertTriangle, label: '缺價總覽' },
  { path: '/company/meta-overrides', icon: History, label: '持倉覆蓋' },
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
    <div className="min-h-screen flex" style={{ background: '#F5F3EF' }}>
      {/* Sidebar — Celoxis pill style */}
      <aside className="w-64 flex flex-col shrink-0 sticky top-0 h-screen px-4 py-5">
        {/* Brand */}
        <div className="flex items-center gap-3 px-3 mb-6">
          <div className="h-9 w-9 rounded-full bg-foreground/90 flex items-center justify-center">
            <Building2 className="h-4 w-4 text-background" />
          </div>
          <div className="min-w-0">
            <h2 className="text-[15px] font-medium tracking-tight truncate">海洋福星</h2>
            <p className="text-[11px] text-muted-foreground truncate">{user?.email}</p>
          </div>
        </div>

        {/* Navigation — pill rows */}
        <nav className="flex-1 space-y-1 overflow-y-auto pr-1">
          {navItems.map((item) => {
            const active = isActive(item.path, item.exact);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "group flex items-center gap-3 px-4 py-2.5 rounded-full text-[13px] transition-all",
                  active
                    ? "bg-card text-foreground font-medium shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
                    : "text-muted-foreground hover:text-foreground hover:bg-card/60"
                )}
              >
                <item.icon className={cn("h-[18px] w-[18px] shrink-0 stroke-[1.5]", active ? "text-foreground" : "text-muted-foreground/80")} />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="mt-3 space-y-1">
          <button
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-full text-[13px] text-muted-foreground hover:text-foreground hover:bg-card/60 transition-colors"
          >
            {resolvedTheme === 'dark' ? <Sun className="h-[18px] w-[18px] stroke-[1.5]" /> : <Moon className="h-[18px] w-[18px] stroke-[1.5]" />}
            {resolvedTheme === 'dark' ? '淺色模式' : '深色模式'}
          </button>
          <button
            onClick={() => { logout(); navigate('/auth/login'); }}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-full text-[13px] text-muted-foreground hover:text-destructive hover:bg-card/60 transition-colors"
          >
            <LogOut className="h-[18px] w-[18px] stroke-[1.5]" />
            登出
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto p-8 company-shell">
          {children}
        </div>
      </main>
    </div>
  );
}
