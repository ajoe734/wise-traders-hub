import { ReactNode } from 'react';
import { Link, useLocation, useParams, useNavigate } from 'react-router-dom';
import { useExpert } from '@/hooks/useExpert';
import { ExpertRole } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  LayoutDashboard, Radio, Users, UserCog, BarChart3,
  LogOut, Moon, Sun, Building2, FileText, Loader2, Megaphone, Wallet, Eye, Sparkles
} from 'lucide-react';
import { NotificationBell } from '@/components/NotificationBell';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from 'next-themes';
import { avatarUrl } from '@/lib/imageTransform';


interface AdminLayoutProps {
  children: ReactNode;
}

export function AdminLayout({ children }: AdminLayoutProps) {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, hasRole } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  // 後台需要能看到 draft / suspended 的專家（否則新建或停用中的分析師無法進後台啟用）
  const { data: expert, isLoading } = useExpert(expertSlug, { includeAllStatuses: true });

  // Ownership check: user must be company_admin OR the expert's owner (matching expert_slug)
  const isCompanyAdmin = hasRole('company_admin');
  const isOwner = !!user?.expertSlug && user.expertSlug === expertSlug;
  const hasAccess = isCompanyAdmin || isOwner;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

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

  if (!hasAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center">
          <h1 className="text-xl font-bold mb-2">權限不足</h1>
          <p className="text-muted-foreground mb-4">您沒有存取此後台的權限</p>
          <Button variant="ghost" onClick={() => navigate('/')}>返回首頁</Button>
        </div>
      </div>
    );
  }

  const isAdvisor = expert.role === 'advisor';
  const basePath = `/admin/${expertSlug}`;

  const navItems = [
    { path: basePath, icon: LayoutDashboard, label: '總覽', exact: true },
    { path: `${basePath}/signals`, icon: Radio, label: isAdvisor ? '訊號管理' : '週記管理',
      hint: isAdvisor ? undefined : '週記於每週五 20:00 統一開放發布' },
    { path: `${basePath}/plans`, icon: Wallet, label: '訂閱方案' },
    { path: `${basePath}/subscribers`, icon: Users, label: '訂閱者' },
    { path: `${basePath}/signal-templates`, icon: FileText, label: '訊號模板' },
    { path: `${basePath}/performance`, icon: BarChart3, label: '績效總覽' },
    { path: `${basePath}/announcements`, icon: Megaphone, label: '系統公告' },
    { path: `${basePath}/ai-studio`, icon: Sparkles, label: 'AI 訓練台',
      hint: !isAdvisor ? '設定 AI 分身口吻、示範問答、補充知識' : undefined },
    { path: `${basePath}/profile`, icon: UserCog, label: '個人檔案' },
  ];

  const isActive = (path: string, exact?: boolean) => {
    if (exact) return location.pathname === path;
    return location.pathname.startsWith(path);
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside
        className="w-64 border-r bg-card flex flex-col shrink-0 sticky top-0 h-[100dvh] max-h-[100dvh] min-h-0 overflow-hidden"
        aria-label="分析師後台側邊欄"
      >
        {/* Expert Header */}
        <div className="shrink-0 p-4 border-b">
          <div className="flex items-center gap-3 mb-2">
            <img
              src={avatarUrl(expert.avatarUrl, 80)}
              alt={expert.name}
              loading="lazy"
              decoding="async"
              className="shrink-0 h-10 w-10 rounded-full object-cover object-[center_15%]"
            />
            <div className="min-w-0">
              <h2 className="font-semibold truncate">{expert.name}</h2>
              <Badge variant={isAdvisor ? 'advisor' : 'mentor'} className="text-[10px] px-1.5 py-0">
                {isAdvisor ? '投顧分析師' : '實戰導師'}
              </Badge>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">分析師後台管理</p>
            <NotificationBell />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full mt-3 gap-2 h-8 text-xs"
            onClick={() => {
              try { sessionStorage.setItem('previewExpertSlug', expertSlug!); } catch {}
              window.open(`/app/expert/${expertSlug}`, '_blank');
            }}
          >
            <Eye className="h-3.5 w-3.5" />
            訂閱者預覽
          </Button>
        </div>

        {/* Navigation */}
        <nav
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 space-y-1"
          aria-label="分析師後台導覽"
        >
          {navItems.map((item) => {
            const active = isActive(item.path, item.exact);
            const hint = (item as any).hint as string | undefined;
            return (
              <div key={item.path}>
                <Link
                  to={item.path}
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
                {hint && (
                  <p className="text-[10px] text-muted-foreground/70 pl-10 pr-3 -mt-0.5 mb-1 leading-tight">
                    {hint}
                  </p>
                )}
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="shrink-0 p-3 border-t space-y-1">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-muted-foreground"
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          >
            {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {resolvedTheme === 'dark' ? '淺色模式' : '深色模式'}
          </Button>
          {hasRole('company_admin') && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-muted-foreground"
              onClick={() => navigate('/company')}
            >
              <Building2 className="h-4 w-4" />
              返回管理後台
            </Button>
          )}
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
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
