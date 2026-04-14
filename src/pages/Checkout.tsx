import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { PortalLayout } from '@/components/layouts/PortalLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';

import { supabase } from '@/integrations/supabase/client';
import { CheckCircle, Loader2, CreditCard, Shield, ArrowLeft, Check, XCircle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface DbPlan {
  id: string;
  name: string;
  plan_type: string;
  price_monthly: number;
  price_yearly: number | null;
  description: string | null;
  features: any;
  expert_id: string;
}

interface DbExpert {
  id: string;
  name: string;
  slug: string;
  avatar_url: string | null;
  role: string;
}

interface PaymentProvider {
  id: string;
  display_name: string;
  provider_type: string;
  is_active: boolean;
  is_default: boolean;
}

const Checkout = () => {
  const { slug, planId } = useParams<{ slug: string; planId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  const fromAccount = searchParams.get('from') === 'account';

  const [plan, setPlan] = useState<DbPlan | null>(null);
  const [expert, setExpert] = useState<DbExpert | null>(null);
  const [providers, setProviders] = useState<PaymentProvider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [loading, setLoading] = useState(true);
  const [alreadySubscribed, setAlreadySubscribed] = useState(false);
  const [resultDialog, setResultDialog] = useState<{ open: boolean; success: boolean; message?: string } | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  // Handle LINE Pay return
  useEffect(() => {
    const linepay = searchParams.get('linepay');
    const transactionId = searchParams.get('transactionId');
    const txOrderId = searchParams.get('orderId');

    if (linepay === 'confirm' && transactionId && !isConfirming && !resultDialog && plan) {
      const confirmPayment = async () => {
        setIsConfirming(true);
        try {
          const returnedBillingCycle = searchParams.get('billingCycle') || billingCycle;
          
          const currentPrice = returnedBillingCycle === 'yearly'
            ? (plan.price_yearly || plan.price_monthly * 12)
            : plan.price_monthly;

          const isSimulate = searchParams.get('simulate') === 'true';
          const { data, error } = await supabase.functions.invoke('confirm-linepay', {
            body: {
              transactionId,
              orderId: txOrderId || '',
              amount: currentPrice,
              planId,
              billingCycle: returnedBillingCycle,
              userId: user?.id || null,
              simulate: isSimulate,
            },
          });

          if (error || !data?.success) {
            console.error('LINE Pay confirm error:', error || data);
            setResultDialog({ open: true, success: false, message: '付款確認失敗' });
          } else {
            setResultDialog({ open: true, success: true });
          }
        } catch (err) {
          console.error('LINE Pay confirm exception:', err);
          setResultDialog({ open: true, success: false, message: '付款確認時發生錯誤' });
        } finally {
          setIsConfirming(false);
        }
      };
      confirmPayment();
    } else if (linepay === 'cancel') {
      setResultDialog({ open: true, success: false, message: '您已取消付款' });
    }
  }, [searchParams, plan, user]);

  // Handle ECPay return — use Realtime to detect subscription created by server callback
  useEffect(() => {
    const ecpayResult = searchParams.get('ecpay');
    if (ecpayResult !== 'result' || !user || !planId || resultDialog) return;

    setIsConfirming(true);

    // First, check if subscription already exists (callback may have already fired)
    const checkExisting = async () => {
      const { data: subs } = await supabase
        .from('member_subscriptions')
        .select('id')
        .eq('user_id', user.id)
        .eq('plan_id', planId)
        .eq('status', 'active');
      if (subs && subs.length > 0) {
        setIsConfirming(false);
        setResultDialog({ open: true, success: true });
        return true;
      }
      return false;
    };

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    checkExisting().then(found => {
      if (found) return;

      // Listen for realtime INSERT on member_subscriptions for this user+plan
      channel = supabase
        .channel('ecpay-sub-confirm')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'member_subscriptions',
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            const row = payload.new as any;
            if (row.plan_id === planId && row.status === 'active') {
              setIsConfirming(false);
              setResultDialog({ open: true, success: true });
            }
          }
        )
        .subscribe();

      // Timeout after 60 seconds
      timeout = setTimeout(() => {
        setIsConfirming(false);
        setResultDialog({ open: true, success: false, message: '付款確認逾時，如已扣款請聯繫客服' });
      }, 60000);
    });

    return () => {
      if (channel) supabase.removeChannel(channel);
      if (timeout) clearTimeout(timeout);
    };
  }, [searchParams, user, planId]);

  useEffect(() => {
    const fetchData = async () => {
      if (!planId || !slug) return;

      // Fetch plan
      const { data: planData } = await supabase
        .from('expert_plans')
        .select('id, name, plan_type, price_monthly, price_yearly, description, features, expert_id')
        .eq('id', planId)
        .single();

      if (!planData) {
        setLoading(false);
        return;
      }
      setPlan(planData);

      // Fetch expert
      const { data: expertData } = await supabase
        .from('experts')
        .select('id, name, slug, avatar_url, role')
        .eq('id', planData.expert_id)
        .single();

      setExpert(expertData);

      // Fetch active payment providers
      const { data: providerData } = await supabase
        .from('payment_providers_safe')
        .select('id, display_name, provider_type, is_active, is_default')
        .eq('is_active', true)
        .order('is_default', { ascending: false });

      if (providerData && providerData.length > 0) {
        setProviders(providerData);
        setSelectedProvider(providerData[0].id);
      }

      // Check if already subscribed
      if (user) {
        const { data: subs } = await supabase
          .from('member_subscriptions')
          .select('id')
          .eq('user_id', user.id)
          .eq('plan_id', planId)
          .eq('status', 'active');

        if (subs && subs.length > 0) {
          setAlreadySubscribed(true);
        }
      }

      setLoading(false);
    };

    fetchData();
  }, [planId, slug, user]);

  if (loading) {
    return (
       <PortalLayout hideAppEntry hideHeader>
        <div className="flex justify-center items-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </PortalLayout>
    );
  }

  if (!plan || !expert) {
    return (
       <PortalLayout hideAppEntry hideHeader>
        <div className="container py-12 text-center">
          <h1 className="text-2xl font-bold mb-4">找不到此方案</h1>
          <Button asChild>
            <Link to="/experts">返回專家列表</Link>
          </Button>
        </div>
      </PortalLayout>
    );
  }

  const isAdvisor = plan.plan_type !== 'mentor_weekly_journal';
  const price = billingCycle === 'monthly' ? plan.price_monthly : (plan.price_yearly || plan.price_monthly * 12);

  const formatPrice = (p: number) => new Intl.NumberFormat('zh-TW').format(p);

  const getPlanFeatures = (planType: string): string[] => {
    switch (planType) {
      case 'analyst_signal_l1':
        return ['即時策略訊號推播', '每筆操作教學說明', '風險與部位控管解說'];
      case 'analyst_signal_diag_l2':
        return ['即時策略訊號推播', '每筆操作教學說明', '風險與部位控管解說', '持股健檢報告'];
      case 'mentor_weekly_journal':
        return ['每週修煉派週記', '完整操作邏輯拆解', '事後檢討與學習重點'];
      default:
        return [];
    }
  };

  const getProviderIcon = (providerType: string) => {
    switch (providerType) {
      case 'ecpay': return '🏦';
      case 'line_pay': return '💚';
      case 'newebpay': return '🔵';
      default: return '💳';
    }
  };

  const handleCheckout = async () => {
    if (!user) {
      navigate('/auth/login');
      return;
    }

    if (!selectedProvider) {
      setResultDialog({ open: true, success: false, message: '請選擇付款方式' });
      return;
    }

    // For mentor plans, show consent dialog first
    if (!isAdvisor) {
      setConsentChecked(false);
      setConsentOpen(true);
      return;
    }

    await proceedCheckout();
  };

  const proceedCheckout = async () => {
    setIsProcessing(true);

    try {
      // Check if selected provider is LINE Pay
      const provider = providers.find(p => p.id === selectedProvider);
      
      if (provider?.provider_type === 'line_pay') {
        // Call create-linepay-order edge function
        const { data, error } = await supabase.functions.invoke('create-linepay-order', {
          body: {
            planId: plan.id,
            billingCycle,
            slug,
            amount: price,
            planName: plan.name,
            expertName: expert.name,
            origin: window.location.origin,
          },
        });

        if (error || !data?.paymentUrl) {
          console.error('Create LINE Pay order error:', error || data);
          setResultDialog({ open: true, success: false, message: '建立 LINE Pay 訂單失敗，請稍後再試' });
          return;
        }

        // Redirect to LINE Pay
        window.location.href = data.paymentUrl;
        return;
      }

      if (provider?.provider_type === 'ecpay') {
        // Call create-ecpay-order edge function
        const { data, error } = await supabase.functions.invoke('create-ecpay-order', {
          body: {
            planId: plan.id,
            billingCycle,
            slug,
            amount: price,
            planName: plan.name,
            expertName: expert.name,
            origin: window.location.origin,
            userId: user.id,
          },
        });

        if (error || !data?.actionUrl || !data?.params) {
          console.error('Create ECPay order error:', error || data);
          setResultDialog({ open: true, success: false, message: '建立綠界訂單失敗，請稍後再試' });
          return;
        }

        // Create and submit a hidden form to ECPay in a new window
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = data.actionUrl;
        form.style.display = 'none';

        for (const [key, value] of Object.entries(data.params)) {
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = key;
          input.value = String(value);
          form.appendChild(input);
        }

        document.body.appendChild(form);
        form.submit();
        document.body.removeChild(form);
        return;
      }

      // Other providers: simulate payment and create subscription directly
      const expiresAt = new Date();
      if (billingCycle === 'monthly') {
        expiresAt.setMonth(expiresAt.getMonth() + 1);
      } else {
        expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      }

      const { error: subError } = await supabase
        .from('member_subscriptions')
        .insert({
          user_id: user.id,
          plan_id: plan.id,
          status: 'active',
          provider_id: selectedProvider,
          started_at: new Date().toISOString(),
          expires_at: expiresAt.toISOString(),
        });

      if (subError) throw subError;

      setResultDialog({ open: true, success: true });
    } catch (err: any) {
      console.error('Checkout error:', err);
      setResultDialog({ open: true, success: false, message: err.message || '請稍後再試' });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <PortalLayout hideAppEntry hideHeader>
      {/* Blocking overlay while confirming payment */}
      {isConfirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      )}
      <div className="container py-8 md:py-12">
        <div className="max-w-4xl mx-auto">
          {/* Back */}
          <Button variant="ghost" size="sm" className="mb-6 gap-2" asChild>
            <Link to={`/expert/${slug}${fromAccount ? '?from=account' : ''}#plans`}>
              <ArrowLeft className="h-4 w-4" />
              返回方案
            </Link>
          </Button>

          <h1 className="text-2xl md:text-3xl font-bold mb-8 text-center">確認訂閱</h1>

          {alreadySubscribed && (
            <Card className="mb-6 border-success/40 bg-success/5">
              <CardContent className="p-4 flex items-center gap-3">
                <Check className="h-5 w-5 text-success" />
                <span className="text-success font-medium">您已訂閱此方案，無需重複訂閱。</span>
                <Button variant="outline" size="sm" asChild className="ml-auto">
                  <Link to={`/expert/${slug}#plans`}>返回</Link>
                </Button>
              </CardContent>
            </Card>
          )}

          <div className="grid md:grid-cols-5 gap-8">
            {/* Left: Order Summary */}
            <div className="md:col-span-3 space-y-6">
              {/* Expert + Plan Info */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">訂閱內容</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-4">
                    <img
                      src={expert.avatar_url || '/placeholder.svg'}
                      alt={expert.name}
                      className="h-14 w-14 rounded-xl object-cover"
                    />
                    <div>
                      <span className="font-semibold">{expert.name}</span>
                      <p className="text-sm text-muted-foreground">{plan.name}</p>
                    </div>
                  </div>

                  <div className={cn(
                    "p-4 rounded-lg border-2",
                    isAdvisor ? "border-advisor/20 bg-advisor-light/30" : "border-mentor/20 bg-mentor-light/30"
                  )}>
                    <h3 className="font-semibold mb-2">{plan.name}</h3>
                    {plan.description && (
                      <p className="text-sm text-muted-foreground mb-4">{plan.description}</p>
                    )}
                    <ul className="space-y-2">
                      {getPlanFeatures(plan.plan_type).map((feature, idx) => (
                        <li key={idx} className="flex items-center gap-2 text-sm">
                          <CheckCircle className={cn(
                            "h-4 w-4",
                            isAdvisor ? "text-advisor" : "text-mentor"
                          )} />
                          {feature}
                        </li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
              </Card>

              {/* Billing Cycle */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">選擇付款週期</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      onClick={() => setBillingCycle('monthly')}
                      className={cn(
                        "p-4 rounded-lg border-2 text-left transition-colors",
                        billingCycle === 'monthly'
                          ? isAdvisor ? "border-primary bg-primary/5" : "border-mentor bg-mentor-light/30"
                          : isAdvisor ? "border-border hover:border-primary/50" : "border-border hover:border-mentor/50"
                      )}
                    >
                      <p className="font-semibold">月繳</p>
                      <p className="text-2xl font-bold mt-1">NT$ {formatPrice(plan.price_monthly)}</p>
                      <p className="text-sm text-muted-foreground">每月</p>
                    </button>
                    <button
                      disabled
                      className={cn(
                        "p-4 rounded-lg border-2 text-left transition-colors relative",
                        "border-border opacity-50 cursor-not-allowed"
                      )}
                    >
                      {plan.price_yearly && (
                        <Badge variant="secondary" className="absolute -top-2 -right-2 rotate-12">
                          省 {Math.round((1 - plan.price_yearly / (plan.price_monthly * 12)) * 100)}%
                        </Badge>
                      )}
                      <p className="font-semibold">年繳</p>
                      <p className="text-2xl font-bold mt-1">
                        NT$ {formatPrice(plan.price_yearly || plan.price_monthly * 12)}
                      </p>
                      <p className="text-sm text-muted-foreground">尚未開放</p>
                    </button>
                  </div>
                </CardContent>
              </Card>

              {/* Payment Method Selection */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">選擇付款方式</CardTitle>
                  <p className="text-xs text-muted-foreground">🧪 目前為沙盒測試模式</p>
                </CardHeader>
                <CardContent>
                  {providers.length === 0 ? (
                    <p className="text-sm text-muted-foreground">尚未設定可用的付款方式</p>
                  ) : (
                    <div className="space-y-3">
                      {providers.map(provider => (
                        <button
                          key={provider.id}
                          onClick={() => setSelectedProvider(provider.id)}
                          className={cn(
                            "w-full flex items-center gap-4 p-4 rounded-lg border-2 text-left transition-colors",
                            selectedProvider === provider.id
                              ? isAdvisor ? "border-primary bg-primary/5" : "border-mentor bg-mentor-light/30"
                              : isAdvisor ? "border-border hover:border-primary/50" : "border-border hover:border-mentor/50"
                          )}
                        >
                          <span className="text-2xl">{getProviderIcon(provider.provider_type)}</span>
                          <div className="flex-1">
                            <p className="font-semibold">{provider.display_name}</p>
                            <p className="text-xs text-muted-foreground">
                              {provider.provider_type === 'ecpay' && '信用卡 / ATM / 超商代碼'}
                              {provider.provider_type === 'line_pay' && 'LINE Pay 行動支付'}
                              {provider.provider_type === 'newebpay' && '信用卡 / WebATM'}
                            </p>
                          </div>
                          <div className={cn(
                            "w-5 h-5 rounded-full border-2 flex items-center justify-center",
                            selectedProvider === provider.id
                              ? isAdvisor ? "border-primary bg-primary" : "border-mentor bg-mentor"
                              : "border-muted-foreground/30"
                          )}>
                            {selectedProvider === provider.id && (
                              <Check className="h-3 w-3 text-primary-foreground" />
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right: Payment Summary */}
            <div className="md:col-span-2">
              <Card className="sticky top-24">
                <CardHeader>
                  <CardTitle className="text-lg">付款摘要</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">方案</span>
                    <span>{plan.name}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">週期</span>
                    <span>{billingCycle === 'monthly' ? '月繳' : '年繳'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">付款方式</span>
                    <span>{providers.find(p => p.id === selectedProvider)?.display_name || '-'}</span>
                  </div>
                  <div className="border-t pt-4">
                    <div className="flex justify-between font-semibold">
                      <span>總計</span>
                      <span>NT$ {formatPrice(price)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {billingCycle === 'monthly' ? '每月自動續訂' : '每年自動續訂'}
                    </p>
                  </div>

                  <Badge variant="outline" className="w-full justify-center py-1">
                    🧪 沙盒測試模式 — 不會實際扣款
                  </Badge>

                  {user ? (
                    <Button
                      className={cn("w-full", !isAdvisor && "bg-mentor hover:bg-mentor-dark")}
                      size="lg"
                      onClick={handleCheckout}
                      disabled={isProcessing || alreadySubscribed || !selectedProvider}
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          處理中...
                        </>
                      ) : (
                        <>
                          <CreditCard className="h-4 w-4 mr-2" />
                          確認付款（沙盒）
                        </>
                      )}
                    </Button>
                  ) : (
                    <Button className={cn("w-full", !isAdvisor && "bg-mentor hover:bg-mentor/90 text-white")} size="lg" asChild>
                      <Link to="/auth/login">登入後付款</Link>
                    </Button>
                  )}

                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Shield className="h-3.5 w-3.5" />
                    <span>SSL 加密安全付款</span>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    點擊「確認付款」即表示您同意我們的{' '}
                    <Link to="/legal" className="underline">服務條款</Link>。
                    訂閱可隨時取消。
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Compliance */}
          <div className="mt-8 text-center">
            <p className="text-xs text-muted-foreground">
              過去績效不代表未來表現，投資有風險，請謹慎評估。
            </p>
          </div>
        </div>
      </div>

      {/* Result Dialog */}
      <AlertDialog open={resultDialog?.open ?? false} onOpenChange={() => {}}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {resultDialog?.success ? (
                <><CheckCircle className="h-5 w-5 text-green-500" />訂閱成功 🎉</>
              ) : (
                <><XCircle className="h-5 w-5 text-destructive" />訂閱失敗</>
              )}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 pt-2">
                <div className="flex items-center gap-3">
                  <img
                    src={expert?.avatar_url || '/placeholder.svg'}
                    alt={expert?.name}
                    className="h-10 w-10 rounded-full object-cover"
                  />
                  <div>
                    <p className="font-medium text-foreground">{expert?.name}</p>
                    <p className="text-sm text-muted-foreground">{plan?.name}</p>
                  </div>
                </div>
                <div className="text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">付款週期</span>
                    <span className="text-foreground">{billingCycle === 'monthly' ? '月繳' : '年繳'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">金額</span>
                    <span className="text-foreground font-medium">NT$ {formatPrice(price)}</span>
                  </div>
                </div>
                {resultDialog?.success ? (
                  <p className="text-sm text-muted-foreground">您現在可以前往帳號頁面綁定 LINE 以接收即時通知。</p>
                ) : (
                  <p className="text-sm text-destructive">{resultDialog?.message || '付款處理時發生錯誤，請稍後再試。'}</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
              <AlertDialogAction
                onClick={() => navigate('/app/account')}
                className={cn(!isAdvisor && "bg-mentor hover:bg-mentor/90")}
              >
                確定
              </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PortalLayout>
  );
};

export default Checkout;
