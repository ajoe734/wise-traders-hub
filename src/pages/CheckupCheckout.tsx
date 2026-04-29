import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { PortalLayout } from "@/components/layouts/PortalLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, CheckCircle2, Stethoscope, Building2, CreditCard } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useCheckupPlan } from "@/hooks/useCheckupPlans";
import { useCrossProductDiscount } from "@/hooks/useCrossProductDiscount";
import { readAttribution } from "@/hooks/useAttributionTracking";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

type Method = "ecpay" | "remittance";

export default function CheckupCheckout() {
  const { planId } = useParams<{ planId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const { data: plan, isLoading } = useCheckupPlan(planId);
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const [method, setMethod] = useState<Method>("ecpay");
  const [last5, setLast5] = useState("");
  const [payerName, setPayerName] = useState("");
  const [bank, setBank] = useState<{ bank_name: string; bank_code: string; account_number: string; account_name: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [resultDialog, setResultDialog] = useState<{ open: boolean; success: boolean; message?: string } | null>(null);

  // 收款帳號
  useEffect(() => {
    supabase.from("payment_settings").select("value").eq("key", "remittance_account").maybeSingle()
      .then(({ data }) => {
        const v = data?.value as any;
        if (v) setBank({
          bank_name: v.bank_name ?? v.bank ?? "",
          bank_code: v.bank_code ?? v.branch ?? "",
          account_number: v.account_number ?? v.account ?? "",
          account_name: v.account_name ?? v.name ?? "",
        });
      });
  }, []);

  // ECPay 回跳確認
  useEffect(() => {
    if (searchParams.get("ecpay") !== "result" || !user || !planId || resultDialog) return;
    setIsConfirming(true);
    let resolved = false;
    const check = async () => {
      const { data: existing } = await supabase
        .from("checkup_subscriptions")
        .select("id").eq("user_id", user.id).eq("plan_id", planId).eq("status", "active");
      if (existing && existing.length > 0) {
        resolved = true; setIsConfirming(false);
        setResultDialog({ open: true, success: true });
      }
    };
    check();
    const channel = supabase.channel("ck-ecpay")
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "checkup_subscriptions",
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        const row = payload.new as any;
        if (row.plan_id === planId && row.status === "active" && !resolved) {
          resolved = true; clearTimeout(timer); supabase.removeChannel(channel);
          setIsConfirming(false); setResultDialog({ open: true, success: true });
        }
      })
      .subscribe();
    const timer = setTimeout(() => {
      if (!resolved) {
        supabase.removeChannel(channel);
        setIsConfirming(false);
        setResultDialog({ open: true, success: false, message: "付款確認逾時，如已扣款請聯繫客服" });
      }
    }, 60_000);
    return () => { clearTimeout(timer); supabase.removeChannel(channel); };
  }, [searchParams, user, planId]);

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
  const { amount: crossDiscount, reason: crossReason } = useCrossProductDiscount({
    productKind: "checkup",
    checkupTier: plan.tier as "basic" | "pro",
  });
  const price = Math.max(0, basePrice - crossDiscount);

  const onSubmit = async () => {
    if (!user) { navigate("/auth/login"); return; }
    setIsProcessing(true);
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
        form.method = "POST"; form.action = data.actionUrl; form.target = "_self"; form.style.display = "none";
        for (const [k, v] of Object.entries(data.params)) {
          const input = document.createElement("input");
          input.type = "hidden"; input.name = k; input.value = String(v);
          form.appendChild(input);
        }
        document.body.appendChild(form); form.submit();
        return;
      }
      // 匯款
      if (!/^\d{5}$/.test(last5)) {
        setResultDialog({ open: true, success: false, message: "請輸入末五碼（5 位數字）" });
        return;
      }
      if (!payerName.trim()) {
        setResultDialog({ open: true, success: false, message: "請輸入匯款人姓名" });
        return;
      }
      const { error } = await supabase.functions.invoke("create-checkup-remittance", {
        body: {
          checkupPlanId: plan.id,
          billingCycle,
          last5,
          payerName: payerName.trim(),
          originalAmount: basePrice,
          discountAmount: crossDiscount,
          discountReason: crossReason,
          attribution,
        },
      });
      if (error) {
        setResultDialog({ open: true, success: false, message: "送出失敗，請稍後再試" });
        return;
      }
      setResultDialog({ open: true, success: true, message: "已送出匯款資料，後台確認後將為您開通。" });
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
                  <p className="text-xs text-muted-foreground">信用卡 / ATM / 超商</p>
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
          <Card>
            <CardContent className="p-5 space-y-4">
              <div className="text-sm space-y-1">
                <p className="font-medium">收款帳號</p>
                {bank && (bank.bank_name || bank.account_number) ? (
                  <div className="text-muted-foreground space-y-0.5">
                    <p>銀行：{bank.bank_name || "—"}{bank.bank_code ? `（${bank.bank_code}）` : ""}</p>
                    <p>戶名：{bank.account_name || "—"}</p>
                    <p>帳號：<span className="font-mono">{bank.account_number || "—"}</span></p>
                  </div>
                ) : (
                  <p className="text-muted-foreground">收款帳號尚未設定，請聯絡客服。</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="payer">匯款人姓名</Label>
                <Input id="payer" value={payerName} onChange={(e) => setPayerName(e.target.value)} placeholder="您的姓名" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="last5">轉出帳號末五碼</Label>
                <Input id="last5" inputMode="numeric" maxLength={5} value={last5}
                  onChange={(e) => setLast5(e.target.value.replace(/\D/g, ""))} placeholder="例如 12345" />
                <p className="text-xs text-muted-foreground">後台會比對末五碼後幫您開通。</p>
              </div>
            </CardContent>
          </Card>
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

        <Button className="w-full" size="lg" onClick={onSubmit} disabled={isProcessing}>
          {isProcessing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />處理中…</> :
            method === "ecpay" ? "前往付款" : "送出匯款資料"}
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
                setResultDialog(null);
                if (resultDialog?.success) navigate("/free-checkup");
              }}>確定</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </PortalLayout>
  );
}
