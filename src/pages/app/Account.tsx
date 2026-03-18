import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { UnifiedAppLayout } from '@/components/layouts/UnifiedAppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { User, MessageCircle, Calendar, ExternalLink, Radio, Settings, XCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { LineBindingCard } from '@/components/LineBindingCard';
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
  const queryClient = useQueryClient();
  
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
      .select('id, name, plan_type, price_monthly, expert_id')
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
        plan: plan ? { id: plan.id, name: plan.name, plan_type: plan.plan_type, price_monthly: plan.price_monthly } : { id: '', name: '未知方案', plan_type: '', price_monthly: 0 },
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

    const { data: experts } = await supabase
      .from('experts')
      .select('id, slug, name, role, avatar_url')
      .eq('status', 'active');

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

  // Calculate prorated refund info for a subscription
  const calcRefund = (sub: DbSubscription) => {
    const now = new Date();
    const startedAt = new Date(sub.started_at);
    const expiresAt = sub.expires_at ? new Date(sub.expires_at) : new Date(startedAt.getTime() + 30 * 86400000);
    const totalDays = Math.max(1, Math.round((expiresAt.getTime() - startedAt.getTime()) / 86400000));
    const usedDays = Math.max(0, Math.min(totalDays, Math.round((now.getTime() - startedAt.getTime()) / 86400000)));
    const remainingDays = Math.max(0, totalDays - usedDays);
    const originalAmount = sub.plan.price_monthly;
    const refundAmount = Math.floor(originalAmount * (remainingDays / totalDays));
    return { totalDays, usedDays, remainingDays, originalAmount, refundAmount };
  };

  const handleCancelSubscription = async (subId: string) => {
    setCancelingId(subId);
    try {
      const sub = subscriptions.find(s => s.id === subId);
      const refund = sub ? calcRefund(sub) : null;

      // Immediately cancel the subscription
      const { error } = await supabase
        .from('member_subscriptions')
        .update({
          status: 'canceled' as any,
          auto_renew: false,
          canceled_at: new Date().toISOString(),
        })
        .eq('id', subId)
        .eq('user_id', user!.id);

      if (error) throw error;

      // Immediately deactivate LINE binding for this expert
      if (sub) {
        await supabase
          .from('member_line_bindings')
          .update({ is_active: false })
          .eq('user_id', user!.id)
          .eq('expert_id', sub.expert.id);
      }

      // Write refund record via edge function (bypasses RLS on payment_transactions)
      if (sub && refund && refund.refundAmount > 0) {
        try {
          await supabase.functions.invoke('process-refund', {
            body: {
              subscription_id: subId,
              refund_amount: refund.refundAmount,
              used_days: refund.usedDays,
              total_days: refund.totalDays,
              original_amount: refund.originalAmount,
            },
          });
        } catch (refundErr) {
          console.error('Refund record failed (non-critical):', refundErr);
        }
      }

      // Optimistically clear role-gated caches so page switch shows correct empty-state immediately
      const remainingActiveSubs = subscriptions.filter(
        (subscription) => subscription.id !== subId && subscription.status === 'active'
      );
      const hasAdvisorSubscription = remainingActiveSubs.some(
        (subscription) =>
          subscription.plan.plan_type === 'analyst_signal_l1' ||
          subscription.plan.plan_type === 'analyst_signal_diag_l2'
      );
      const hasMentorSubscription = remainingActiveSubs.some(
        (subscription) => subscription.plan.plan_type === 'mentor_weekly_journal'
      );

      if (user?.id) {
        if (!hasAdvisorSubscription) {
          queryClient.setQueryData(['app-signals', user.id], { signals: [], hasSubscription: false });
        }
        if (!hasMentorSubscription) {
          queryClient.setQueryData(['app-journals', user.id], { signals: [], hasSubscription: false });
        }

        if (sub?.expert.slug) {
          queryClient.setQueryData<string[]>(['subscribed-expert-slugs', user.id], (prev = []) =>
            prev.filter((slug) => slug !== sub.expert.slug)
          );
        }
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['app-signals'], refetchType: 'active' }),
        queryClient.invalidateQueries({ queryKey: ['app-journals'], refetchType: 'active' }),
        queryClient.invalidateQueries({ queryKey: ['subscribed-expert-slugs'], refetchType: 'active' }),
      ]);

      // Refresh data
      await fetchSubscriptions();

      // Toast with refund info
      if (refund && refund.refundAmount > 0) {
        toast.success(`已取消訂閱，預計退款 NT$ ${refund.refundAmount.toLocaleString()}`, {
          description: `已使用 ${refund.usedDays} 天 / 共 ${refund.totalDays} 天`,
        });
      } else {
        toast.success('已取消訂閱');
      }
    } catch (err: any) {
      console.error('Cancel subscription error:', err);
      toast.error('取消訂閱失敗，請稍後再試');
    } finally {
      setCancelingId(null);
    }
  };

  const activeSubs = subscriptions.filter(s => s.status === 'active');
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
                const isCanceling = false; // Immediate cancellation - no "pending" state
                return (
                  <Card
                    key={sub.id}
                    className={cn(
                      "overflow-hidden border-2",
                      advisor ? "border-advisor/50" : "border-mentor/50"
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
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">已使用</span>
                                            <span className="font-medium">{r.usedDays} 天 / 共 {r.totalDays} 天</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">月費</span>
                                            <span>NT$ {r.originalAmount.toLocaleString()}</span>
                                          </div>
                                          <div className="border-t pt-1 flex justify-between font-semibold">
                                            <span>預計退款</span>
                                            <span className={r.refundAmount > 0 ? "text-green-600 dark:text-green-400" : ""}>
                                              NT$ {r.refundAmount.toLocaleString()}
                                            </span>
                                          </div>
                                          {r.refundAmount === 0 && (
                                            <p className="text-xs text-muted-foreground">已使用完畢，無需退款。</p>
                                          )}
                                        </div>
                                      );
                                    })()}
                                    <p className="text-sm text-muted-foreground">取消後，服務將立即停止，您將無法再查看該分析師的訊號與內容。</p>
                                    <p className="text-xs text-muted-foreground">LINE 綁定也會同步解除。如需繼續使用，可隨時重新訂閱。</p>
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

        {/* Quick Links */}
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
