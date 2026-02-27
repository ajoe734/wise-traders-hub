import { useState, useEffect } from 'react';
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
import { LineBindingCard } from '@/components/LineBindingCard';
import { supabase } from '@/integrations/supabase/client';

const Account = () => {
  const { user } = useAuth();
  const subscriptions = user ? getUserSubscriptions(user.id) : [];
  const [subscribedExperts, setSubscribedExperts] = useState<{ id: string; slug: string; name: string; role: string; avatar_url: string | null; line_oa_id?: string | null }[]>([]);
  const [showAdvisors, setShowAdvisors] = useState(false);
  const [showMentors, setShowMentors] = useState(false);

  // Fetch experts the user is subscribed to (for LINE binding)
  useEffect(() => {
    if (!user) return;
    const fetchSubscribedExperts = async () => {
      const { data } = await supabase
        .rpc('has_active_subscription', { _user_id: user.id });
      if (!data || data.length === 0) return;

      const expertIds = [...new Set(data.map((d: any) => d.expert_id))];
      const { data: experts } = await supabase
        .from('experts')
        .select('id, slug, name, role, avatar_url')
        .in('id', expertIds);
      if (experts) {
        // Fetch line_oa_id for these experts
        const { data: channels } = await supabase
          .from('expert_line_channels')
          .select('expert_id, line_oa_id')
          .in('expert_id', expertIds);
        const channelMap = new Map((channels || []).map((c: any) => [c.expert_id, c.line_oa_id]));
        setSubscribedExperts(experts.map(e => ({ ...e, line_oa_id: channelMap.get(e.id) || null })));
      }
    };
    fetchSubscribedExperts();
  }, [user]);

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
        {(() => {
          // Mock demo experts for design preview
          const mockAdvisors = [
            { id: 'a1000000-0000-0000-0000-000000000001', slug: 'zhao-pengbo', name: '趙鵬博', role: 'advisor', avatar_url: '/images/experts/zhao-pengbo.png', line_oa_id: '@zhao-pengbo' },
            { id: 'mock-adv-2', slug: 'chen-weiming', name: '陳威銘', role: 'advisor', avatar_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=80&h=80&fit=crop&crop=face', line_oa_id: '@chen-weiming' },
            { id: 'mock-adv-3', slug: 'wang-junhao', name: '王俊豪', role: 'advisor', avatar_url: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=80&h=80&fit=crop&crop=face', line_oa_id: '@wang-junhao' },
          ];
          const mockMentors = [
            { id: 'b1000000-0000-0000-0000-000000000001', slug: 'lin-xiuqi', name: '林修齊', role: 'mentor', avatar_url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=80&h=80&fit=crop&crop=face', line_oa_id: '@lin-xiuqi' },
            { id: 'mock-mnt-2', slug: 'huang-zhiwei', name: '黃志偉', role: 'mentor', avatar_url: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=80&h=80&fit=crop&crop=face', line_oa_id: '@huang-zhiwei' },
            { id: 'mock-mnt-3', slug: 'liu-yating', name: '劉雅婷', role: 'mentor', avatar_url: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=80&h=80&fit=crop&crop=face', line_oa_id: '@liu-yating' },
            { id: 'mock-mnt-4', slug: 'zhang-mingxuan', name: '張銘軒', role: 'mentor', avatar_url: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=80&h=80&fit=crop&crop=face', line_oa_id: '@zhang-mingxuan' },
          ];

          const realAdvisors = subscribedExperts.filter(e => e.role === 'advisor');
          const realMentors = subscribedExperts.filter(e => e.role === 'mentor');

          // Merge real + mock (avoid duplicates by id, fill missing avatars from mock)
          const mockAdvisorMap = new Map(mockAdvisors.map(m => [m.id, m]));
          const mockMentorMap = new Map(mockMentors.map(m => [m.id, m]));
          const realAdvisorIds = new Set(realAdvisors.map(e => e.id));
          const realMentorIds = new Set(realMentors.map(e => e.id));
          const advisors = [
            ...realAdvisors.map(e => ({ ...e, avatar_url: e.avatar_url || mockAdvisorMap.get(e.id)?.avatar_url || null })),
            ...mockAdvisors.filter(m => !realAdvisorIds.has(m.id)),
          ];
          const mentors = [
            ...realMentors.map(e => ({ ...e, avatar_url: e.avatar_url || mockMentorMap.get(e.id)?.avatar_url || null })),
            ...mockMentors.filter(m => !realMentorIds.has(m.id)),
          ];

          return (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <MessageCircle className="h-5 w-5" />
                LINE 綁定
              </h2>
              <p className="text-sm text-muted-foreground">
                綁定 LINE 後，可即時收到訊號推播通知
              </p>
              <div className="space-y-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
                <p className="font-medium text-foreground text-sm">綁定步驟：</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>查看所有老師</li>
                  <li>加入好友</li>
                  <li>點擊右側按鈕取得驗證碼</li>
                  <li>在 LINE 聊天中傳送驗證碼</li>
                  <li>收到綁定成功通知即完成</li>
                </ol>
              </div>

              {/* 跟單派 */}
              <div className="space-y-3">
                {!showAdvisors ? (
                  <Card className="border-red-500/30">
                    <CardContent className="p-4 space-y-3">
                      <h3 className="text-lg font-bold text-red-500 text-center">跟單派</h3>
                      <Button variant="default" className="w-full bg-red-500 hover:bg-red-600" onClick={() => setShowAdvisors(true)}>
                        查看所有老師
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  <Card className="border-red-500/30">
                    <CardContent className="p-4 space-y-3">
                      <h3 className="text-lg font-bold text-red-500 text-center mb-2">跟單派</h3>
                      <div className="space-y-3">
                        {advisors.map(expert => (
                          <LineBindingCard
                            key={expert.id}
                            expertId={expert.id}
                            expertSlug={expert.slug}
                            expertName={expert.name}
                            expertAvatarUrl={expert.avatar_url || undefined}
                            lineOaId={(expert as any).line_oa_id || undefined}
                            isAdvisor
                          />
                        ))}
                      </div>
                      <Button variant="outline" className="w-full mt-2" onClick={() => setShowAdvisors(false)}>
                        收起
                      </Button>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* 修煉派 */}
              <div className="space-y-3">
                {!showMentors ? (
                  <Card className="border-blue-500/30">
                    <CardContent className="p-4 space-y-3">
                      <h3 className="text-lg font-bold text-blue-500 text-center">修煉派</h3>
                      <Button variant="default" className="w-full bg-blue-500 hover:bg-blue-600" onClick={() => setShowMentors(true)}>
                        查看所有老師
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  <Card className="border-blue-500/30">
                    <CardContent className="p-4 space-y-3">
                      <h3 className="text-lg font-bold text-blue-500 text-center mb-2">修煉派</h3>
                      <div className="space-y-3">
                        {mentors.map(expert => (
                          <LineBindingCard
                            key={expert.id}
                            expertId={expert.id}
                            expertSlug={expert.slug}
                            expertName={expert.name}
                            expertAvatarUrl={expert.avatar_url || undefined}
                            lineOaId={(expert as any).line_oa_id || undefined}
                            isAdvisor={false}
                          />
                        ))}
                      </div>
                      <Button variant="outline" className="w-full mt-2" onClick={() => setShowMentors(false)}>
                        收起
                      </Button>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </UnifiedAppLayout>
  );
};

export default Account;
