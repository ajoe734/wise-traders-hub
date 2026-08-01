import { SEO } from '@/components/SEO';
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useGoBack } from "@/lib/backNav";
import { PortalLayout } from "@/components/layouts/PortalLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, Info, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { RemittanceStatusStepper } from "./_remittance/StatusStepper";
import { RemittanceAccountCard } from "@/pages/_remittance/RemittanceAccountCard";


type Order = {
  id: string;
  product_kind: string;
  billing_cycle: string;
  amount: number;
  status: string;
  last5: string | null;
  payer_name: string | null;
  created_at: string;
  reject_reason: string | null;
};

const STATUS_META: Record<string, { label: string; tone: "default" | "secondary" | "outline" | "destructive" }> = {
  awaiting_info: { label: "待補匯款資料", tone: "outline" },
  pending: { label: "待對帳", tone: "secondary" },
  confirmed: { label: "已開通", tone: "default" },
  rejected: { label: "已拒絕", tone: "destructive" },
};

const PAYER_MAX = 30;
const LAST5_RE = /^\d{5}$/;

function formatDate(iso: string) {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

type Draft = {
  last5: string;
  payerName: string;
  submitting: boolean;
  touched: { last5: boolean; payerName: boolean };
};

const EMPTY_DRAFT: Draft = {
  last5: "",
  payerName: "",
  submitting: false,
  touched: { last5: false, payerName: false },
};

export default function MyRemittanceOrders() {
  const { user } = useAuth();
  const goBack = useGoBack('/account/profile');
  const queryClient = useQueryClient();
  const { data: orders = null } = useQuery({
    queryKey: ['remittance-orders', user?.id],
    queryFn: async () => {
      if (!user) return [] as Order[];
      const { data } = await supabase
        .from("remittance_orders")
        .select("id, product_kind, billing_cycle, amount, status, last5, payer_name, created_at, reject_reason")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      return (data as Order[]) ?? [];
    },
    enabled: !!user,
    staleTime: 30_000,
  });

  const load = () => queryClient.invalidateQueries({ queryKey: ['remittance-orders', user?.id] });

  // Realtime: refetch when any of the user's remittance orders change status
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`remittance-orders-self-${user.id}`)
      .on(
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'remittance_orders', filter: `user_id=eq.${user.id}` },
        () => { load(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [submittedOnce, setSubmittedOnce] = useState<Set<string>>(new Set());
  const [showHistory, setShowHistory] = useState(false);

  // 已開通但訂閱期已過的訂單摺疊到「歷史訂單」（依 billing_cycle 由 created_at 推算）
  const { activeOrders, historicalOrders } = useMemo(() => {
    const list = orders ?? [];
    const now = Date.now();
    const active: Order[] = [];
    const history: Order[] = [];
    for (const o of list) {
      if (o.status === 'confirmed') {
        const created = new Date(o.created_at).getTime();
        const days = o.billing_cycle === 'yearly' ? 365 : 30;
        const endMs = created + days * 86400000;
        if (endMs < now) { history.push(o); continue; }
      }
      active.push(o);
    }
    return { activeOrders: active, historicalOrders: history };
  }, [orders]);

  const updateDraft = (id: string, patch: Partial<Draft>) => {
    setDrafts((prev) => {
      const curr = prev[id] ?? EMPTY_DRAFT;
      return {
        ...prev,
        [id]: {
          ...curr,
          ...patch,
          touched: { ...curr.touched, ...(patch.touched ?? {}) },
        },
      };
    });
  };

  const errorsFor = (d: Draft) => {
    const last5Err = !LAST5_RE.test(d.last5) ? '請輸入 5 位數字' : null;
    const trimmed = d.payerName.trim();
    const nameErr = !trimmed
      ? '請輸入匯款人姓名'
      : trimmed.length > PAYER_MAX
        ? `姓名請勿超過 ${PAYER_MAX} 字`
        : null;
    return { last5Err, nameErr };
  };

  const submit = async (id: string) => {
    const d = drafts[id] ?? EMPTY_DRAFT;
    const { last5Err, nameErr } = errorsFor(d);
    updateDraft(id, { touched: { last5: true, payerName: true } });
    if (last5Err || nameErr) {
      toast({ title: last5Err || nameErr || '輸入錯誤', variant: 'destructive' });
      return;
    }
    if (d.submitting || submittedOnce.has(id)) return;

    updateDraft(id, { submitting: true });
    const { error } = await supabase.functions.invoke("submit-remittance-info", {
      body: { orderId: id, last5: d.last5, payerName: d.payerName.trim() },
    });
    updateDraft(id, { submitting: false });
    if (error) {
      toast({
        title: "送出失敗",
        description: error.message,
        variant: "destructive",
        action: (
          <button
            onClick={() => submit(id)}
            className="text-xs font-medium underline-offset-2 hover:underline"
          >
            重試
          </button>
        ) as any,
      });
      return;
    }
    setSubmittedOnce((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    toast({ title: "已送出", description: "後台對帳完成後將為您開通。" });
    await load();
  };

  return (
    <PortalLayout hideAppEntry hideHeader>
      <SEO title="我的匯款訂單 | legendflow" description="查詢 legendflow 訂閱匯款訂單狀態與審核進度。" path="/account/remittance" noindex />
      <div className="container max-w-2xl py-8 space-y-6">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 gap-2"
          onClick={goBack}
        >
          <ArrowLeft className="h-4 w-4" /> 返回
        </Button>

        <div>
          <h1 className="text-2xl font-bold">我的匯款訂單</h1>
          <p className="text-sm text-muted-foreground mt-1">完成轉帳後，請在這裡補填末五碼與匯款人姓名。</p>
        </div>

        {/* Helpful notice: it's OK to leave this page */}
        <Card className="border-dashed">
          <CardContent className="p-4 flex gap-3 text-sm text-muted-foreground">
            <Info className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
            <div className="space-y-1">
              <p>請於 <b className="text-foreground">3 日內</b>完成銀行轉帳，並回到此頁補填末五碼與匯款人姓名。下方每筆未付款訂單會列出收款帳號與應匯金額。</p>
              <p>您可以<b className="text-foreground">先離開本頁</b>，稍後從「會員中心 → 我的匯款訂單」或登入後的提醒回來繼續。</p>
              <p>逾期未補資料，訂單會自動關閉，屆時請重新下單即可。</p>
            </div>
          </CardContent>
        </Card>


        {orders === null ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : orders.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">目前沒有匯款訂單。</CardContent></Card>
        ) : (
          <>
            {(() => {
              const renderCard = (o: Order) => {
                const meta = STATUS_META[o.status] ?? { label: o.status, tone: "secondary" as const };
                const isAwaiting = o.status === "awaiting_info";
                const d = drafts[o.id] ?? EMPTY_DRAFT;
                const { last5Err, nameErr } = errorsFor(d);
                const isLocked = d.submitting || submittedOnce.has(o.id);
                const disabled = isLocked || !!last5Err || !!nameErr;

                return (
                  <Card key={o.id}>
                    <CardContent className="p-5 space-y-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-0.5">
                          <p className="font-medium text-sm">
                            {o.product_kind === "checkup_plan" ? "持股健檢" : "專家方案"}
                            <span className="text-muted-foreground"> · {o.billing_cycle === "yearly" ? "年繳" : "月繳"}</span>
                          </p>
                          <p className="text-xs text-muted-foreground">建立於 {formatDate(o.created_at)} · 訂單 {o.id.slice(0, 8)}</p>
                        </div>
                        <div className="text-right">
                          <Badge variant={meta.tone} data-testid="remittance-status-badge">{meta.label}</Badge>
                          <p className="text-lg font-bold mt-1">NT$ {o.amount.toLocaleString()}</p>
                        </div>
                      </div>

                      <div className="pt-1">
                        <RemittanceStatusStepper status={o.status} />
                      </div>

                      {o.reject_reason && (
                        <p className="text-xs text-destructive">拒絕原因：{o.reject_reason}</p>
                      )}

                      {isAwaiting && (
                        <div className="border-t pt-3 space-y-3">
                          <RemittanceAccountCard amount={o.amount} orderId={o.id.slice(0, 8)} />

                          <div className="space-y-1.5">
                            <Label htmlFor={`payer-${o.id}`}>匯款人姓名</Label>
                            <Input
                              id={`payer-${o.id}`}
                              value={d.payerName}
                              maxLength={PAYER_MAX}
                              disabled={isLocked}
                              onBlur={() => updateDraft(o.id, { touched: { ...d.touched, payerName: true } })}
                              onChange={(e) => updateDraft(o.id, { payerName: e.target.value })}
                              placeholder="您的姓名"
                              aria-invalid={!!(d.touched.payerName && nameErr)}
                            />
                            {d.touched.payerName && nameErr && (
                              <p className="text-xs text-destructive">{nameErr}</p>
                            )}
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`last5-${o.id}`}>轉出帳號末五碼</Label>
                            <Input
                              id={`last5-${o.id}`}
                              inputMode="numeric"
                              maxLength={5}
                              value={d.last5}
                              disabled={isLocked}
                              onBlur={() => updateDraft(o.id, { touched: { ...d.touched, last5: true } })}
                              onChange={(e) => updateDraft(o.id, { last5: e.target.value.replace(/\D/g, "") })}
                              placeholder="例如 12345"
                              aria-invalid={!!(d.touched.last5 && last5Err)}
                            />
                            {d.touched.last5 && last5Err && (
                              <p className="text-xs text-destructive">{last5Err}</p>
                            )}
                          </div>
                          <Button className="w-full" onClick={() => submit(o.id)} disabled={disabled}>
                            {d.submitting
                              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />送出中…</>
                              : submittedOnce.has(o.id) ? '已送出，等待對帳' : '送出對帳資料'}
                          </Button>
                        </div>
                      )}

                      {!isAwaiting && (o.last5 || o.payer_name) && (
                        <p className="text-xs text-muted-foreground">
                          匯款人 {o.payer_name ?? "—"} · 末五碼 {o.last5 ?? "—"}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              };

              return (
                <>
                  {activeOrders.length > 0 ? (
                    <div className="space-y-3">{activeOrders.map(renderCard)}</div>
                  ) : (
                    <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">目前沒有進行中的匯款訂單。</CardContent></Card>
                  )}

                  {historicalOrders.length > 0 && (
                    <div className="space-y-3 pt-2">
                      <button
                        type="button"
                        onClick={() => setShowHistory((v) => !v)}
                        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                        aria-expanded={showHistory}
                      >
                        {showHistory ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        歷史訂單（{historicalOrders.length}）
                      </button>
                      {showHistory && (
                        <div className="space-y-3 opacity-80">{historicalOrders.map(renderCard)}</div>
                      )}
                    </div>
                  )}
                </>
              );
            })()}
          </>
        )}
      </div>
    </PortalLayout>
  );
}
