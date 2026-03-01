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
  const [subscribedExpertIds, setSubscribedExpertIds] = useState<Set<string>>(new Set());
  const [allAdvisors, setAllAdvisors] = useState<{ id: string; slug: string; name: string; role: string; avatar_url: string | null; line_oa_id?: string | null; qr_code_url?: string | null; channel_name?: string | null }[]>([]);
  const [allMentors, setAllMentors] = useState<{ id: string; slug: string; name: string; role: string; avatar_url: string | null; line_oa_id?: string | null; qr_code_url?: string | null; channel_name?: string | null }[]>([]);
  const [showAdvisors, setShowAdvisors] = useState(false);
  const [showMentors, setShowMentors] = useState(false);

  // Fetch all active experts + LINE channels + user subscriptions
  useEffect(() => {
    if (!user) return;
    const fetchData = async () => {
      // Fetch subscribed expert IDs
      const { data: subData } = await supabase
        .rpc('has_active_subscription', { _user_id: user.id });
      const subIds = new Set((subData || []).map((d: any) => d.expert_id));
      setSubscribedExpertIds(subIds);

      // Fetch all active experts
      const { data: experts } = await supabase
        .from('experts')
        .select('id, slug, name, role, avatar_url')
        .eq('status', 'active');

      if (!experts) return;

      // Fetch LINE channels for all experts
      const expertIds = experts.map(e => e.id);
      const { data: channels } = await supabase
        .from('expert_line_channels')
        .select('expert_id, line_oa_id, qr_code_url, channel_name')
        .in('expert_id', expertIds);
      const channelMap = new Map((channels || []).map((c: any) => [c.expert_id, { line_oa_id: c.line_oa_id, qr_code_url: c.qr_code_url, channel_name: c.channel_name }]));

      const enriched = experts.map(e => ({
        ...e,
        line_oa_id: channelMap.get(e.id)?.line_oa_id || null,
        qr_code_url: channelMap.get(e.id)?.qr_code_url || null,
        channel_name: channelMap.get(e.id)?.channel_name || null,
      }));

      setAllAdvisors(enriched.filter(e => e.role === 'advisor'));
      setAllMentors(enriched.filter(e => e.role === 'mentor'));
    };
    fetchData();
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
        <div className="space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <MessageCircle className="h-5 w-5" />
            LINE 綁定
          </h2>
          <p className="text-sm text-muted-foreground">
            綁定 LINE 後，可即時收到訊號推播或週記通知
          </p>
          <div className="space-y-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
            <p className="font-medium text-foreground text-sm">綁定步驟：</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>查看所有老師</li>
              <li>加入官方帳號</li>
              <li>點擊右側按鈕取得驗證碼</li>
              <li>在 LINE 聊天中傳送驗證碼</li>
              <li>收到綁定成功通知即完成</li>
            </ol>
          </div>

          {/* 跟單派 */}
          <div className="space-y-3">
            {!showAdvisors ? (
              <Card className="border-advisor/30">
                <CardContent className="p-4 space-y-3">
                  <h3 className="text-lg font-bold text-advisor text-center">跟單派</h3>
                  <p className="text-xs text-muted-foreground text-center">即時訊號推播通知</p>
                  <Button variant="default" className="w-full bg-advisor hover:bg-advisor/90" onClick={() => setShowAdvisors(true)}>
                    查看所有老師
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-advisor/30">
                <CardContent className="p-4 space-y-3">
                  <h3 className="text-lg font-bold text-advisor text-center mb-2">跟單派</h3>
                  <div className="space-y-3">
                    {allAdvisors.map(expert => (
                      <LineBindingCard
                        key={expert.id}
                        expertId={expert.id}
                        expertSlug={expert.slug}
                        expertName={expert.name}
                        expertAvatarUrl={expert.avatar_url || undefined}
                        lineOaId={expert.line_oa_id || undefined}
                        lineChannelName={expert.channel_name || undefined}
                        qrCodeUrl={expert.qr_code_url || undefined}
                        isAdvisor
                        isSubscribed={subscribedExpertIds.has(expert.id)}
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
              <Card className="border-mentor/30">
                <CardContent className="p-4 space-y-3">
                  <h3 className="text-lg font-bold text-mentor text-center">修煉派</h3>
                  <p className="text-xs text-muted-foreground text-center">每週實戰週記通知</p>
                  <Button variant="default" className="w-full bg-mentor hover:bg-mentor/90" onClick={() => setShowMentors(true)}>
                    查看所有老師
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-mentor/30">
                <CardContent className="p-4 space-y-3">
                  <h3 className="text-lg font-bold text-mentor text-center mb-2">修煉派</h3>
                  <div className="space-y-3">
                    {allMentors.map(expert => (
                      <LineBindingCard
                        key={expert.id}
                        expertId={expert.id}
                        expertSlug={expert.slug}
                        expertName={expert.name}
                        expertAvatarUrl={expert.avatar_url || undefined}
                        lineOaId={expert.line_oa_id || undefined}
                        lineChannelName={expert.channel_name || undefined}
                        qrCodeUrl={expert.qr_code_url || undefined}
                        isSubscribed={subscribedExpertIds.has(expert.id)}
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

          {/* 綁定機制規劃筆記 */}
          <Card className="border-dashed border-muted-foreground/30 bg-muted/30">
            <CardContent className="p-4 space-y-2 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">📌 綁定機制規劃</p>
              <div className="space-y-2">
                <div>
                  <p className="font-semibold">現行：手動綁定</p>
                  <p>目前用 Email 登入，系統不知道用戶的 LINE user ID，需透過「加好友 → 傳驗證碼」步驟建立對應關係。</p>
                </div>
                <div>
                  <p className="font-semibold">未來：自動化綁定（LINE Login）</p>
                  <ol className="list-decimal list-inside space-y-0.5 ml-1">
                    <li>用戶點擊「LINE 登入」→ LINE OAuth 授權</li>
                    <li>系統自動取得用戶的 LINE user ID</li>
                    <li>LINE Login 的「Bot Link」功能可在授權畫面同時提示加入 OA 好友</li>
                    <li>用戶授權 + 加好友 → 自動完成綁定，不需要驗證碼</li>
                  </ol>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </UnifiedAppLayout>
  );
};

export default Account;
