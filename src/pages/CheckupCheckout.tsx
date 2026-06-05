import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { PortalLayout } from "@/components/layouts/PortalLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, CheckCircle2, Stethoscope, Building2, CreditCard } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useCheckupPlan } from "@/hooks/useCheckupPlans";
import { useCrossProductDiscount } from "@/hooks/useCrossProductDiscount";
import { readAttribution } from "@/hooks/useAttributionTracking";
import { useSubscriptionConfirmation } from "@/hooks/checkout/useSubscriptionConfirmation";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { RemittanceAccountCard } from "./_remittance/RemittanceAccountCard";
import { gtmPush } from "@/lib/analytics/gtm";


type Method = "ecpay" | "remittance";

export default function CheckupCheckout() {
  const { planId } = useParams<{ planId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const { data: plan, isLoading } = useCheckupPlan(planId);
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const [method, setMethod] = useState<Method>("ecpay");
  // (removed) inline bank state — now handled by <RemittanceAccountCard />
  const [isProcessing, setIsProcessing] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [resultDialog, setResultDialog] = useState<{ open: boolean; success: boolean; message?: string; goRemittance?: boolean } | null>(null);

  // GTM Purchase event — fires once when success dialog opens
  useEffect(() => {
    if (resultDialog?.open && resultDialog?.success) {
      gtmPush('Purchase', {
        plan_id: planId,
        product: 'checkup',
        billing_cycle: billingCycle,
        currency: 'TWD',
      });
    }
  }, [resultDialog?.open, resultDialog?.success, planId, billingCycle]);

  // 收款帳號改由 <RemittanceAccountCard /> 內部 react-query 撈取


  // ECPay 回跳確認 — 共用 useSubscriptionConfirmation
  useSubscriptionConfirmation({
    table: "checkup_subscriptions",
    userId: user?.id,
    planId,
    enabled: searchParams.get("ecpay") === "result" && !resultDialog,
    channelKey: "ck-ecpay",
    setConfirming: setIsConfirming,
    onConfirmed: (r) => setResultDialog({ open: true, success: r.success, message: r.message }),
  });

  // Hooks must be called unconditionally — keep this above any early returns
  const { amount: crossDiscount, reason: crossReason } = useCrossProductDiscount({
    productKind: "checkup",
    checkupTier: (plan?.tier ?? "basic") as "basic" | "pro",
  });

  if (isLoading) {
    return (
      <PortalLayout hideAppEntry hideHeader>
        <div className="flex justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      </PortalLayout>
    );
  }
  if (!plan) {
    return (
      <PortalLayout hideAppEntry hideHeader>
        <div className="container py-12 text-center">
          <h1 className="text-2xl font-bold mb-4">找不到此健檢方案</h1>
          <Button asChild><Link to="/pricing">回方案頁</Link></Button>
        </div>
      </PortalLayout>
    );
  }

  const basePrice = billingCycle === "yearly" ? plan.price_yearly : plan.price_monthly;
  const yearlyDiscount = Math.round((1 - plan.price_yearly / (plan.price_monthly * 12)) * 100);
  const price = Math.max(0, basePrice - crossDiscount);

  const onSubmit = async () => {
    if (!user) {
      try {
        sessionStorage.setItem('redirect_after_login', `${window.location.pathname}${window.location.search}`);
      } catch {}
      navigate("/auth/login");
      return;
    }
    setIsProcessing(true);
    gtmPush('BeginCheckout', {
      plan_id: planId,
      product: 'checkup',
      method,
      billing_cycle: billingCycle,
      value: price,
      currency: 'TWD',
    });
    try {
      const attribution = readAttribution();
      if (method === "ecpay") {
        const { data, error } = await supabase.functions.invoke("create-checkup-ecpay-order", {
          body: {
            checkupPlanId: plan.id,
            billingCycle,
            amount: price,
            originalAmount: basePrice,
            discountAmount: crossDiscount,
            discountReason: crossReason,
            attribution,
            planName: plan.name,
            origin: window.location.origin,
            userId: user.id,
          },
        });
        if (error || !data?.actionUrl || !data?.params) {
          setResultDialog({ open: true, success: false, message: "建立綠界訂單失敗" });
          return;
        }
        const form = document.createElement("form");
        form.method = "POST"; form.action = data.actionUrl; form.target = "_top"; form.style.display = "none";
        for (const [k, v] of Object.entries(data.params)) {
          const input = document.createElement("input");
          input.type = "hidden"; input.name = k; input.value = String(v);
          form.appendChild(input);
        }
        document.body.appendChild(form); form.submit();
        return;
      }
      // 匯款：先建立 awaiting_info 訂單，使用者轉帳後再到「我的匯款訂單」補填末五碼/姓名
      const { error } = await supabase.functions.invoke("create-checkup-remittance", {
        body: {
          checkupPlanId: plan.id,
          billingCycle,
          originalAmount: basePrice,
          discountAmount: crossDiscount,
          discountReason: crossReason,
          attribution,
        },
      });
      if (error) {
        setResultDialog({ open: true, success: false, message: "建立匯款訂單失敗，請稍後再試" });
        return;
      }
      setResultDialog({
        open: true,
        success: true,
        goRemittance: true,
        message: "已建立匯款訂單。請於 3 日內完成銀行轉帳，再到「我的匯款訂單」補填末五碼與匯款人姓名，後台對帳後即開通。",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  if (isConfirming) {
    return (
      <PortalLayout hideAppEntry hideHeader>
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">正在確認付款結果…</p>
        </div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout hideAppEntry hideHeader>
      <div className="container max-w-2xl py-8 space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/pricing")} className="-ml-2 gap-2">
          <ArrowLeft className="h-4 w-4" /> 返回方案
        </Button>

        <div className="text-center">
          <h1 className="text-2xl font-bold">確認訂閱</h1>
          <p className="text-sm text-muted-foreground mt-1">持股健檢 · 平台自營</p>
        </div>

        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <Stethoscope className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1">
              <p className="font-semibold">{plan.name}</p>
              <p className="text-sm text-muted-foreground">{plan.description}</p>
            </div>
            <Badge variant="secondary">每月 {plan.monthly_quota} 次</Badge>
          </CardContent>
        </Card>

        <div>
          <h2 className="text-sm font-medium mb-3">選擇付款週期</h2>
          <div className="grid grid-cols-2 gap-3">
            <Card
              className={cn("cursor-pointer transition-all", billingCycle === "monthly" ? "border-primary ring-2 ring-primary/20" : "hover:border-muted-foreground/30")}
              onClick={() => setBillingCycle("monthly")}
            >
              <CardContent className="p-4 text-center">
                <p className="font-semibold">月繳</p>
                <p className="text-lg font-bold">NT$ {plan.price_monthly.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-1">／月</p>
              </CardContent>
            </Card>
            <Card
              className={cn("cursor-pointer transition-all relative", billingCycle === "yearly" ? "border-primary ring-2 ring-primary/20" : "hover:border-muted-foreground/30")}
              onClick={() => setBillingCycle("yearly")}
            >
              {yearlyDiscount > 0 && (
                <Badge className="absolute -top-2 -right-2">省 {yearlyDiscount}%</Badge>
              )}
              <CardContent className="p-4 text-center">
                <p className="font-semibold">年繳</p>
                <p className="text-lg font-bold">NT$ {plan.price_yearly.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-1">／年</p>
              </CardContent>
            </Card>
          </div>
        </div>

        <div>
          <h2 className="text-sm font-medium mb-3">付款方式</h2>
          <div className="grid grid-cols-2 gap-3">
            <Card
              className={cn("cursor-pointer transition-all", method === "ecpay" ? "border-primary ring-2 ring-primary/20" : "hover:border-muted-foreground/30")}
              onClick={() => setMethod("ecpay")}
            >
              <CardContent className="p-4 flex items-center gap-3">
                <CreditCard className="h-5 w-5" />
                <div>
                  <p className="font-semibold text-sm">綠界金流</p>
                  <p className="text-xs text-muted-foreground">信用卡</p>
                </div>
              </CardContent>
            </Card>
            <Card
              className={cn("cursor-pointer transition-all", method === "remittance" ? "border-primary ring-2 ring-primary/20" : "hover:border-muted-foreground/30")}
              onClick={() => setMethod("remittance")}
            >
              <CardContent className="p-4 flex items-center gap-3">
                <Building2 className="h-5 w-5" />
                <div>
                  <p className="font-semibold text-sm">銀行匯款</p>
                  <p className="text-xs text-muted-foreground">人工對帳開通</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {method === "remittance" && (
          <div className="space-y-3">
            <RemittanceAccountCard amount={price} />
            <Card>
              <CardContent className="p-5">
                <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground space-y-1.5 leading-relaxed">
                  <p className="font-medium text-foreground">流程說明</p>
                  <p>1. 按下下方「建立匯款訂單」後，我們會為您建立一筆訂單。</p>
                  <p>2. 請於 3 日內到上方銀行帳號完成轉帳。</p>
                  <p>3. 轉帳完成後，回到「我的匯款訂單」補填<b>匯款人姓名</b>與<b>轉出帳號末五碼</b>，後台對帳後即為您開通。</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}


        <Card>
          <CardContent className="p-5 space-y-2">
            {crossDiscount > 0 && (
              <>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>原價</span>
                  <span>NT$ {basePrice.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between text-sm text-primary">
                  <span>跨產品折扣（已訂閱專家方案）</span>
                  <span>- NT$ {crossDiscount.toLocaleString()}</span>
                </div>
              </>
            )}
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">應付金額</span>
              <span className="text-2xl font-bold">NT$ {price.toLocaleString()}</span>
            </div>
          </CardContent>
        </Card>

        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <strong>單次扣款說明</strong>：本平台採單次手動扣款，不會自動續訂。
          效期 {billingCycle === "monthly" ? "1 個月" : "1 年"} 到期後立即停用，無寬限期，需自行重新付款。
        </div>
        <label className="flex items-start gap-3 cursor-pointer">
          <Checkbox
            checked={consentChecked}
            onCheckedChange={(c) => setConsentChecked(c === true)}
            className="mt-0.5"
          />
          <span className="text-sm leading-relaxed text-muted-foreground">
            我已閱讀並同意「單次扣款、到期停權、不會自動續訂」之條款。
          </span>
        </label>

        <Button className="w-full" size="lg" onClick={onSubmit} disabled={isProcessing || !consentChecked}>
          {isProcessing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />處理中…</> :
            method === "ecpay" ? "前往付款" : "建立匯款訂單"}
        </Button>

        <AlertDialog open={!!resultDialog?.open} onOpenChange={(open) => { if (!open) setResultDialog(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                {resultDialog?.success
                  ? <><CheckCircle2 className="h-5 w-5 text-success" />完成</>
                  : "需要處理"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {resultDialog?.message ?? (resultDialog?.success ? "已開通持股健檢，立即開始使用。" : "請稍後再試或聯絡客服。")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction onClick={() => {
                const goRemit = resultDialog?.goRemittance;
                const ok = resultDialog?.success;
                setResultDialog(null);
                if (goRemit) navigate("/account/remittance");
                else if (ok) navigate("/holding-checkup");
              }}>{resultDialog?.goRemittance ? "前往補填匯款資料" : "確定"}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </PortalLayout>
  );
}
