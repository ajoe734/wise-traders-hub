import { SEO } from '@/components/SEO';
import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { UnifiedAppLayout } from "@/components/layouts/UnifiedAppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Check, Shield, Lock, CheckCircle2, XCircle, CreditCard } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePlan } from "@/hooks/useExpertPlans";
import { usePlanExpertStatus } from "@/hooks/checkout/usePlanExpertStatus";
import { CheckoutUnavailable } from "@/components/checkout/CheckoutUnavailable";
import { useAcpaySdk } from "@/hooks/checkout/useAcpaySdk";
import { useSubscriptionConfirmation } from "@/hooks/checkout/useSubscriptionConfirmation";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { avatarUrl } from "@/lib/imageTransform";
import { gtmPush } from "@/lib/analytics/gtm";
import { track } from "@/lib/analytics/events";
import { toast } from "sonner";
import { RemittanceAccountCard } from "@/pages/_remittance/RemittanceAccountCard";

type PaymentMethod = "line_pay" | "ecpay" | "acpay" | "remittance";


const AppCheckout = () => {
  const { slug, planId } = useParams<{ slug: string; planId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Single auth source — replaces 7 separate `supabase.auth.getUser()` round-trips
  // that previously fired in every effect/handler.
  const { user } = useAuth();
  
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">(
    searchParams.get("billingCycle") === "yearly" || searchParams.get("cycle") === "yearly"
      ? "yearly"
      : "monthly"
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(() => {
    const m = (searchParams.get("method") || "").toLowerCase();
    if (m === "ecpay") return "ecpay";
    if (m === "acpay") return "acpay";
    if (m === "remittance" || m === "atm") return "remittance";
    if (m === "linepay" || m === "line_pay") return "line_pay";
    return "remittance";
  });
  const [providers, setProviders] = useState<Array<{ id: string; provider_type: string; is_active: boolean; is_default?: boolean; sort_order?: number | null }>>([]);
  useEffect(() => {
    (async () => {
      // Use the safe view (accessible to authenticated users; base table is admin-only via RLS)
      const { data } = await supabase
        .from("payment_providers_safe")
        .select("id, provider_type, is_active, is_default")
        .eq("is_active", true)
        .order("is_default", { ascending: false })
        .order("display_name", { ascending: true });
      const list = ((data as any) || []) as Array<{ id: string; provider_type: string; is_active: boolean; is_default?: boolean }>;
      setProviders(list);
      // 若目前選中的方式已停用，優先切到 is_default，否則第一個 active 的
      if (list.length && !list.find(p => p.provider_type === paymentMethod)) {
        const preferred = list.find(p => p.is_default) ?? list[0];
        setPaymentMethod(preferred.provider_type as PaymentMethod);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const [isProcessing, setIsProcessing] = useState(false);
  const processingLockRef = useRef(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [resultDialog, setResultDialog] = useState<{ open: boolean; success: boolean } | null>(null);
  const [pendingTimeout, setPendingTimeout] = useState(false);

  // ACpay cardholder form fields
  const [cardHolderName, setCardHolderName] = useState("");
  const [cardHolderEmail, setCardHolderEmail] = useState("");
  const [cardHolderPhone, setCardHolderPhone] = useState("");
  const [countryCode, setCountryCode] = useState("886");
  const [cardFieldErrors, setCardFieldErrors] = useState<{ name?: string; email?: string; phone?: string }>({});

  // ACpay SDK — 共用 useAcpaySdk
  const acpayCardRef = useRef<HTMLDivElement>(null);
  const { getPrime: acpayGetPrime } = useAcpaySdk(paymentMethod === "acpay", {
    numberEl: "#acpay-card-number",
    expirationDateEl: "#acpay-expiry",
    ccvEl: "#acpay-ccv",
  });

  const [existingSubscription, setExistingSubscription] = useState<boolean | null>(null);

  const { data: planData, isLoading } = usePlan(planId);
  const expert = planData?.experts as any;

  // 進頁追蹤：對齊 /checkout 的內部漏斗
  useEffect(() => { track('checkout_open', { plan_id: planId, expert_slug: slug }); }, [planId, slug]);

  // ISSUE-006: Check for existing active subscription
  useEffect(() => {
    const checkExisting = async () => {
      if (!user || !planId) return;
      const nowIso = new Date().toISOString();
      const { data } = await supabase
        .from('member_subscriptions')
        .select('id, expires_at')
        .eq('user_id', user.id)
        .eq('plan_id', planId)
        .eq('status', 'active')
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
        .maybeSingle();
      setExistingSubscription(!!data);
    };
    checkExisting();
  }, [planId, user]);

  // ECPay 回跳確認 — 共用 hook
  useSubscriptionConfirmation({
    table: 'member_subscriptions',
    userId: user?.id,
    planId,
    enabled: searchParams.get('ecpay') === 'result' && !resultDialog,
    channelKey: 'ecpay-app',
    setConfirming: setIsConfirming,
    onConfirmed: (r) => {
      setResultDialog({ open: true, success: r.success });
      if (!r.success) setPendingTimeout(true);
    },
  });

  // ACpay 回跳確認 — 共用 hook
  useSubscriptionConfirmation({
    table: 'member_subscriptions',
    userId: user?.id,
    planId,
    enabled: searchParams.get('acpay') === 'result' && !resultDialog,
    channelKey: 'acpay-app',
    setConfirming: setIsConfirming,
    onConfirmed: (r) => {
      setResultDialog({ open: true, success: r.success });
      if (!r.success) setPendingTimeout(true);
    },
  });

  // GTM Purchase event + 自動導回 /app + 成功 toast
  useEffect(() => {
    if (resultDialog?.open && resultDialog?.success) {
      gtmPush('Purchase', {
        plan_id: planId,
        expert_slug: slug,
        currency: 'TWD',
        billing_cycle: billingCycle,
        method: paymentMethod,
      });
      track('checkout_success', { plan_id: planId });
      toast.success('訂閱成功，可在「我的服務」中看到。');
      navigate('/app', { replace: true });
    } else if (resultDialog?.open && !resultDialog?.success) {
      track('checkout_failure', { reason: 'payment_failed', plan_id: planId });
    }
  }, [resultDialog?.open, resultDialog?.success, planId, slug, billingCycle, paymentMethod, navigate]);




  // LINE Pay return (confirm flow) — 仍維持原本的 edge function 確認
  useEffect(() => {
    const linepay = searchParams.get("linepay");
    const transactionId = searchParams.get("transactionId");
    const txOrderId = searchParams.get("orderId");

    if (linepay === "confirm" && transactionId && !isConfirming && !resultDialog && planData) {
      confirmLinePayPayment(transactionId, txOrderId || "");
    } else if (linepay === "cancel") {
      setResultDialog({ open: true, success: false });
    }
  }, [searchParams, planData]);

  const confirmLinePayPayment = async (transactionId: string, orderId: string) => {
    setIsConfirming(true);
    try {
      // SECURITY: confirm-linepay 只接受 orderId + transactionId（後端反查 payment_intents）
      const { data, error } = await supabase.functions.invoke("confirm-linepay", {
        body: { transactionId, orderId },
      });
      if (error || !data?.success) { setResultDialog({ open: true, success: false }); } else { setResultDialog({ open: true, success: true }); }
    } catch { setResultDialog({ open: true, success: false }); } finally { setIsConfirming(false); }
  };

  // ECPay return handler — removed, now handled by useSubscriptionConfirmation above


  if (isLoading) {
    return <UnifiedAppLayout><div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div></UnifiedAppLayout>;
  }

  if (!planData || !expert) {
    return <AppCheckoutUnavailableState planId={planId} hasPlan={!!planData} onBack={() => navigate("/app/explore")} />;
  }


  const monthlyPrice = planData.price_monthly;
  const yearlyPrice = planData.price_yearly || monthlyPrice * 12;
  const yearlyDiscount = Math.round((1 - yearlyPrice / (monthlyPrice * 12)) * 100);
  const currentPrice = billingCycle === "monthly" ? monthlyPrice : yearlyPrice;
  const billingLabel = billingCycle === "monthly" ? "/月" : "/年";

  // ACpay return handler — removed, now handled by useSubscriptionConfirmation above


  const handleCheckout = async () => {
    // NEW-004: Ref-based lock prevents double submission even if React state lags
    if (processingLockRef.current) return;
    processingLockRef.current = true;
    setIsProcessing(true);
    // GTM BeginCheckout — fires once per submit attempt
    gtmPush('BeginCheckout', {
      plan_id: planId,
      expert_slug: slug,
      value: currentPrice,
      currency: 'TWD',
      method: paymentMethod,
      billing_cycle: billingCycle,
    });
    track('checkout_submit', { plan_id: planId, method: paymentMethod });
    try {
      if (paymentMethod === "ecpay") { await handleEcpayCheckout(); }
      else if (paymentMethod === "acpay") { await handleAcpayCheckout(); }
      else if (paymentMethod === "remittance") { await handleRemittanceCheckout(); }
      else { await handleLinePayCheckout(); }
    } catch { setResultDialog({ open: true, success: false }); } finally {
      setIsProcessing(false);
      processingLockRef.current = false;
    }
  };

  const handleRemittanceCheckout = async () => {
    const clientRequestId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;
    const { data, error } = await supabase.functions.invoke("create-expert-remittance", {
      body: {
        planId,
        billingCycle,
        originalAmount: currentPrice,
        discountAmount: 0,
        clientRequestId,
      },
    });
    if (error || !data?.orderId) {
      toast.error("建立匯款訂單失敗，請稍後再試");
      setResultDialog({ open: true, success: false });
      return;
    }
    toast.success("已建立匯款訂單，請完成轉帳後補填末五碼");
    navigate("/account/remittance", {
      state: { from: { pathname: `/app/checkout/${slug}/${planId}`, search: window.location.search } },
    });
  };


  const handleLinePayCheckout = async () => {
    const { data, error } = await supabase.functions.invoke("create-linepay-order", {
      body: { planId, billingCycle, slug, amount: currentPrice, planName: planData.name, expertName: expert.name, origin: window.location.origin, userId: user?.id || null },
    });
    if (error || !data?.paymentUrl) { setResultDialog({ open: true, success: false }); return; }
    window.location.href = data.paymentUrl;
  };

  const handleEcpayCheckout = async () => {
    const { data, error } = await supabase.functions.invoke("create-ecpay-order", {
      body: { planId, billingCycle, slug, amount: currentPrice, planName: planData.name, expertName: expert.name, origin: window.location.origin, userId: user?.id || null },
    });
    if (error || !data?.actionUrl || !data?.params) { setResultDialog({ open: true, success: false }); return; }
    const form = document.createElement("form");
    form.method = "POST"; form.action = data.actionUrl; form.target = "_top"; form.style.display = "none";
    for (const [key, value] of Object.entries(data.params)) {
      const input = document.createElement("input"); input.type = "hidden"; input.name = key; input.value = String(value); form.appendChild(input);
    }
    document.body.appendChild(form); form.submit(); document.body.removeChild(form);
  };

  const handleAcpayCheckout = async () => {
    // Validate cardholder fields
    const cErrors: { name?: string; email?: string; phone?: string } = {};
    if (!cardHolderName.trim()) cErrors.name = "請輸入英文姓名";
    else if (!/^[a-zA-Z\s]+$/.test(cardHolderName.trim())) cErrors.name = "姓名須為英文字母";
    if (!cardHolderEmail.trim()) cErrors.email = "請輸入電子郵件";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cardHolderEmail.trim())) cErrors.email = "電子郵件格式不正確";
    if (!cardHolderPhone.trim()) cErrors.phone = "請輸入手機號碼";
    else if (!/^\d{9,10}$/.test(cardHolderPhone.trim())) cErrors.phone = "手機號碼須為 9-10 位數字";
    if (Object.keys(cErrors).length > 0) {
      setCardFieldErrors(cErrors);
      return;
    }
    setCardFieldErrors({});

    let prime: string;
    try {
      prime = await acpayGetPrime();
    } catch (e: any) {
      console.error("ACpay getPrime error:", e);
      setCardFieldErrors({ name: e.message || "信用卡資訊有誤，請確認後重試" });
      return;
    }

    const { data, error } = await supabase.functions.invoke("create-acpay-order", {
      body: {
        prime,
        amount: currentPrice,
        phone: cardHolderPhone,
        countryCode,
        cardHolderName,
        cardHolderEmail,
        planId,
        billingCycle,
        userId: user?.id || null,
        origin: window.location.origin,
        slug,
        planName: planData.name,
        expertName: expert.name,
      },
    });

    if (error) {
      console.error("ACpay checkout error:", error);
      setResultDialog({ open: true, success: false });
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

    setResultDialog({ open: true, success: false });
  };

  if (isConfirming) {
    return <UnifiedAppLayout><div className="flex flex-col items-center justify-center py-16 gap-4"><span className="animate-spin text-3xl">⏳</span><p className="text-muted-foreground">正在確認付款結果...</p></div></UnifiedAppLayout>;
  }

  return (
    <UnifiedAppLayout>
      <SEO
        title={`確認訂閱 ${planData?.name || ''}｜${expert?.name || ''} | legendflow`}
        description={`確認訂閱 ${expert?.name || ''} 的「${planData?.name || ''}」方案並完成付款。`}
        path={`/app/checkout/${slug || ''}/${planId || ''}`}
        noindex
      />
      <div className="p-4 space-y-6 pb-24">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/app/expert/${slug}`)} className="gap-2 -ml-2"><ArrowLeft className="h-4 w-4" />返回方案</Button>

        <div className="text-center">
          <h1 className="text-xl font-bold">確認訂閱</h1>
          <p className="text-sm text-muted-foreground mt-1">請確認您的訂閱內容</p>
        </div>

        <Card><CardContent className="p-4">
          <div className="flex items-center gap-3 mb-4">
            <Avatar className="h-12 w-12"><AvatarImage src={avatarUrl(expert.avatar_url, 96)} alt={expert.name} loading="lazy" decoding="async" className="object-[center_15%]" /><AvatarFallback>{expert.name[0]}</AvatarFallback></Avatar>
            <div><p className="font-semibold">{expert.name}</p><p className="text-sm text-muted-foreground">{planData.name}</p></div>
          </div>
        </CardContent></Card>

        <div>
          <h2 className="text-sm font-medium mb-3">選擇付款週期</h2>
          <div className="grid grid-cols-2 gap-3">
            <Card className={`cursor-pointer transition-all ${billingCycle === "monthly" ? "border-primary ring-2 ring-primary/20" : "hover:border-muted-foreground/30"}`} onClick={() => setBillingCycle("monthly")}>
              <CardContent className="p-4 text-center">
                <p className="font-semibold">月繳</p>
                <p className="text-lg font-bold">NT$ {monthlyPrice.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">/月</p>
              </CardContent>
            </Card>
            <Card className={`cursor-pointer transition-all relative ${billingCycle === "yearly" ? "border-primary ring-2 ring-primary/20" : "hover:border-muted-foreground/30"}`} onClick={() => setBillingCycle("yearly")}>
              {yearlyDiscount > 0 && <Badge className="absolute -top-2 -right-2 text-xs">省 {yearlyDiscount}%</Badge>}
              <CardContent className="p-4 text-center">
                <p className="font-semibold">年繳</p>
                <p className="text-lg font-bold">NT$ {yearlyPrice.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">/年</p>
              </CardContent>
            </Card>
          </div>
        </div>

        <Card className="bg-muted/50"><CardContent className="p-4">
          <div className="flex items-center justify-between mb-4"><span className="text-muted-foreground">訂閱方案</span><span>{planData.name}</span></div>
          <div className="flex items-center justify-between mb-4"><span className="text-muted-foreground">付款週期</span><span>{billingCycle === "monthly" ? "月繳" : "年繳"}</span></div>
          <div className="border-t pt-4"><div className="flex items-center justify-between"><span className="font-semibold">總計</span><span className="text-xl font-bold">NT$ {currentPrice.toLocaleString()}{billingLabel}</span></div></div>
        </CardContent></Card>

        <div>
          <h2 className="text-sm font-medium mb-3">選擇付款方式</h2>
          <div className="grid grid-cols-2 gap-3">
            {(() => {
              const meta: Record<string, { key: PaymentMethod; label: string; desc?: string }> = {
                line_pay: { key: "line_pay", label: "LINE Pay" },
                ecpay: { key: "ecpay", label: "綠界 ECPay", desc: "信用卡" },
                remittance: { key: "remittance", label: "銀行匯款", desc: "轉帳後補填末五碼" },
                acpay: { key: "acpay", label: "ACpay", desc: "信用卡" },
              };
              const list = providers
                .map(p => meta[p.provider_type])
                .filter(Boolean);
              if (list.length === 0) {
                return (
                  <div className="col-span-2 text-sm text-muted-foreground border rounded-md p-4 text-center">
                    目前沒有可用的付款方式，請聯繫客服。
                  </div>
                );
              }
              return list.map(m => (

                <Card
                  key={m.key}
                  className={`cursor-pointer transition-all ${paymentMethod === m.key ? "border-primary ring-2 ring-primary/20" : "hover:border-muted-foreground/30"}`}
                  onClick={() => setPaymentMethod(m.key)}
                >
                  <CardContent className="p-4 text-center">
                    <p className="font-semibold text-sm">{m.label}</p>
                    {m.desc && <p className="text-xs text-muted-foreground">{m.desc}</p>}
                  </CardContent>
                </Card>
              ));
            })()}
          </div>
        </div>

        {paymentMethod === "remittance" && (
          <div className="space-y-2">
            <RemittanceAccountCard amount={currentPrice} />
            <div className="text-xs text-muted-foreground leading-relaxed border rounded-md p-3 bg-muted/30 space-y-1">
              <p>1. 按下「建立匯款訂單」後，我們會為您產生一筆訂單。</p>
              <p>2. 於 3 日內完成銀行轉帳（金額請務必與訂單一致）。</p>
              <p>3. 至「帳號 → 我的匯款訂單」補填匯款人姓名與轉出帳號末五碼，後台對帳後即開通。</p>
            </div>
          </div>
        )}


        {/* ACpay cardholder info + card fields */}
        {paymentMethod === "acpay" && (
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <CreditCard className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-medium">信用卡資訊</h3>
              </div>

              {/* ACpay SDK renders card input fields here */}
              <div ref={acpayCardRef} className="space-y-3">
                <div>
                  <Label htmlFor="acpay-card-number" className="text-xs text-muted-foreground">卡號</Label>
                  <div id="acpay-card-number" className="h-10 border rounded-md border-input bg-background px-3 py-2" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="acpay-expiry" className="text-xs text-muted-foreground">有效日期</Label>
                    <div id="acpay-expiry" className="h-10 border rounded-md border-input bg-background px-3 py-2" />
                  </div>
                  <div>
                    <Label htmlFor="acpay-ccv" className="text-xs text-muted-foreground">安全碼</Label>
                    <div id="acpay-ccv" className="h-10 border rounded-md border-input bg-background px-3 py-2" />
                  </div>
                </div>
              </div>

              <div className="border-t pt-4 space-y-3">
                <h4 className="text-xs font-medium text-muted-foreground">持卡人資訊</h4>
                <div>
                  <Label htmlFor="card-holder-name" className="text-xs text-muted-foreground">英文姓名（如卡片上所示）</Label>
                  <Input
                    id="card-holder-name"
                    value={cardHolderName}
                    onChange={(e) => { setCardHolderName(e.target.value); setCardFieldErrors(prev => ({ ...prev, name: undefined })); }}
                    placeholder="WANG DA MING"
                    className={`mt-1 ${cardFieldErrors.name ? "border-destructive" : ""}`}
                  />
                  {cardFieldErrors.name && <p className="text-xs text-destructive mt-1">{cardFieldErrors.name}</p>}
                </div>
                <div>
                  <Label htmlFor="card-holder-email" className="text-xs text-muted-foreground">電子郵件</Label>
                  <Input
                    id="card-holder-email"
                    type="email"
                    value={cardHolderEmail}
                    onChange={(e) => { setCardHolderEmail(e.target.value); setCardFieldErrors(prev => ({ ...prev, email: undefined })); }}
                    placeholder="example@mail.com"
                    className={`mt-1 ${cardFieldErrors.email ? "border-destructive" : ""}`}
                  />
                  {cardFieldErrors.email && <p className="text-xs text-destructive mt-1">{cardFieldErrors.email}</p>}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label htmlFor="country-code" className="text-xs text-muted-foreground">國碼</Label>
                    <Input
                      id="country-code"
                      value={countryCode}
                      onChange={(e) => setCountryCode(e.target.value)}
                      placeholder="886"
                      className="mt-1"
                    />
                  </div>
                  <div className="col-span-2">
                    <Label htmlFor="card-holder-phone" className="text-xs text-muted-foreground">手機號碼（去掉前綴 0）</Label>
                    <Input
                      id="card-holder-phone"
                      value={cardHolderPhone}
                      onChange={(e) => { setCardHolderPhone(e.target.value); setCardFieldErrors(prev => ({ ...prev, phone: undefined })); }}
                      placeholder="912345678"
                      className={`mt-1 ${cardFieldErrors.phone ? "border-destructive" : ""}`}
                    />
                    {cardFieldErrors.phone && <p className="text-xs text-destructive mt-1">{cardFieldErrors.phone}</p>}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {existingSubscription && (
          <Card className="border-amber-400 bg-amber-50 dark:bg-amber-950/30">
            <CardContent className="p-4 text-center">
              <p className="font-semibold text-amber-700 dark:text-amber-400">您已訂閱此方案</p>
              <p className="text-sm text-muted-foreground mt-1">如需變更，請前往帳號頁管理訂閱</p>
              <Button variant="outline" className="mt-3" onClick={() => navigate("/app/account")}>前往帳號頁</Button>
            </CardContent>
          </Card>
        )}

        <Button className="w-full h-12 text-base" onClick={handleCheckout} disabled={isProcessing || existingSubscription === true}>
          {isProcessing ? <span className="flex items-center gap-2"><span className="animate-spin">⏳</span>處理中...</span> : <span className="flex items-center gap-2"><Lock className="h-4 w-4" />{paymentMethod === "line_pay" ? "LINE Pay 付款" : paymentMethod === "ecpay" ? "綠界付款" : paymentMethod === "remittance" ? "建立匯款訂單" : "ACpay 付款"}</span>}
        </Button>

        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground"><Shield className="h-3 w-3" /><span>SSL 加密安全付款</span></div>

        <AlertDialog open={resultDialog?.open ?? false} onOpenChange={() => {}}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                {resultDialog?.success ? <><CheckCircle2 className="h-5 w-5 text-green-500" />訂閱成功</> : pendingTimeout ? <><Loader2 className="h-5 w-5 animate-spin text-amber-500" />確認中</> : <><XCircle className="h-5 w-5 text-destructive" />訂閱失敗</>}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {resultDialog?.success ? <span>您已成功訂閱 <strong>{planData.name}</strong>。</span> : pendingTimeout ? <span>付款結果確認中，請前往帳號頁查看訂閱狀態。若已扣款但未顯示訂閱，請稍候數分鐘後重新檢查。</span> : <span>付款過程中發生問題，請稍後再試。</span>}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction onClick={() => { setResultDialog(null); setPendingTimeout(false); if (resultDialog?.success || pendingTimeout) navigate("/app/account"); else navigate("/app"); }}>
                {resultDialog?.success ? "前往戰情室" : pendingTimeout ? "前往帳號頁確認" : "關閉"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </UnifiedAppLayout>
  );
};

function AppCheckoutUnavailableState({ planId, hasPlan, onBack }: { planId: string | undefined; hasPlan: boolean; onBack: () => void }) {
  const { data: status, isLoading } = usePlanExpertStatus(planId, hasPlan);
  if (isLoading) {
    return (
      <UnifiedAppLayout>
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      </UnifiedAppLayout>
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
    <UnifiedAppLayout>
      <CheckoutUnavailable
        reason={reason}
        expertName={status?.expert_name ?? null}
        backTo="/app/explore"
        backLabel="返回探索"
      />
      <div className="flex justify-center -mt-4">
        <Button variant="ghost" onClick={onBack}>返回</Button>
      </div>
    </UnifiedAppLayout>
  );
}

export default AppCheckout;

