import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PermissionTooltip } from '@/components/admin/PermissionTooltip';
import { ALL_ASSET_CLASSES, getAssetSpec, type AssetClass } from '@/lib/asset';

interface Props {
  assetClass: AssetClass;
  setAssetClass: (v: AssetClass) => void;
  isReadOnly: boolean;
  /** 已發布過 signal 後資產類別會被資料庫 trigger 鎖死 */
  locked?: boolean;
  /** 只有 company_admin 才顯示「重置為其他資產類別」 */
  isCompanyAdmin?: boolean;
  /** 呼叫 admin_reset_expert_asset_class RPC；成功後父層會 invalidate 快取 */
  onReset?: (next: AssetClass) => Promise<void> | void;
  resetting?: boolean;
}

/**
 * 資產類別選擇器：影響 SignalEditor / 前後台所有金額顯示、代碼驗證、數量單位與報價來源。
 * 一旦該分析師已發布任何 expert_signal，DB trigger 將擋下 asset_class 變更。
 * 幣別（TWD/USD）會由後端 trigger 依 asset_class 自動同步。
 *
 * 若 locked 且為 company_admin，額外提供「重置為其他資產類別」按鈕：
 * 會將舊訊號 status→archived，並清空 starting_capital。
 */
export default function CurrencyCard({
  assetClass, setAssetClass, isReadOnly, locked,
  isCompanyAdmin, onReset, resetting,
}: Props) {
  const disabled = isReadOnly || locked;
  const spec = getAssetSpec(assetClass);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState<AssetClass>(assetClass);
  const canReset = !!locked && !!isCompanyAdmin && !!onReset;

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

        {canReset && (
          <div className="mt-3 rounded border border-destructive/40 bg-destructive/5 p-3 space-y-2">
            <p className="text-xs text-destructive">
              管理員專用：如需將此分析師整個切換到其他資產類別（例如台股 → 美股），
              可在此重置。舊訊號會封存（<code>status=archived</code>）、起始資金會被清空以便重設。
            </p>
            <div className="flex items-center gap-2">
              <Select
                value={pending}
                onValueChange={(v) => setPending(v as AssetClass)}
                disabled={resetting}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALL_ASSET_CLASSES.filter((a) => a !== assetClass).map((a) => {
                    const s = getAssetSpec(a);
                    return (
                      <SelectItem key={a} value={a}>
                        重置為 {s.label}（{s.currency}）
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={resetting || pending === assetClass}
                onClick={() => setConfirmOpen(true)}
              >
                {resetting ? '重置中…' : '重置'}
              </Button>
            </div>
          </div>
        )}

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>確定要重置資產類別？</AlertDialogTitle>
              <AlertDialogDescription>
                將把此分析師從 <strong>{spec.label}</strong> 切換為{' '}
                <strong>{getAssetSpec(pending).label}</strong>。
                <br />
                • 過去所有 {spec.label} 訊號 / 週記會被封存（保留可查、不再計入使用中）
                <br />
                • 起始資金會被清空，切換後老師需重設 {getAssetSpec(pending).currency} 的本金
                <br />
                • 此操作會寫入 audit_logs，且不可逆
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={resetting}>取消</AlertDialogCancel>
              <AlertDialogAction
                disabled={resetting}
                onClick={async () => {
                  await onReset?.(pending);
                  setConfirmOpen(false);
                }}
              >
                確認重置
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
