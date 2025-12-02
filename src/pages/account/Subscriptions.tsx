import { Link } from 'react-router-dom';
import { PortalLayout } from '@/components/layouts/PortalLayout';
import { useAuth } from '@/contexts/AuthContext';
import { getUserSubscriptions } from '@/data/mockData';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RoleBadge } from '@/components/RoleBadge';
import { PersonRole, SubscriptionStatus } from '@/types';
import { ExternalLink, Calendar, Radio } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

const AccountSubscriptions = () => {
  const { user, isAuthenticated } = useAuth();

  if (!isAuthenticated || !user) {
    return (
      <PortalLayout>
        <div className="container py-12 text-center">
          <h1 className="text-2xl font-bold mb-4">請先登入</h1>
          <Button asChild>
            <Link to="/auth/login">前往登入</Link>
          </Button>
        </div>
      </PortalLayout>
    );
  }

  const subscriptions = getUserSubscriptions(user.id);

  return (
    <PortalLayout>
      <div className="container py-8 md:py-12 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl font-bold mb-2">我的訂閱</h1>
          <p className="text-muted-foreground">
            管理你的所有訂閱服務
          </p>
        </div>

        {subscriptions.length > 0 ? (
          <div className="space-y-4">
            {subscriptions.map((sub) => {
              const isAdvisor = sub.person.role === PersonRole.ADVISOR;
              const isActive = sub.status === SubscriptionStatus.ACTIVE;
              
              return (
                <Card key={sub.id} className={cn(
                  "overflow-hidden",
                  !isActive && "opacity-60"
                )}>
                  <div className={cn(
                    "h-1",
                    isAdvisor ? "gradient-advisor" : "gradient-mentor"
                  )} />
                  <CardContent className="p-6">
                    <div className="flex flex-col md:flex-row md:items-center gap-4">
                      <img
                        src={sub.person.avatarUrl || '/placeholder.svg'}
                        alt={sub.person.name}
                        className="h-14 w-14 rounded-full object-cover"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h3 className="font-semibold">{sub.person.name}</h3>
                          <RoleBadge role={sub.person.role} size="sm" />
                          <Badge variant={isActive ? 'secondary' : 'outline'}>
                            {isActive ? '有效' : '已到期'}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{sub.plan.name}</p>
                        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {format(sub.startDate, 'yyyy/MM/dd')} - {format(sub.endDate, 'yyyy/MM/dd')}
                          </span>
                          {sub.renewMode && (
                            <span>
                              {sub.renewMode === 'AUTO' ? '自動續訂' : '手動續訂'}
                            </span>
                          )}
                        </div>
                      </div>
                      <Button 
                        variant={isAdvisor ? 'advisor' : 'mentor'}
                        size="sm"
                        asChild
                      >
                        <Link to={`/line/${sub.person.slug}/home`}>
                          進入會員頁面
                          <ExternalLink className="h-3 w-3 ml-1" />
                        </Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <Radio className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="font-semibold mb-2">尚無訂閱</h3>
              <p className="text-muted-foreground mb-4">
                探索投顧分析師或實戰導師，開始你的投資學習之旅
              </p>
              <Button asChild>
                <Link to="/experts">瀏覽專家</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Navigation */}
        <div className="mt-8 flex gap-4">
          <Button variant="outline" asChild>
            <Link to="/account/profile">編輯個人資料</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/experts">探索更多專家</Link>
          </Button>
        </div>
      </div>
    </PortalLayout>
  );
};

export default AccountSubscriptions;