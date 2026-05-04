import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PortalLayout } from "@/components/layouts/PortalLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

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

function formatDate(iso: string) {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

export default function MyRemittanceOrders() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { last5: string; payerName: string; submitting: boolean }>>({});

  const load = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("remittance_orders")
      .select("id, product_kind, billing_cycle, amount, status, last5, payer_name, created_at, reject_reason")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setOrders((data as Order[]) ?? []);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id]);

  const updateDraft = (id: string, patch: Partial<{ last5: string; payerName: string; submitting: boolean }>) => {
    setDrafts((prev) => ({ ...prev, [id]: { last5: "", payerName: "", submitting: false, ...prev[id], ...patch } }));
  };

  const submit = async (id: string) => {
    const d = drafts[id] ?? { last5: "", payerName: "", submitting: false };
    if (!/^\d{5}$/.test(d.last5)) {
      toast({ title: "末五碼格式錯誤", description: "請輸入 5 位數字", variant: "destructive" });
      return;
    }
    if (!d.payerName.trim()) {
      toast({ title: "請輸入匯款人姓名", variant: "destructive" });
      return;
    }
    updateDraft(id, { submitting: true });
    const { error } = await supabase.functions.invoke("submit-remittance-info", {
      body: { orderId: id, last5: d.last5, payerName: d.payerName.trim() },
    });
    updateDraft(id, { submitting: false });
    if (error) {
      toast({ title: "送出失敗", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "已送出", description: "後台對帳完成後將為您開通。" });
    await load();
  };

  return (
    <PortalLayout hideAppEntry hideHeader>
      <div className="container max-w-2xl py-8 space-y-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2 gap-2">
          <Link to="/free-checkup"><ArrowLeft className="h-4 w-4" /> 返回</Link>
        </Button>

        <div>
          <h1 className="text-2xl font-bold">我的匯款訂單</h1>
          <p className="text-sm text-muted-foreground mt-1">完成轉帳後，請在這裡補填末五碼與匯款人姓名。</p>
        </div>

        {orders === null ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : orders.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">目前沒有匯款訂單。</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {orders.map((o) => {
              const meta = STATUS_META[o.status] ?? { label: o.status, tone: "secondary" as const };
              const isAwaiting = o.status === "awaiting_info";
              const d = drafts[o.id] ?? { last5: "", payerName: "", submitting: false };
              return (
                <Card key={o.id}>
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-0.5">
                        <p className="font-medium text-sm">
                          {o.product_kind === "checkup_plan" ? "持股健檢" : "專家方案"}
                          <span className="text-muted-foreground"> · {o.billing_cycle === "yearly" ? "年繳" : "月繳"}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">建立於 {formatDate(o.created_at)} · 訂單 {o.id.slice(0, 8)}</p>
                      </div>
                      <div className="text-right">
                        <Badge variant={meta.tone}>{meta.label}</Badge>
                        <p className="text-lg font-bold mt-1">NT$ {o.amount.toLocaleString()}</p>
                      </div>
                    </div>

                    {o.reject_reason && (
                      <p className="text-xs text-destructive">拒絕原因：{o.reject_reason}</p>
                    )}

                    {isAwaiting && (
                      <div className="border-t pt-3 space-y-3">
                        <div className="space-y-2">
                          <Label htmlFor={`payer-${o.id}`}>匯款人姓名</Label>
                          <Input id={`payer-${o.id}`} value={d.payerName}
                            onChange={(e) => updateDraft(o.id, { payerName: e.target.value })}
                            placeholder="您的姓名" />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`last5-${o.id}`}>轉出帳號末五碼</Label>
                          <Input id={`last5-${o.id}`} inputMode="numeric" maxLength={5} value={d.last5}
                            onChange={(e) => updateDraft(o.id, { last5: e.target.value.replace(/\D/g, "") })}
                            placeholder="例如 12345" />
                        </div>
                        <Button className="w-full" onClick={() => submit(o.id)} disabled={d.submitting}>
                          {d.submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />送出中…</> : "送出對帳資料"}
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
            })}
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
