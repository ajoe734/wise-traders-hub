import { useState, useEffect, useRef, useCallback } from "react";
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
import { usePlan } from "@/hooks/useExpertPlans";
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

const AppCheckout = () => {
  const { slug, planId } = useParams<{ slug: string; planId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">(
    (searchParams.get("billingCycle") as "monthly" | "yearly") || "monthly"
  );
  const [paymentMethod, setPaymentMethod] = useState<"line_pay" | "ecpay" | "acpay">("line_pay");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [resultDialog, setResultDialog] = useState<{ open: boolean; success: boolean } | null>(null);

  // ACpay cardholder form fields
  const [cardHolderName, setCardHolderName] = useState("");
  const [cardHolderEmail, setCardHolderEmail] = useState("");
  const [cardHolderPhone, setCardHolderPhone] = useState("");
  const [countryCode, setCountryCode] = useState("886");

  // ACpay SDK refs
  const acpayCardRef = useRef<HTMLDivElement>(null);
  const acpaySdkLoaded = useRef(false);
  const acpayFieldsRef = useRef<any>(null);

  const { data: planData, isLoading } = usePlan(planId);
  const expert = planData?.experts as any;

  // Load ACpay JS SDK when acpay is selected
  useEffect(() => {
    if (paymentMethod !== "acpay" || acpaySdkLoaded.current) return;

    // ACpay SDK CDN — test environment
    const sdkUrl = "https://js.payloop.com.tw/sdk/v1.0/acpay.js";
    const existingScript = document.querySelector(`script[src="${sdkUrl}"]`);
    if (existingScript) {
      acpaySdkLoaded.current = true;
      initACpayFields();
      return;
    }

    const script = document.createElement("script");
    script.src = sdkUrl;
    script.async = true;
    script.onload = () => {
      acpaySdkLoaded.current = true;
      initACpayFields();
    };
    script.onerror = () => {
      console.error("Failed to load ACpay SDK");
    };
    document.head.appendChild(script);
  }, [paymentMethod]);

  const initACpayFields = useCallback(() => {
    if (!acpayCardRef.current || !(window as any).ACPay) return;

    try {
      const ACPay = (window as any).ACPay;
      // Initialize SDK with merchant config
      const fields = ACPay.setupSDK({
        // The ACpay SDK will render secure card input fields inside the container
        fields: {
          number: { element: "#acpay-card-number", placeholder: "卡號" },
          expirationDate: { element: "#acpay-expiry", placeholder: "MM/YY" },
          ccv: { element: "#acpay-ccv", placeholder: "安全碼" },
        },
      });
      acpayFieldsRef.current = fields;
    } catch (e) {
      console.error("ACpay SDK init error:", e);
    }
  }, []);

  // Handle LINE Pay return (confirm flow)
  useEffect(() => {
    const linepay = searchParams.get("linepay");
    const transactionId = searchParams.get("transactionId");
    const txOrderId = searchParams.get("orderId");
    const ecpay = searchParams.get("ecpay");
    const acpay = searchParams.get("acpay");

    if (linepay === "confirm" && transactionId && !isConfirming && !resultDialog && planData) {
      confirmLinePayPayment(transactionId, txOrderId || "");
    } else if (linepay === "cancel") {
      setResultDialog({ open: true, success: false });
    } else if (ecpay === "result") {
      handleEcpayReturn();
    } else if (acpay === "result") {
      handleAcpayReturn();
    }
  }, [searchParams, planData]);

  const confirmLinePayPayment = async (transactionId: string, orderId: string) => {
    setIsConfirming(true);
    try {
      const returnedBillingCycle = searchParams.get("billingCycle") || billingCycle;
      const currentPrice = returnedBillingCycle === "yearly" ? (planData?.price_yearly ?? 0) : (planData?.price_monthly ?? 0);
      const { data: { user } } = await supabase.auth.getUser();
      const isSimulate = searchParams.get("simulate") === "true";
      const { data, error } = await supabase.functions.invoke("confirm-linepay", {
        body: { transactionId, orderId, amount: currentPrice, planId, billingCycle: returnedBillingCycle, userId: user?.id || null, simulate: isSimulate },
      });
      if (error || !data?.success) { setResultDialog({ open: true, success: false }); } else { setResultDialog({ open: true, success: true }); }
    } catch { setResultDialog({ open: true, success: false }); } finally { setIsConfirming(false); }
  };

  const handleEcpayReturn = async () => {
    setIsConfirming(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { data: existing } = await supabase.from("member_subscriptions").select("id").eq("user_id", user.id).eq("plan_id", planId!).eq("status", "active");
      if (existing && existing.length > 0) { setResultDialog({ open: true, success: true }); return; }
      const channel = supabase
        .channel('ecpay-app-confirm')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'member_subscriptions', filter: `user_id=eq.${user.id}` }, (payload) => {
          const row = payload.new as any;
          if (row.plan_id === planId && row.status === 'active') {
            setIsConfirming(false);
            setResultDialog({ open: true, success: true });
          }
        })
        .subscribe();
      setTimeout(() => {
        supabase.removeChannel(channel);
        setIsConfirming(false);
        setResultDialog({ open: true, success: false });
      }, 60000);
    } catch { setIsConfirming(false); setResultDialog({ open: true, success: false }); }
  };

  if (isLoading) {
    return <UnifiedAppLayout><div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div></UnifiedAppLayout>;
  }

  if (!planData || !expert) {
    return (
      <UnifiedAppLayout>
        <div className="flex flex-col items-center justify-center py-16">
          <p className="text-muted-foreground">找不到此方案</p>
          <Button variant="ghost" onClick={() => navigate("/app/explore")} className="mt-4">返回探索</Button>
        </div>
      </UnifiedAppLayout>
    );
  }

  const monthlyPrice = planData.price_monthly;
  const yearlyPrice = planData.price_yearly || monthlyPrice * 12;
  const yearlyDiscount = Math.round((1 - yearlyPrice / (monthlyPrice * 12)) * 100);
  const currentPrice = billingCycle === "monthly" ? monthlyPrice : yearlyPrice;
  const billingLabel = billingCycle === "monthly" ? "/月" : "/年";

  const handleAcpayReturn = async () => {
    setIsConfirming(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { data: existing } = await supabase.from("member_subscriptions").select("id").eq("user_id", user.id).eq("plan_id", planId!).eq("status", "active");
      if (existing && existing.length > 0) { setResultDialog({ open: true, success: true }); return; }
      const channel = supabase
        .channel('acpay-app-confirm')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'member_subscriptions', filter: `user_id=eq.${user.id}` }, (payload) => {
          const row = payload.new as any;
          if (row.plan_id === planId && row.status === 'active') {
            setIsConfirming(false);
            setResultDialog({ open: true, success: true });
          }
        })
        .subscribe();
      setTimeout(() => {
        supabase.removeChannel(channel);
        setIsConfirming(false);
        setResultDialog({ open: true, success: false });
      }, 60000);
    } catch { setIsConfirming(false); setResultDialog({ open: true, success: false }); }
  };

  const handleCheckout = async () => {
    setIsProcessing(true);
    try {
      if (paymentMethod === "ecpay") { await handleEcpayCheckout(); }
      else if (paymentMethod === "acpay") { await handleAcpayCheckout(); }
      else { await handleLinePayCheckout(); }
    } catch { setResultDialog({ open: true, success: false }); } finally { setIsProcessing(false); }
  };

  const handleLinePayCheckout = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.functions.invoke("create-linepay-order", {
      body: { planId, billingCycle, slug, amount: currentPrice, planName: planData.name, expertName: expert.name, origin: window.location.origin, userId: user?.id || null },
    });
    if (error || !data?.paymentUrl) { setResultDialog({ open: true, success: false }); return; }
    window.location.href = data.paymentUrl;
  };

  const handleEcpayCheckout = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.functions.invoke("create-ecpay-order", {
      body: { planId, billingCycle, slug, amount: currentPrice, planName: planData.name, expertName: expert.name, origin: window.location.origin, userId: user?.id || null },
    });
    if (error || !data?.actionUrl || !data?.params) { setResultDialog({ open: true, success: false }); return; }
    const form = document.createElement("form");
    form.method = "POST"; form.action = data.actionUrl; form.target = "_blank"; form.style.display = "none";
    for (const [key, value] of Object.entries(data.params)) {
      const input = document.createElement("input"); input.type = "hidden"; input.name = key; input.value = String(value); form.appendChild(input);
    }
    document.body.appendChild(form); form.submit(); document.body.removeChild(form);
  };

  const handleAcpayCheckout = async () => {
    const { data: { user } } = await supabase.auth.getUser();

    // Validate cardholder fields
    if (!cardHolderName.trim() || !cardHolderEmail.trim() || !cardHolderPhone.trim()) {
      alert("請填寫持卡人資訊（英文姓名、電子郵件、手機號碼）");
      return;
    }

    let prime: string | null = null;

    // Try to get prime from ACpay SDK
    const ACPay = (window as any).ACPay;
    if (ACPay && acpayFieldsRef.current) {
      try {
        const result = await new Promise<any>((resolve, reject) => {
          ACPay.getPrime(acpayFieldsRef.current, (primeResult: any) => {
            if (primeResult.status !== 0) {
              reject(new Error(primeResult.msg || "取得 prime token 失敗"));
            } else {
              resolve(primeResult);
            }
          });
        });
        prime = result.prime;
      } catch (e: any) {
        console.error("ACpay getPrime error:", e);
        alert(e.message || "信用卡資訊有誤，請確認後重試");
        return;
      }
    } else {
      // SDK not loaded — fallback: simulate mode for testing
      console.warn("ACpay SDK not available, using simulate mode");
      prime = "SIMULATE_PRIME";
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
      <div className="p-4 space-y-6 pb-24">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/app/expert/${slug}`)} className="gap-2 -ml-2"><ArrowLeft className="h-4 w-4" />返回方案</Button>

        <div className="text-center">
          <h1 className="text-xl font-bold">確認訂閱</h1>
          <p className="text-sm text-muted-foreground mt-1">請確認您的訂閱內容</p>
        </div>

        <Card><CardContent className="p-4">
          <div className="flex items-center gap-3 mb-4">
            <Avatar className="h-12 w-12"><AvatarImage src={expert.avatar_url || '/placeholder.svg'} alt={expert.name} /><AvatarFallback>{expert.name[0]}</AvatarFallback></Avatar>
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
          <div className="grid grid-cols-3 gap-3">
            <Card className={`cursor-pointer transition-all ${paymentMethod === "line_pay" ? "border-primary ring-2 ring-primary/20" : "hover:border-muted-foreground/30"}`} onClick={() => setPaymentMethod("line_pay")}>
              <CardContent className="p-4 text-center"><p className="font-semibold text-sm">LINE Pay</p></CardContent>
            </Card>
            <Card className={`cursor-pointer transition-all ${paymentMethod === "ecpay" ? "border-primary ring-2 ring-primary/20" : "hover:border-muted-foreground/30"}`} onClick={() => setPaymentMethod("ecpay")}>
              <CardContent className="p-4 text-center"><p className="font-semibold text-sm">綠界 ECPay</p><p className="text-xs text-muted-foreground">信用卡/ATM</p></CardContent>
            </Card>
            <Card className={`cursor-pointer transition-all ${paymentMethod === "acpay" ? "border-primary ring-2 ring-primary/20" : "hover:border-muted-foreground/30"}`} onClick={() => setPaymentMethod("acpay")}>
              <CardContent className="p-4 text-center"><p className="font-semibold text-sm">ACpay</p><p className="text-xs text-muted-foreground">信用卡</p></CardContent>
            </Card>
          </div>
        </div>

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
                    onChange={(e) => setCardHolderName(e.target.value)}
                    placeholder="WANG DA MING"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="card-holder-email" className="text-xs text-muted-foreground">電子郵件</Label>
                  <Input
                    id="card-holder-email"
                    type="email"
                    value={cardHolderEmail}
                    onChange={(e) => setCardHolderEmail(e.target.value)}
                    placeholder="example@mail.com"
                    className="mt-1"
                  />
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
                      onChange={(e) => setCardHolderPhone(e.target.value)}
                      placeholder="912345678"
                      className="mt-1"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Button className="w-full h-12 text-base" onClick={handleCheckout} disabled={isProcessing}>
          {isProcessing ? <span className="flex items-center gap-2"><span className="animate-spin">⏳</span>處理中...</span> : <span className="flex items-center gap-2"><Lock className="h-4 w-4" />{paymentMethod === "line_pay" ? "LINE Pay 付款" : paymentMethod === "ecpay" ? "綠界付款" : "ACpay 付款"}</span>}
        </Button>

        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground"><Shield className="h-3 w-3" /><span>SSL 加密安全付款</span></div>

        <AlertDialog open={resultDialog?.open ?? false} onOpenChange={() => {}}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                {resultDialog?.success ? <><CheckCircle2 className="h-5 w-5 text-green-500" />訂閱成功</> : <><XCircle className="h-5 w-5 text-destructive" />訂閱失敗</>}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {resultDialog?.success ? <span>您已成功訂閱 <strong>{planData.name}</strong>。</span> : <span>付款過程中發生問題，請稍後再試。</span>}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction onClick={() => { setResultDialog(null); if (resultDialog?.success) navigate("/app"); }}>
                {resultDialog?.success ? "前往戰情室" : "關閉"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </UnifiedAppLayout>
  );
};

export default AppCheckout;
