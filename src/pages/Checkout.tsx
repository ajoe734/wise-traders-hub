import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { PortalLayout } from '@/components/layouts/PortalLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';

import { supabase } from '@/integrations/supabase/client';
import { useCrossProductDiscount } from '@/hooks/useCrossProductDiscount';
import { readAttribution } from '@/hooks/useAttributionTracking';
import { calcUpgradeProration } from '@/lib/revenueSplit';
import { useAcpaySdk } from '@/hooks/checkout/useAcpaySdk';
import { useSubscriptionConfirmation } from '@/hooks/checkout/useSubscriptionConfirmation';
import { Loader2, ArrowLeft, Check } from 'lucide-react';
import { CheckoutConsentDialog } from './_checkout/CheckoutConsentDialog';
import { PlanInfoCard } from './_checkout/PlanInfoCard';
import { PaymentMethodPicker } from './_checkout/PaymentMethodPicker';
import { OrderSummaryCard } from './_checkout/OrderSummaryCard';
import { CheckoutResultDialog, type CheckoutResult } from './_checkout/CheckoutResultDialog';

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
  env?: string | null;
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

  // ACpay cardholder form fields
  const [cardHolderName, setCardHolderName] = useState('');
  const [cardHolderEmail, setCardHolderEmail] = useState('');
  const [cardHolderPhone, setCardHolderPhone] = useState('');
  const [countryCode, setCountryCode] = useState('886');
  const [cardFieldErrors, setCardFieldErrors] = useState<{ name?: string; email?: string; phone?: string }>({});

  // ACpay SDK — 共用 useAcpaySdk
  const acpayCardRef = useRef<HTMLDivElement>(null);

  // Determine if selected provider is ACpay
  const selectedProviderObj = providers.find(p => p.id === selectedProvider);
  const isAcpay = selectedProviderObj?.provider_type === 'acpay';
  const isSandbox = (selectedProviderObj?.env ?? 'production') !== 'production';

  const { getPrime: acpayGetPrime } = useAcpaySdk(isAcpay, {
    numberEl: '#portal-acpay-card-number',
    expirationDateEl: '#portal-acpay-expiry',
    ccvEl: '#portal-acpay-ccv',
  });

  // ACpay 回跳確認 — 共用 hook
  useSubscriptionConfirmation({
    table: 'member_subscriptions',
    userId: user?.id,
    planId,
    enabled: searchParams.get('acpay') === 'result' && !resultDialog,
    channelKey: 'acpay-portal',
    setConfirming: setIsConfirming,
    onConfirmed: (r) => setResultDialog({ open: true, success: r.success, message: r.message }),
  });

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

  // Handle ECPay return — 共用 useSubscriptionConfirmation
  useSubscriptionConfirmation({
    table: 'member_subscriptions',
    userId: user?.id,
    planId,
    enabled: searchParams.get('ecpay') === 'result' && !resultDialog,
    channelKey: 'ecpay-sub',
    setConfirming: setIsConfirming,
    onConfirmed: (r) => setResultDialog({ open: true, success: r.success, message: r.message }),
  });

  useEffect(() => {
    const fetchData = async () => {
      if (!planId || !slug) return;

      // Fire plan + providers + existing-subscription check in parallel.
      // Previously these ran serially (plan → expert → providers → subs),
      // costing ~3 sequential RTTs. expert still depends on plan.expert_id
      // so it stays sequential, but it now overlaps with providers/subs.
      const [planRes, providerRes, subsRes] = await Promise.all([
        supabase
          .from('expert_plans')
          .select('id, name, plan_type, price_monthly, price_yearly, description, features, expert_id')
          .eq('id', planId)
          .single(),
        supabase
          .from('payment_providers_safe')
          .select('id, display_name, provider_type, is_active, is_default, env')
          .eq('is_active', true)
          .order('is_default', { ascending: false }),
        user
          ? supabase
              .from('member_subscriptions')
              .select('id')
              .eq('user_id', user.id)
              .eq('plan_id', planId)
              .eq('status', 'active')
          : Promise.resolve({ data: null as { id: string }[] | null }),
      ]);

      const planData = planRes.data;
      if (!planData) {
        setLoading(false);
        return;
      }
      setPlan(planData);

      // Fetch expert (depends on plan.expert_id — must follow plan)
      const { data: expertData } = await supabase
        .from('experts')
        .select('id, name, slug, avatar_url, role')
        .eq('id', planData.expert_id)
        .single();
      setExpert(expertData);

      if (providerRes.data && providerRes.data.length > 0) {
        setProviders(providerRes.data);
        setSelectedProvider(providerRes.data[0].id);
      }

      if (subsRes.data && subsRes.data.length > 0) {
        setAlreadySubscribed(true);
      }

      setLoading(false);
    };

    fetchData();
  }, [planId, slug, user]);

  // Hooks must be called unconditionally — keep above any early returns
  const { amount: crossDiscount, reason: crossReason } = useCrossProductDiscount({ productKind: 'expert_plan' });

  // Stage 3: month→year upgrade proration
  const [upgradeCredit, setUpgradeCredit] = useState(0);
  const [upgradeFromSubId, setUpgradeFromSubId] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      if (!user?.id || billingCycle !== 'yearly' || !plan?.price_yearly) {
        setUpgradeCredit(0); setUpgradeFromSubId(null); return;
      }
      const { data: existing } = await supabase
        .from('member_subscriptions')
        .select('id, started_at, expires_at')
        .eq('user_id', user.id)
        .eq('plan_id', plan.id)
        .eq('status', 'active')
        .maybeSingle();
      if (!existing) { setUpgradeCredit(0); setUpgradeFromSubId(null); return; }
      const startedAt = new Date(existing.started_at);
      const expiresAt = new Date(existing.expires_at);
      const spanDays = (expiresAt.getTime() - startedAt.getTime()) / (1000 * 60 * 60 * 24);
      if (spanDays > 35) { setUpgradeCredit(0); setUpgradeFromSubId(null); return; }
      const { creditAmount } = calcUpgradeProration({
        monthlyPrice: plan.price_monthly,
        yearlyPrice: plan.price_yearly,
        startedAt, expiresAt,
      });
      setUpgradeCredit(creditAmount);
      setUpgradeFromSubId(existing.id);
    })();
  }, [user?.id, billingCycle, plan?.id, plan?.price_monthly, plan?.price_yearly]);

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
  const basePrice = billingCycle === 'monthly' ? plan.price_monthly : (plan.price_yearly || plan.price_monthly * 12);
  const totalDiscount = crossDiscount + upgradeCredit;
  const discountReason = upgradeCredit > 0
    ? (crossReason ? `upgrade_proration+${crossReason}` : 'upgrade_proration')
    : crossReason;
  const price = Math.max(0, basePrice - totalDiscount);

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
      case 'acpay': return '💳';
      case 'ecpay': return '🏦';
      case 'line_pay': return '💚';
      case 'newebpay': return '🔵';
      default: return '💳';
    }
  };

  const handleCheckout = async () => {
    if (!user) {
      try {
        sessionStorage.setItem('redirect_after_login', `${window.location.pathname}${window.location.search}`);
      } catch {}
      navigate('/auth/login');
      return;
    }

    if (!selectedProvider) {
      setResultDialog({ open: true, success: false, message: '請選擇付款方式' });
      return;
    }

    // Show consent dialog for all plan types
    setConsentChecked(false);
    setConsentOpen(true);
    return;
  };

  const proceedCheckout = async () => {
    setIsProcessing(true);

    try {
      // Check if selected provider is LINE Pay
      const provider = providers.find(p => p.id === selectedProvider);
      
      if (provider?.provider_type === 'line_pay') {
        // Call create-linepay-order edge function
        const attribution = readAttribution();
        const { data, error } = await supabase.functions.invoke('create-linepay-order', {
          body: {
            planId: plan.id,
            billingCycle,
            slug,
            amount: price,
            originalAmount: basePrice,
            discountAmount: totalDiscount,
            discountReason,
            attribution,
            expertId: plan.expert_id,
            upgradeFromSubscriptionId: upgradeCredit > 0 ? upgradeFromSubId : null,
            userId: user.id,
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
        const attribution = readAttribution();
        const { data, error } = await supabase.functions.invoke('create-ecpay-order', {
          body: {
            planId: plan.id,
            billingCycle,
            slug,
            amount: price,
            originalAmount: basePrice,
            discountAmount: totalDiscount,
            discountReason,
            attribution,
            expertId: plan.expert_id,
            upgradeFromSubscriptionId: upgradeCredit > 0 ? upgradeFromSubId : null,
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

      if (provider?.provider_type === 'acpay') {
        // Validate cardholder fields
        const cErrors: { name?: string; email?: string; phone?: string } = {};
        if (!cardHolderName.trim()) cErrors.name = '請輸入英文姓名';
        else if (!/^[a-zA-Z\s]+$/.test(cardHolderName.trim())) cErrors.name = '姓名須為英文字母';
        if (!cardHolderEmail.trim()) cErrors.email = '請輸入電子郵件';
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cardHolderEmail.trim())) cErrors.email = '電子郵件格式不正確';
        if (!cardHolderPhone.trim()) cErrors.phone = '請輸入手機號碼';
        else if (!/^\d{9,10}$/.test(cardHolderPhone.trim())) cErrors.phone = '手機號碼須為 9-10 位數字';
        if (Object.keys(cErrors).length > 0) {
          setCardFieldErrors(cErrors);
          return;
        }
        setCardFieldErrors({});

        let prime: string;
        try {
          prime = await acpayGetPrime();
        } catch (e: any) {
          console.error('ACpay getPrime error:', e);
          setResultDialog({ open: true, success: false, message: e.message || '信用卡資訊有誤，請確認後重試' });
          return;
        }

        const acpayAttribution = readAttribution();
        const { data, error } = await supabase.functions.invoke('create-acpay-order', {
          body: {
            prime,
            amount: price,
            phone: cardHolderPhone,
            countryCode,
            cardHolderName,
            cardHolderEmail,
            planId: plan.id,
            billingCycle,
            userId: user.id,
            origin: window.location.origin,
            slug,
            planName: plan.name,
            expertName: expert.name,
            // Stage 3: attribution + discount snapshot
            originalAmount: basePrice,
            discountAmount: totalDiscount,
            discountReason,
            attribution: acpayAttribution,
            expertId: plan.expert_id,
            upgradeFromSubscriptionId: upgradeCredit > 0 ? upgradeFromSubId : null,
          },
        });

        if (error) {
          console.error('ACpay checkout error:', error);
          setResultDialog({ open: true, success: false, message: '建立 ACpay 訂單失敗，請稍後再試' });
          return;
        }

        // 3DS flow: redirect to code_url for OTP
        if (data?.threeDS && data?.codeUrl) {
          window.location.href = data.codeUrl;
          return;
        }

        // non-3DS flow: synchronous success
        if (data?.success) {
          setResultDialog({ open: true, success: true });
          return;
        }

        setResultDialog({ open: true, success: false, message: '付款失敗，請稍後再試' });
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
              <PlanInfoCard
                plan={plan}
                expert={expert}
                isAdvisor={isAdvisor}
                billingCycle={billingCycle}
                setBillingCycle={setBillingCycle}
                getPlanFeatures={getPlanFeatures}
                formatPrice={formatPrice}
              />

              <PaymentMethodPicker
                providers={providers}
                selectedProvider={selectedProvider}
                setSelectedProvider={setSelectedProvider}
                isAdvisor={isAdvisor}
                isAcpay={isAcpay}
                isSandbox={isSandbox}
                acpayCardRef={acpayCardRef}
                cardHolderName={cardHolderName}
                setCardHolderName={setCardHolderName}
                cardHolderEmail={cardHolderEmail}
                setCardHolderEmail={setCardHolderEmail}
                cardHolderPhone={cardHolderPhone}
                setCardHolderPhone={setCardHolderPhone}
                countryCode={countryCode}
                setCountryCode={setCountryCode}
                cardFieldErrors={cardFieldErrors}
                setCardFieldErrors={setCardFieldErrors}
              />
            </div>

            {/* Right: Payment Summary */}
            <div className="md:col-span-2">
              <OrderSummaryCard
                plan={plan}
                providers={providers}
                selectedProvider={selectedProvider}
                billingCycle={billingCycle}
                basePrice={basePrice}
                price={price}
                crossDiscount={crossDiscount}
                upgradeCredit={upgradeCredit}
                formatPrice={formatPrice}
                user={user}
                isAdvisor={isAdvisor}
                isProcessing={isProcessing}
                alreadySubscribed={alreadySubscribed}
                onCheckout={handleCheckout}
              />
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

      {/* Consent Dialog — content varies by plan type */}
      <CheckoutConsentDialog
        open={consentOpen}
        onOpenChange={(open) => { if (!open) setConsentOpen(false); }}
        isAdvisor={isAdvisor}
        billingCycle={billingCycle}
        consentChecked={consentChecked}
        setConsentChecked={setConsentChecked}
        onProceed={() => {
          setConsentOpen(false);
          proceedCheckout();
        }}
      />


      <CheckoutResultDialog
        resultDialog={resultDialog}
        expert={expert}
        plan={plan}
        billingCycle={billingCycle}
        price={price}
        formatPrice={formatPrice}
        isAdvisor={isAdvisor}
        onAction={() => {
          if (resultDialog?.success) {
            navigate('/app/account');
          } else {
            setResultDialog(null);
          }
        }}
      />
    </PortalLayout>
  );
};

export default Checkout;
