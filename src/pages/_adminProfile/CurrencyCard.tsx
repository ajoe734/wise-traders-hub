import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PermissionTooltip } from '@/components/admin/PermissionTooltip';

interface Props {
  currency: 'TWD' | 'USD';
  setCurrency: (v: 'TWD' | 'USD') => void;
  isReadOnly: boolean;
  /** 已發布過 signal 後幣別會被資料庫 trigger 鎖死 */
  locked?: boolean;
}

/**
 * 操作幣別選擇器：影響 SignalEditor / 前後台所有金額顯示符號與單位（張/股）。
 * 注意：一旦該分析師已發布任何 expert_signal，DB trigger 將擋下 currency 變更。
 */
export default function CurrencyCard({ currency, setCurrency, isReadOnly, locked }: Props) {
  const disabled = isReadOnly || locked;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">操作幣別</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 max-w-sm">
        <Label>計價幣別</Label>
        <PermissionTooltip disabled={isReadOnly}>
          <Select
            value={currency}
            onValueChange={(v) => setCurrency(v as 'TWD' | 'USD')}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TWD">新台幣 (TWD) — 台股</SelectItem>
              <SelectItem value="USD">美元 (USD) — 美股</SelectItem>
            </SelectContent>
          </Select>
        </PermissionTooltip>
        <p className="text-xs text-muted-foreground">
          影響資金面板、訊號編輯器與所有金額顯示的幣別符號與數量單位（張／股）。
          {locked && <span className="block mt-1 text-destructive">已有發布訊號，幣別已鎖定，無法修改。</span>}
          {!locked && <span className="block mt-1">⚠️ 發布第一筆訊號後將無法再修改幣別，請先確認。</span>}
        </p>
      </CardContent>
    </Card>
  );
}
