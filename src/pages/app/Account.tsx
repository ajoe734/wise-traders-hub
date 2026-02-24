import { Link } from 'react-router-dom';
import { UnifiedAppLayout } from '@/components/layouts/UnifiedAppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { getUserSubscriptions } from '@/data/mockData';
import { SubscriptionStatus } from '@/types';
import { User, MessageCircle, Calendar, ExternalLink, Radio, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

const Account = () => {
  const { user } = useAuth();
  const subscriptions = user ? getUserSubscriptions(user.id) : [];

  return (
    <UnifiedAppLayout>
      <div className="p-4 space-y-6">
        <h1 className="text-xl font-bold">帳號設定</h1>

        {/* User Info Card */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="font-semibold">{user?.displayName || '會員'}</p>
                <p className="text-sm text-muted-foreground">{user?.email}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* My Subscriptions Section */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            我的訂閱
          </h2>
          
          {subscriptions.length > 0 ? (
            <div className="space-y-3">
              {subscriptions.map((sub) => {
                const isActive = sub.status === SubscriptionStatus.ACTIVE;
                
                return (
                  <Card 
                    key={sub.id} 
                    className={cn(
                      "overflow-hidden border-2",
                      isActive ? "border-green-500/50" : "border-border opacity-60"
                    )}
                  >
                    <div className="h-1 bg-gradient-to-r from-primary to-primary/50" />
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <img
                          src={sub.person.avatarUrl || '/placeholder.svg'}
                          alt={sub.person.name}
                          className="h-12 w-12 rounded-full object-cover"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <h3 className="font-semibold">{sub.person.name}</h3>
                            <Badge variant={isActive ? 'secondary' : 'outline'} className={cn(
                              isActive && "bg-green-500/20 text-green-400 border-green-500/30"
                            )}>
                              {isActive ? '有效' : '已到期'}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{sub.plan.name}</p>
                          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                            <span>
                              {format(sub.startDate, 'yyyy/MM/dd')} - {format(sub.endDate, 'yyyy/MM/dd')}
                            </span>
                            {sub.renewMode && (
                              <span className="text-primary/70">
                                {sub.renewMode === 'AUTO' ? '自動續訂' : '手動續訂'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card>
              <CardContent className="py-8 text-center">
                <Radio className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <h3 className="font-semibold mb-2">尚無訂閱</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  探索投顧分析師或實戰導師，開始你的投資學習之旅
                </p>
                <Button asChild>
                  <Link to="/pricing">瀏覽方案</Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Quick Links */}
        <Card>
          <CardContent className="p-4 space-y-2">
            <Link to="/account/profile" className="flex items-center justify-between p-2 rounded-lg hover:bg-muted transition-colors">
              <span className="text-sm flex items-center gap-2">
                <Settings className="h-4 w-4" /> 編輯個人資料
              </span>
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
            </Link>
            <Link to="/pricing" className="flex items-center justify-between p-2 rounded-lg hover:bg-muted transition-colors">
              <span className="text-sm flex items-center gap-2">
                <Radio className="h-4 w-4" /> 探索更多方案
              </span>
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
            </Link>
          </CardContent>
        </Card>

        {/* LINE Binding */}
        <Card>
          <CardContent className="p-4">
            <h2 className="font-semibold mb-3 flex items-center gap-2">
              <MessageCircle className="h-4 w-4" /> LINE 綁定
            </h2>
            <p className="text-sm text-muted-foreground mb-3">尚未綁定</p>
            <Button variant="outline" size="sm" disabled className="w-full">
              預留：綁定 LINE（尚未開放）
            </Button>
            <p className="text-xs text-muted-foreground mt-2">未來將提供 LINE 推播通知與快速登入</p>
          </CardContent>
        </Card>
      </div>
    </UnifiedAppLayout>
  );
};

export default Account;
