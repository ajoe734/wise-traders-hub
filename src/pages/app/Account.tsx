import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { UnifiedAppLayout } from '@/components/layouts/UnifiedAppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { User, MessageCircle, Calendar, ExternalLink, Radio, Settings, XCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { LineBindingCard } from '@/components/LineBindingCard';
import { calcRefund } from '@/lib/refundCalc';
import { cancelSubscriptionInDB } from '@/lib/cancelSubscription';
import { supabase } from '@/integrations/supabase/client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface DbSubscription {
  id: string;
  plan_id: string;
  status: string;
  auto_renew: boolean;
  started_at: string;
  expires_at: string | null;
  canceled_at: string | null;
  plan: {
    id: string;
    name: string;
    plan_type: string;
    price_monthly: number;
    price_yearly: number | null;
  };
  expert: {
    id: string;
    slug: string;
    name: string;
    role: string;
    avatar_url: string | null;
  };
}

const Account = () => {
  const { user } = useAuth();
  
  
  const [subscriptions, setSubscriptions] = useState<DbSubscription[]>([]);
  const [loadingSubs, setLoadingSubs] = useState(true);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [subscribedExpertIds, setSubscribedExpertIds] = useState<Set<string>>(new Set());
  const [allAdvisors, setAllAdvisors] = useState<{ id: string; slug: string; name: string; role: string; avatar_url: string | null; line_oa_id?: string | null; qr_code_url?: string | null; channel_name?: string | null }[]>([]);
  const [allMentors, setAllMentors] = useState<{ id: string; slug: string; name: string; role: string; avatar_url: string | null; line_oa_id?: string | null; qr_code_url?: string | null; channel_name?: string | null }[]>([]);
  const [showAdvisors, setShowAdvisors] = useState(false);
  const [showMentors, setShowMentors] = useState(false);

  const fetchSubscriptions = async () => {
    if (!user) return;
    setLoadingSubs(true);

    // Fetch user's subscriptions with plan info
    const { data: subs } = await supabase
      .from('member_subscriptions')
      .select('id, plan_id, status, auto_renew, started_at, expires_at, canceled_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (!subs || subs.length === 0) {
      setSubscriptions([]);
      setSubscribedExpertIds(new Set());
      setLoadingSubs(false);
      return;
    }

    // Fetch plan details
    const planIds = [...new Set(subs.map(s => s.plan_id))];
    const { data: plans } = await supabase
      .from('expert_plans')
      .select('id, name, plan_type, price_monthly, price_yearly, expert_id')
      .in('id', planIds);

    if (!plans) {
      setLoadingSubs(false);
      return;
    }

    // Fetch expert details
    const expertIds = [...new Set(plans.map(p => p.expert_id))];
    const { data: experts } = await supabase
      .from('experts')
      .select('id, slug, name, role, avatar_url')
      .in('id', expertIds);

    const planMap = new Map(plans.map(p => [p.id, p]));
    const expertMap = new Map((experts || []).map(e => [e.id, e]));

    const enriched: DbSubscription[] = subs.map(sub => {
      const plan = planMap.get(sub.plan_id);
      const expert = plan ? expertMap.get(plan.expert_id) : null;
      return {
        ...sub,
        plan: plan ? { id: plan.id, name: plan.name, plan_type: plan.plan_type, price_monthly: plan.price_monthly, price_yearly: plan.price_yearly } : { id: '', name: '未知方案', plan_type: '', price_monthly: 0, price_yearly: null },
        expert: expert ? { id: expert.id, slug: expert.slug, name: expert.name, role: expert.role, avatar_url: expert.avatar_url } : { id: '', slug: '', name: '未知', role: '', avatar_url: null },
      };
    }).filter(sub => {
      // Filter out subscriptions for suspended/inactive experts
      const expert = sub.expert;
      if (!expert.id) return true; // keep unknown for display
      const fullExpert = (experts || []).find(e => e.id === expert.id);
      // If expert wasn't returned by the query (might be suspended and RLS hides it), hide from active list
      return !!fullExpert;
    });

    setSubscriptions(enriched);
    const activeExpertIds = new Set(enriched.filter(s => s.status === 'active').map(s => s.expert.id));
    setSubscribedExpertIds(activeExpertIds);
    setLoadingSubs(false);
  };

  // Fetch all active experts + LINE channels
  const fetchExperts = async () => {
    if (!user) return;

    const expectedStatus = user.isTester ? 'draft' : 'active';
    const { data: experts } = await supabase
      .from('experts')
      .select('id, slug, name, role, avatar_url, status')
      .eq('status', expectedStatus);

    if (!experts) return;

    const expertIds = experts.map(e => e.id);
    const { data: channels } = await supabase
      .from('expert_line_channels_public')
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

  useEffect(() => {
    if (!user) return;
    fetchSubscriptions();
    fetchExperts();
  }, [user]);

  const handleCancelSubscription = async (subId: string) => {
    setCancelingId(subId);
    try {
      const sub = subscriptions.find(s => s.id === subId);
      if (!sub) return;

      const { error: cancelError, refund } = await cancelSubscriptionInDB(supabase, sub, user!.id);
      if (cancelError) throw new Error(cancelError);

      // Do NOT deactivate LINE binding - keep it active
      // LINE push will differentiate content based on canceled_at status

      // Write refund record via edge function for yearly plans only
      if (refund.refundAmount > 0) {
        try {
          await supabase.functions.invoke('process-refund', {
            body: {
              subscription_id: subId,
              refund_amount: refund.refundAmount,
              remaining_months: refund.remainingMonths,
              original_amount: refund.originalAmount,
              monthly_price: refund.monthlyPrice,
            },
          });
        } catch (refundErr) {
          console.error('Refund record failed (non-critical):', refundErr);
        }
      }

      // Refresh data
      await fetchSubscriptions();

      // Toast
      if (refund && refund.refundAmount > 0) {
        toast.success(`已取消訂閱，服務持續至本月底`, {
          description: `年繳退款 NT$ ${refund.refundAmount.toLocaleString()}（${refund.remainingMonths} 個月）`,
        });
      } else {
        toast.success('已取消訂閱，服務持續至本月底', {
          description: '月繳無退款，本月服務不受影響',
        });
      }
    } catch (err: any) {
      console.error('Cancel subscription error:', err);
      toast.error('取消訂閱失敗，請稍後再試');
    } finally {
      setCancelingId(null);
    }
  };

  const activeSubs = subscriptions.filter(s => s.status === 'active');
  const canceledActiveSubs = activeSubs.filter(s => s.canceled_at);
  const trueActiveSubs = activeSubs.filter(s => !s.canceled_at);
  const inactiveSubs = subscriptions.filter(s => s.status !== 'active');

  const getPlanTypeLabel = (planType: string) => {
    switch (planType) {
      case 'analyst_signal_l1': return '跟單派 基礎';
      case 'analyst_signal_diag_l2': return '跟單派 進階';
      case 'mentor_weekly_journal': return '修煉派';
      default: return planType;
    }
  };

  const isAdvisorPlan = (planType: string) => planType !== 'mentor_weekly_journal';

  return (
    <UnifiedAppLayout>
      <div className="p-4 space-y-6">
        <h1 className="text-xl font-bold">帳號設定</h1>

        {/* User Info Card */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden">
                {user?.avatarUrl ? (
                  <img src={user.avatarUrl} alt="頭貼" className="h-full w-full object-cover" />
                ) : (
                  <User className="h-6 w-6 text-primary" />
                )}
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

          {loadingSubs ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : subscriptions.length > 0 ? (
            <div className="space-y-3">
              {/* Active subscriptions */}
              {activeSubs.map((sub) => {
                const advisor = isAdvisorPlan(sub.plan.plan_type);
                const isCanceling = !!sub.canceled_at;
                return (
                  <Card
                    key={sub.id}
                    className={cn(
                      "overflow-hidden border-2",
                      isCanceling ? "border-amber-400/50" : advisor ? "border-advisor/50" : "border-mentor/50"
                    )}
                  >
                    <div className={cn(
                      "h-1 bg-gradient-to-r",
                      advisor ? "from-advisor to-advisor/50" : "from-mentor to-mentor/50"
                    )} />
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <img
                          src={sub.expert.avatar_url || '/placeholder.svg'}
                          alt={sub.expert.name}
                          className="h-12 w-12 rounded-full object-cover"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <h3 className="font-semibold">{sub.expert.name}</h3>
                            {isCanceling ? (
                              <Badge variant="secondary" className="bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700">
                                已取消（服務至月底）
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className={cn(
                                advisor
                                  ? "bg-advisor/20 text-advisor border-advisor/30"
                                  : "bg-mentor/20 text-mentor border-mentor/30"
                              )}>
                                有效
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">{sub.plan.name}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {getPlanTypeLabel(sub.plan.plan_type)} · NT$ {sub.plan.price_monthly.toLocaleString()}/月
                          </p>
                          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                            <span>
                              {format(new Date(sub.started_at), 'yyyy/MM/dd')}
                              {sub.expires_at && ` - ${format(new Date(sub.expires_at), 'yyyy/MM/dd')}`}
                            </span>
                            {isCanceling ? (
                              <span className="text-amber-600 dark:text-amber-400">
                                下月起不再扣款
                              </span>
                            ) : (
                              <span className={cn(advisor ? "text-advisor/70" : "text-mentor/70")}>
                                {sub.auto_renew ? '自動續訂' : '手動續訂'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Cancel button - only show if not already canceling */}
                      {!isCanceling && (
                        <div className="mt-3 pt-3 border-t flex justify-end">
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1"
                                disabled={cancelingId === sub.id}
                              >
                                {cancelingId === sub.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <XCircle className="h-3.5 w-3.5" />
                                )}
                                取消訂閱
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>確認取消訂閱？</AlertDialogTitle>
                                <AlertDialogDescription asChild>
                                  <div className="space-y-3">
                                     <p>您確定要取消 <span className="font-semibold">{sub.expert.name}</span> 的 {sub.plan.name} 訂閱嗎？</p>
                                     {(() => {
                                       const r = calcRefund(sub);
                                       return (
                                         <div className="rounded-lg bg-muted p-3 space-y-1 text-sm">
                                           {r.isYearly ? (
                                             <>
                                               <div className="flex justify-between">
                                                 <span className="text-muted-foreground">計費方式</span>
                                                 <span className="font-medium">年繳</span>
                                               </div>
                                               <div className="flex justify-between">
                                                 <span className="text-muted-foreground">剩餘月數</span>
                                                 <span>{r.remainingMonths} 個月</span>
                                               </div>
                                               <div className="border-t pt-1 flex justify-between font-semibold">
                                                 <span>預計退款</span>
                                                 <span className={r.refundAmount > 0 ? "text-green-600 dark:text-green-400" : ""}>
                                                   NT$ {r.refundAmount.toLocaleString()}
                                                 </span>
                                               </div>
                                             </>
                                           ) : (
                                             <>
                                               <div className="flex justify-between">
                                                 <span className="text-muted-foreground">計費方式</span>
                                                 <span className="font-medium">月繳</span>
                                               </div>
                                               <p className="text-xs text-muted-foreground">月繳不退款，本月服務持續至月底。</p>
                                             </>
                                           )}
                                         </div>
                                       );
                                     })()}
                                     <p className="text-sm text-muted-foreground">取消後，服務將持續提供至本月底。</p>
                                     <p className="text-xs text-muted-foreground">LINE 綁定不會自動解除，您仍會收到推播通知。</p>
                                  </div>
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>返回</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleCancelSubscription(sub.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  確認取消
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}

            </div>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                <Radio className="h-8 w-8 mx-auto mb-3 opacity-50" />
                <p>尚無訂閱</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Quick Links — hide profile edit for LINE users */}
        {!user?.isLineUser && (
          <Card>
            <CardContent className="p-4 space-y-2">
              <Link to="/account/profile" className="flex items-center justify-between p-2 rounded-lg hover:bg-muted transition-colors">
                <span className="text-sm flex items-center gap-2">
                  <Settings className="h-4 w-4" /> 編輯個人資料
                </span>
                <ExternalLink className="h-4 w-4 text-muted-foreground" />
              </Link>
            </CardContent>
          </Card>
        )}

        {/* LINE Binding */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <MessageCircle className="h-5 w-5" />
            LINE 綁定
            <span className="font-normal text-muted-foreground">（請先訂閱）</span>
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

        </div>
      </div>
    </UnifiedAppLayout>
  );
};

export default Account;
