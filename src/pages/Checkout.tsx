import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { PortalLayout } from '@/components/layouts/PortalLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { useCrossProductDiscount } from '@/hooks/useCrossProductDiscount';
import { useAcpaySdk } from '@/hooks/checkout/useAcpaySdk';
import { useSubscriptionConfirmation } from '@/hooks/checkout/useSubscriptionConfirmation';
import { useCheckoutData } from '@/hooks/checkout/useCheckoutData';
import { usePlanExpertStatus } from '@/hooks/checkout/usePlanExpertStatus';
import { CheckoutUnavailable } from '@/components/checkout/CheckoutUnavailable';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, ArrowLeft, Check } from 'lucide-react';
import { CheckoutConsentDialog } from './_checkout/CheckoutConsentDialog';
import { PlanInfoCard } from './_checkout/PlanInfoCard';
import { PaymentMethodPicker } from './_checkout/PaymentMethodPicker';
import { OrderSummaryCard } from './_checkout/OrderSummaryCard';
import { CheckoutResultDialog, type CheckoutResult } from './_checkout/CheckoutResultDialog';
import { RemittanceAccountCard } from './_remittance/RemittanceAccountCard';
import { trackEvent } from '@/lib/trafficTracker';
import { gtmPush } from '@/lib/analytics/gtm';
import {
  dispatchLinePay, dispatchEcpay, dispatchAcpay, dispatchRemittance,
  submitEcpayForm, validateAcpayCardholder, type DispatchCtx,
} from './_checkout/paymentDispatchers';

