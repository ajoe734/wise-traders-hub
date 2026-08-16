import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Bank = {
  bank_name: string;
  bank_code: string;
  account_number: string;
  account_name: string;
};

async function fetchRemittanceAccount(): Promise<Bank | null> {
  const { data } = await (supabase.rpc as any)("get_remittance_account");
  const v = data as any;
  if (!v) return null;
  return {
    bank_name: v.bank_name ?? v.bank ?? "",
    bank_code: v.bank_code ?? v.branch ?? "",
    account_number: v.account_number ?? v.account ?? "",
    account_name: v.account_name ?? v.name ?? "",
  };
}

interface Props {
  amount?: number;
  orderId?: string;
  className?: string;
}

export function RemittanceAccountCard({ amount, orderId, className }: Props) {
  const { data: bank, isLoading } = useQuery({
    queryKey: ["remittance-account-info"],
    queryFn: fetchRemittanceAccount,
    staleTime: 5 * 60_000,
  });

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `已複製${label}` });
    } catch {
      toast({ title: "複製失敗，請手動選取", variant: "destructive" });
    }
  };

  const hasBank = !!bank && (bank.bank_name || bank.account_number);

  return (
    <Card className={cn("border", className)}>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">收款帳號</p>
          {orderId && (
            <p className="text-xs text-muted-foreground">訂單 {orderId}</p>
          )}
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">載入中…</p>
        ) : !hasBank ? (
          <p className="text-sm text-muted-foreground">無法顯示收款帳號，請先登入；若已登入仍看不到，請聯絡客服。</p>
        ) : (
          <div className="space-y-2 text-sm">
            <Row label="銀行" value={`${bank!.bank_name || "—"}${bank!.bank_code ? `（${bank!.bank_code}）` : ""}`} />
            <Row label="戶名" value={bank!.account_name || "—"} />
            <Row
              label="帳號"
              value={bank!.account_number || "—"}
              mono
              onCopy={bank!.account_number ? () => copy(bank!.account_number, "帳號") : undefined}
            />
            {typeof amount === "number" && amount > 0 && (
              <Row
                label="金額"
                value={`NT$ ${amount.toLocaleString()}`}
                mono
                onCopy={() => copy(String(amount), "金額")}
                emphasize
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  mono,
  emphasize,
  onCopy,
}: {
  label: string;
  value: string;
  mono?: boolean;
  emphasize?: boolean;
  onCopy?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground w-12 shrink-0">{label}</span>
      <span className={cn("flex-1 text-right truncate", mono && "font-mono", emphasize && "font-semibold")}>
        {value}
      </span>
      {onCopy && (
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 gap-1" onClick={onCopy}>
          <Copy className="h-3.5 w-3.5" />
          <span className="text-xs">複製</span>
        </Button>
      )}
    </div>
  );
}
