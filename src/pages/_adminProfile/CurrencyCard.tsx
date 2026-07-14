import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PermissionTooltip } from '@/components/admin/PermissionTooltip';
import { ALL_ASSET_CLASSES, getAssetSpec, type AssetClass } from '@/lib/asset';

interface Props {
  assetClass: AssetClass;
  setAssetClass: (v: AssetClass) => void;
  isReadOnly: boolean;
  /** 已發布過 signal 後資產類別會被資料庫 trigger 鎖死 */
  locked?: boolean;
}

/**
 * 資產類別選擇器：影響 SignalEditor / 前後台所有金額顯示、代碼驗證、數量單位與報價來源。
 * 一旦該分析師已發布任何 expert_signal，DB trigger 將擋下 asset_class 變更。
 * 幣別（TWD/USD）會由後端 trigger 依 asset_class 自動同步。
 */
export default function CurrencyCard({ assetClass, setAssetClass, isReadOnly, locked }: Props) {
  const disabled = isReadOnly || locked;
  const spec = getAssetSpec(assetClass);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">資產類別</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 max-w-sm">
        <Label>操作標的類型</Label>
        <PermissionTooltip disabled={isReadOnly}>
          <Select
            value={assetClass}
            onValueChange={(v) => setAssetClass(v as AssetClass)}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALL_ASSET_CLASSES.map((a) => {
                const s = getAssetSpec(a);
                return (
                  <SelectItem key={a} value={a}>
                    {s.label}（{s.currency}）
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </PermissionTooltip>
        <p className="text-xs text-muted-foreground">
          目前設定：<strong>{spec.label}</strong>，幣別 <strong>{spec.currency}</strong>，
          代碼格式 <code className="text-[11px]">{spec.symbolPlaceholder}</code>，
          單位 <strong>{spec.units.join(' / ')}</strong>。
          {locked && <span className="block mt-1 text-destructive">已有發布訊號，資產類別已鎖定，無法修改。</span>}
          {!locked && <span className="block mt-1">⚠️ 發布第一筆訊號後將無法再修改，請先確認。</span>}
        </p>
      </CardContent>
    </Card>
  );
}
