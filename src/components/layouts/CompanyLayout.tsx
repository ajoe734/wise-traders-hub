import { ReactNode, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, UserCheck, BarChart3, CreditCard,
  LogOut, Moon, Sun, Building2, Megaphone, FileClock, Receipt, Settings, Layers, Activity, Brain, Gauge, AlertTriangle, ScrollText, History, Shield, Menu
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from 'next-themes';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';

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

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation();
  const isActive = (path: string, exact?: boolean) => {
    if (exact) return location.pathname === path;
    return location.pathname.startsWith(path) && path !== '/company';
  };
  return (
    <nav className="flex-1 space-y-1 overflow-y-auto pr-1">
      {navItems.map((item) => {
        const active = isActive(item.path, item.exact);
        return (
          <Link
            key={item.path}
            to={item.path}
            onClick={onNavigate}
            className={cn(
              'group flex items-center gap-3 px-4 py-2.5 rounded-full text-[13px] transition-all',
              active
                ? 'bg-foreground text-background font-medium'
                : 'text-foreground/75 hover:text-foreground hover:bg-foreground/5',
            )}
          >
            <item.icon
              className={cn(
                'h-[18px] w-[18px] shrink-0 stroke-[1.6]',
                active ? 'text-background' : 'text-foreground/65',
              )}
            />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const navigate = useNavigate();
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-3 mb-6 mt-1">
        <div className="h-9 w-9 rounded-full bg-foreground flex items-center justify-center">
          <Building2 className="h-4 w-4 text-background" />
        </div>
        <div className="min-w-0">
          <h2 className="text-[15px] font-medium tracking-tight truncate text-foreground">海洋福星</h2>
          <p className="text-[11px] text-foreground/55 truncate">{user?.email}</p>
        </div>
      </div>
      <NavList onNavigate={onNavigate} />
      <div className="mt-3 space-y-1 pt-3 border-t border-foreground/10">
        <button
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          className="w-full flex items-center gap-3 px-4 py-2.5 rounded-full text-[13px] text-foreground/75 hover:text-foreground hover:bg-foreground/5 transition-colors"
        >
          {resolvedTheme === 'dark' ? <Sun className="h-[18px] w-[18px] stroke-[1.6]" /> : <Moon className="h-[18px] w-[18px] stroke-[1.6]" />}
          {resolvedTheme === 'dark' ? '淺色模式' : '深色模式'}
        </button>
        <button
          onClick={() => { onNavigate?.(); logout(); navigate('/auth/login'); }}
          className="w-full flex items-center gap-3 px-4 py-2.5 rounded-full text-[13px] text-foreground/75 hover:text-destructive hover:bg-foreground/5 transition-colors"
        >
          <LogOut className="h-[18px] w-[18px] stroke-[1.6]" />
          登出
        </button>
      </div>
    </div>
  );
}

export function CompanyLayout({ children }: CompanyLayoutProps) {
  const [open, setOpen] = useState(false);
  const { resolvedTheme } = useTheme();
  const bg = resolvedTheme === 'dark' ? 'hsl(var(--background))' : '#F5F3EF';

  return (
    <div className="min-h-screen md:flex" style={{ background: bg }}>
      {/* Mobile top bar */}
      <header
        className="md:hidden sticky top-0 z-30 flex items-center gap-2 px-3 h-12 border-b border-foreground/10"
        style={{ background: bg }}
      >
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button
              className="h-9 w-9 inline-flex items-center justify-center rounded-full hover:bg-foreground/5 text-foreground"
              aria-label="開啟選單"
            >
              <Menu className="h-5 w-5" />
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="p-4 w-[280px]" style={{ background: bg }}>
            <SidebarBody onNavigate={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-full bg-foreground flex items-center justify-center">
            <Building2 className="h-3.5 w-3.5 text-background" />
          </div>
          <span className="text-[14px] font-medium text-foreground">海洋福星後台</span>
        </div>
      </header>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 flex-col shrink-0 sticky top-0 h-screen px-4 py-5">
        <SidebarBody />
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto min-w-0">
        <div className="max-w-6xl mx-auto p-4 md:p-8 company-shell">
          {children}
        </div>
      </main>
    </div>
  );
}