const Checkout = () => {
  const { slug, planId } = useParams<{ slug: string; planId: string }>();
  const { user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const fromAccount = searchParams.get('from') === 'account';
  const initialCycle = searchParams.get('cycle') === 'yearly' ? 'yearly' : 'monthly';

  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>(initialCycle);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [resultDialog, setResultDialog] = useState<CheckoutResult | null>(null);

  // B3: 付費路徑（checkout）為登入限定 — 未登入即把當前 URL 存入 sessionStorage 並跳登入頁
  useEffect(() => {
    if (authLoading || user) return;
    try {
      sessionStorage.setItem('redirect_after_login', `${window.location.pathname}${window.location.search}`);
    } catch {}
    navigate('/auth/login', { replace: true });
  }, [authLoading, user, navigate]);

  const {
    loading, plan, expert, providers, defaultProviderId,
    alreadySubscribed, upgradeCredit, upgradeFromSubId,
  } = useCheckoutData({ planId, slug, userId: user?.id, billingCycle });

  // Initialize selected provider once providers load; honor ?method= from retry/recovery URLs
  useEffect(() => {
    if (selectedProvider || providers.length === 0) return;
    const methodQuery = (searchParams.get('method') || '').toLowerCase();
    const methodToType: Record<string, string> = {
      ecpay: 'ecpay',
      linepay: 'line_pay',
      line_pay: 'line_pay',
      acpay: 'acpay',
      remittance: 'remittance',
      atm: 'remittance',
    };
    const wanted = methodToType[methodQuery];
    const match = wanted ? providers.find(p => p.provider_type === wanted && p.is_active) : null;
    if (match) {
      setSelectedProvider(match.id);
      trackEvent('checkout_method_prefill', { method: wanted, source: searchParams.get('utm_source') || 'direct' });
    } else if (defaultProviderId) {
      setSelectedProvider(defaultProviderId);
    }
  }, [defaultProviderId, selectedProvider, providers, searchParams]);

  // GTM Purchase event + 自動導回 /app（顯示成功 toast，取代彈窗確認）
  useEffect(() => {
    if (resultDialog?.open && resultDialog?.success) {
      gtmPush('Purchase', {
        plan_id: planId,
        expert_slug: slug,
        currency: 'TWD',
        billing_cycle: billingCycle,
      });
      trackEvent('checkout_success', { plan_id: planId, slug });
      toast.success('訂閱成功，可在「我的服務」中看到。');
      navigate('/app', { replace: true });
    }
  }, [resultDialog?.open, resultDialog?.success, planId, slug, billingCycle, navigate]);


  useEffect(() => { trackEvent('checkout_open', { plan_id: planId, slug }); }, [planId, slug]);

  useEffect(() => {
    if (!selectedProvider) return;
    const obj = providers.find(p => p.id === selectedProvider);
    if (obj) trackEvent('checkout_payment_method_select', { method: obj.provider_type });
  }, [selectedProvider, providers]);

  useEffect(() => {
    if (resultDialog?.open && resultDialog?.success === false) {
      trackEvent('checkout_failure', { reason: resultDialog.message || 'unknown', plan_id: planId });
    }
  }, [resultDialog?.open, resultDialog?.success, resultDialog?.message, planId]);

  const remittanceReqIdRef = useRef<string>(
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`,
  );
  const submittingRef = useRef(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);

  // ACpay cardholder form
  const [cardHolderName, setCardHolderName] = useState('');
  const [cardHolderEmail, setCardHolderEmail] = useState('');
  const [cardHolderPhone, setCardHolderPhone] = useState('');
  const [countryCode, setCountryCode] = useState('886');
  const [cardFieldErrors, setCardFieldErrors] = useState<{ name?: string; email?: string; phone?: string }>({});
  const acpayCardRef = useRef<HTMLDivElement>(null);

  const selectedProviderObj = providers.find(p => p.id === selectedProvider);
  const isAcpay = selectedProviderObj?.provider_type === 'acpay';
  const isSandbox = (selectedProviderObj?.env ?? 'production') !== 'production';

  const { getPrime: acpayGetPrime } = useAcpaySdk(isAcpay, {
    numberEl: '#portal-acpay-card-number',
    expirationDateEl: '#portal-acpay-expiry',
    ccvEl: '#portal-acpay-ccv',
  });

  // ACpay return confirm
  useSubscriptionConfirmation({
    table: 'member_subscriptions',
    userId: user?.id,
    planId,
    enabled: searchParams.get('acpay') === 'result' && !resultDialog,
    channelKey: 'acpay-portal',
    setConfirming: setIsConfirming,
    onConfirmed: (r) => setResultDialog({ open: true, success: r.success, message: r.message }),
  });

  // LINE Pay return — kept inline because it calls confirm-linepay (not part of subscription poll)
  useEffect(() => {
    const linepay = searchParams.get('linepay');
    const transactionId = searchParams.get('transactionId');
    const txOrderId = searchParams.get('orderId');

    if (linepay === 'confirm' && transactionId && !isConfirming && !resultDialog && plan) {
      const confirmPayment = async () => {
        setIsConfirming(true);
        try {
          // SECURITY: confirm-linepay 只接受 orderId + transactionId；
          // user / plan / amount / billingCycle 一律由後端從 payment_intents 反查。
          const { data, error } = await supabase.functions.invoke('confirm-linepay', {
            body: {
              transactionId,
              orderId: txOrderId || '',
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

  // ECPay return
  useSubscriptionConfirmation({
    table: 'member_subscriptions',
    userId: user?.id,
    planId,
    enabled: searchParams.get('ecpay') === 'result' && !resultDialog,
    channelKey: 'ecpay-sub',
    setConfirming: setIsConfirming,
    onConfirmed: (r) => setResultDialog({ open: true, success: r.success, message: r.message }),
  });

  const { amount: crossDiscount, reason: crossReason } = useCrossProductDiscount({ productKind: 'expert_plan' });

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
    return <CheckoutUnavailableState planId={planId} hasPlan={!!plan} />;
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
    setConsentChecked(false);
    setConsentOpen(true);
  };

  const proceedCheckout = async () => {
    if (submittingRef.current || !user || !plan || !expert) return;
    submittingRef.current = true;
    setIsProcessing(true);
    const provider = providers.find(p => p.id === selectedProvider);
    trackEvent('checkout_submit', { plan_id: planId, method: provider?.provider_type });
    gtmPush('BeginCheckout', {
      plan_id: planId,
      expert_slug: slug,
      value: typeof price === 'number' ? price : undefined,
      currency: 'TWD',
      method: provider?.provider_type,
      billing_cycle: billingCycle,
    });

    const ctx: DispatchCtx = {
      plan, expert, slug,
      userId: user.id,
      billingCycle,
      basePrice, price, totalDiscount,
      discountReason,
      upgradeFromSubscriptionId: upgradeCredit > 0 ? upgradeFromSubId : null,
      origin: window.location.origin,
    };

    try {
      let result;
      if (provider?.provider_type === 'line_pay') {
        result = await dispatchLinePay(ctx);
      } else if (provider?.provider_type === 'ecpay') {
        result = await dispatchEcpay(ctx);
      } else if (provider?.provider_type === 'acpay') {
        const v = validateAcpayCardholder({ cardHolderName, cardHolderEmail, cardHolderPhone });
        if (v.ok === false) { setCardFieldErrors(v.errors); return; }
        setCardFieldErrors({});
        let prime: string;
        try {
          prime = await acpayGetPrime();
        } catch (e: any) {
          console.error('ACpay getPrime error:', e);
          setResultDialog({ open: true, success: false, message: e.message || '信用卡資訊有誤，請確認後重試' });
          return;
        }
        result = await dispatchAcpay(ctx, {
          prime, phone: cardHolderPhone, countryCode, cardHolderName, cardHolderEmail,
        });
      } else {
        result = await dispatchRemittance(ctx, remittanceReqIdRef.current);
      }

      switch (result.kind) {
        case 'success':
          setResultDialog({ open: true, success: true });
          return;
        case 'failure':
          setResultDialog({ open: true, success: false, message: result.message, canRetry: result.canRetry });
          return;
        case 'redirect':
          window.location.href = result.url;
          return;
        case 'ecpay_form':
          submitEcpayForm(result.actionUrl, result.params);
          return;
        case 'remittance':
          setResultDialog({ open: true, success: true, message: result.message });
          navigate('/account/remittance', {
            state: { from: { pathname: window.location.pathname, search: window.location.search } },
          });
          return;
      }
    } catch (err: any) {
      console.error('Checkout error:', err);
      setResultDialog({ open: true, success: false, message: err.message || '請稍後再試', canRetry: true });
    } finally {
      setIsProcessing(false);
      submittingRef.current = false;
    }
  };

  return (
    <PortalLayout hideAppEntry hideHeader>
      {isConfirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      )}
      <div className="container py-8 md:py-12">
        <div className="max-w-4xl mx-auto">
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

              {selectedProviderObj?.provider_type === 'remittance' && (
                <RemittanceAccountCard amount={price} />
              )}
            </div>

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
                isSandbox={isSandbox}
                isProcessing={isProcessing}
                alreadySubscribed={alreadySubscribed}
                onCheckout={handleCheckout}
              />
            </div>
          </div>

          <div className="mt-8 text-center">
            <p className="text-xs text-muted-foreground">
              過去績效不代表未來表現，投資有風險，請謹慎評估。
            </p>
          </div>
        </div>
      </div>

      <CheckoutConsentDialog
        open={consentOpen}
        onOpenChange={(open) => { if (!open) setConsentOpen(false); }}
        isAdvisor={isAdvisor}
        billingCycle={billingCycle}
        consentChecked={consentChecked}
        setConsentChecked={setConsentChecked}
        onProceed={() => {
          trackEvent('checkout_consent_accept', { plan_id: planId });
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
        onRetry={() => {
          setResultDialog(null);
          // 若是支付服務回跳後失敗（含逾時 / 取消 / confirm 失敗），清掉 URL query 並回到乾淨的結帳頁，
          // 讓使用者重新選擇付款方式並送出；避免直接呼叫 proceedCheckout 時缺少 selectedProvider / 表單狀態。
          const hasReturnParams =
            searchParams.get('ecpay') ||
            searchParams.get('linepay') ||
            searchParams.get('acpay');
          if (hasReturnParams) {
            navigate(`/checkout/${slug}/${planId}`, { replace: true });
            return;
          }
          proceedCheckout();
        }}
      />
    </PortalLayout>
  );
};

function CheckoutUnavailableState({ planId, hasPlan }: { planId: string | undefined; hasPlan: boolean }) {
  const { data: status, isLoading } = usePlanExpertStatus(planId, hasPlan);
  if (isLoading) {
    return (
      <PortalLayout hideAppEntry hideHeader>
        <div className="flex justify-center items-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </PortalLayout>
    );
  }
  const reason: 'suspended' | 'missing' | 'draft' | 'other' = !hasPlan
    ? 'missing'
    : status?.expert_status === 'suspended'
      ? 'suspended'
      : status?.expert_status === 'draft'
        ? 'draft'
        : 'missing';
  return (
    <PortalLayout hideAppEntry hideHeader>
      <CheckoutUnavailable reason={reason} expertName={status?.expert_name ?? null} />
    </PortalLayout>
  );
}

export default Checkout;

