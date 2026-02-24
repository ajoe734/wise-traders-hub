import { useParams, Link } from 'react-router-dom';
import { LineLayout } from '@/components/layouts/LineLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getPersonBySlug, getUserSubscriptions } from '@/data/mockData';
import { useAuth } from '@/contexts/AuthContext';
import { PersonRole, SubscriptionStatus } from '@/types';
import { User, Calendar, ExternalLink, Settings, LogOut, Moon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ThemeToggle } from '@/components/ThemeToggle';

const LineAccount = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const { user, logout } = useAuth();
  const expert = expertSlug ? getPersonBySlug(expertSlug) : undefined;

  const isAdvisor = expert?.role === PersonRole.ADVISOR;

  // Get subscription for this expert
  const subscriptions = user ? getUserSubscriptions(user.id) : [];
  const expertSub = subscriptions.find(s => s.person.slug === expertSlug);

  return (
    <LineLayout>
      {expert && (
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="mb-4">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <User className="h-5 w-5" />
            帳號設定
          </h1>
        </div>

        {/* User Info */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">會員資訊</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">姓名</span>
              <span className="font-medium">{user?.displayName || '未設定'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Email</span>
              <span className="font-medium text-sm">{user?.email}</span>
            </div>
          </CardContent>
        </Card>

        {/* Subscription Status */}
        <Card className={cn(
          "border-2",
          isAdvisor ? "border-advisor/30" : "border-mentor/30"
        )}>
          <div className={cn(
            "h-1",
            isAdvisor ? "gradient-advisor" : "gradient-mentor"
          )} />
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              訂閱狀態
            </CardTitle>
          </CardHeader>
          <CardContent>
            {expertSub ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">專家</span>
                  <span className="font-medium">{expert.name}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">方案</span>
                  <Badge variant={isAdvisor ? 'advisor' : 'mentor'}>
                    {expertSub.plan.name}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">狀態</span>
                  <Badge variant={expertSub.status === SubscriptionStatus.ACTIVE ? 'secondary' : 'outline'}>
                    {expertSub.status === SubscriptionStatus.ACTIVE ? '有效' : '已到期'}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">到期日</span>
                  <span className="font-medium">{format(expertSub.endDate, 'yyyy/MM/dd')}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">續訂方式</span>
                  <span className="font-medium">
                    {expertSub.renewMode === 'AUTO' ? '自動續訂' : '手動續訂'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-muted-foreground mb-3">尚未訂閱此專家</p>
                <Button variant={isAdvisor ? 'advisor' : 'mentor'} size="sm" asChild>
                  <Link to={`/expert/${expertSlug}#plans`}>查看方案</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Links */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Settings className="h-4 w-4" />
              快速連結
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button variant="outline" className="w-full justify-between" asChild>
              <Link to="/app/account">
                <span>管理所有訂閱</span>
                <ExternalLink className="h-4 w-4" />
              </Link>
            </Button>
            <Button variant="outline" className="w-full justify-between" asChild>
              <Link to="/account/profile">
                <span>編輯個人資料</span>
                <ExternalLink className="h-4 w-4" />
              </Link>
            </Button>
            <Button variant="outline" className="w-full justify-between" asChild>
              <Link to={`/expert/${expertSlug}`}>
                <span>查看專家介紹頁</span>
                <ExternalLink className="h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* Theme Settings */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Moon className="h-4 w-4" />
              外觀設定
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">主題模式</span>
              <ThemeToggle />
            </div>
          </CardContent>
        </Card>

        {/* LINE Status */}
        <Card className="bg-muted/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">LINE 綁定</p>
                <p className="text-xs text-muted-foreground">尚未綁定</p>
              </div>
              <Button variant="outline" size="sm" disabled>
                綁定（即將開放）
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Logout */}
        <Button 
          variant="outline" 
          className="w-full text-destructive hover:text-destructive"
          onClick={logout}
        >
          <LogOut className="h-4 w-4 mr-2" />
          登出
        </Button>

        {/* Support */}
        <div className="text-center">
          <p className="text-xs text-muted-foreground">
            如有問題請聯繫客服
          </p>
        </div>
      </div>
      )}
    </LineLayout>
  );
};

export default LineAccount;