/**
 * HoldingDeleteDialog — 單檔持倉刪除的明確確認視窗（二選一）。
 *
 * 人類是懶惰的：很多人其實是「已經賣掉了」才來刪除。
 * 所以這裡強制二選一：
 *  1. 「記賣出並刪除」— 在交易紀錄記一筆賣出（股數／價格可改，預填全部持股＠現價），
 *     已實現損益與績效會計入這筆；全數賣出時該檔自動移出持倉。
 *  2. 「只刪除持倉」— 只把這一檔移出目前持倉，不建立賣出交易、
 *     不更動交易紀錄與資金；之後重新加入就自動恢復顯示。
 *
 * 文案硬合約：兩條路的後果必須寫清楚，使用者必須明確點擊其中一顆才會執行。
 */
import { useEffect, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { validateSellEntry, type SellEntryError } from '@/checkup/lib/holdingDeleteService';

export interface HoldingDeleteChoice {
  withSell: boolean;
  qty?: number;
  price?: number;
}

export interface HoldingDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  code: string;
  name?: string;
  /** 目前持股股數，預填「記賣出」股數；未提供時仍可手動輸入。 */
  heldQty?: number | null;
  /** 目前市價，預填「記賣出」價格；未提供時仍可手動輸入。 */
  currentPrice?: number | null;
  /** 回傳結果；`ok === false` 時由呼叫端 toast 錯誤。 */
  onConfirm: (choice: HoldingDeleteChoice) => Promise<unknown> | unknown;
}

const ERROR_COPY: Record<SellEntryError, string> = {
  'invalid-qty': '賣出股數需大於 0',
  'invalid-price': '賣出價格需大於 0',
  oversell: '', // oversell 文案需要持股數，另行組字串
};

export default function HoldingDeleteDialog({
  open,
  onOpenChange,
  code,
  name,
  heldQty = null,
  currentPrice = null,
  onConfirm,
}: HoldingDeleteDialogProps) {
  const [busy, setBusy] = useState(false);
  const [sellQty, setSellQty] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [error, setError] = useState<string | null>(null);

  // 每次開啟都重新預填：全部持股＠目前市價。
  useEffect(() => {
    if (!open) return;
    setSellQty(heldQty != null && Number.isFinite(Number(heldQty)) && Number(heldQty) > 0 ? String(Number(heldQty)) : '');
    setSellPrice(currentPrice != null && Number.isFinite(Number(currentPrice)) && Number(currentPrice) > 0 ? String(Number(currentPrice)) : '');
    setError(null);
  }, [open, heldQty, currentPrice]);

  const qtyNum = Number(sellQty);
  const priceNum = Number(sellPrice);
  const estimateOk = Number.isFinite(qtyNum) && qtyNum > 0 && Number.isFinite(priceNum) && priceNum > 0;
  const estimate = estimateOk ? Math.round(qtyNum * priceNum) : null;

  const confirmSell = async () => {
    const sellError = validateSellEntry({ qty: qtyNum, price: priceNum, heldQty: Number(heldQty) || 0 });
    if (sellError) {
      setError(sellError === 'oversell' ? `賣出股數超過目前持有 ${Number(heldQty)} 股` : ERROR_COPY[sellError]);
      return;
    }
    setBusy(true);
    try {
      await onConfirm({ withSell: true, qty: qtyNum, price: priceNum });
    } finally {
      setBusy(false);
      onOpenChange(false);
    }
  };

  const confirmRemoveOnly = async () => {
    setBusy(true);
    try {
      await onConfirm({ withSell: false });
    } finally {
      setBusy(false);
      onOpenChange(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: 92,
    padding: '6px 8px',
    border: '1px solid hsl(var(--border))',
    borderRadius: 6,
    background: 'hsl(var(--background))',
    color: 'hsl(var(--foreground))',
    fontSize: 14,
    fontVariantNumeric: 'tabular-nums',
  };

  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <AlertDialogContent data-testid="holding-delete-confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>刪除持倉 {code}{name ? ` ${name}` : ''}？</AlertDialogTitle>
          <AlertDialogDescription data-testid="holding-delete-confirm-copy" asChild>
            <div>
              <div>已經賣掉了嗎？請選擇要不要在交易紀錄記一筆賣出：</div>

              <div
                data-testid="holding-delete-sell-section"
                style={{ marginTop: 10, padding: '10px 0', borderTop: '1px solid hsl(var(--border))' }}
              >
                <div style={{ fontWeight: 600, color: 'hsl(var(--foreground))' }}>記賣出並刪除</div>
                <div style={{ marginTop: 2 }}>
                  在交易紀錄記一筆賣出，<strong>已實現損益與績效會計入這筆</strong>。
                  全數賣出時這一檔會從目前持倉移除；只賣一部分則留下剩餘股數。
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <label style={{ fontSize: 13 }}>
                    股數{' '}
                    <input
                      data-testid="holding-delete-sell-qty"
                      type="number"
                      min="1"
                      step="1"
                      value={sellQty}
                      disabled={busy}
                      onChange={(e) => { setSellQty(e.target.value); setError(null); }}
                      style={inputStyle}
                    />
                  </label>
                  <label style={{ fontSize: 13 }}>
                    價格{' '}
                    <input
                      data-testid="holding-delete-sell-price"
                      type="number"
                      min="0.01"
                      step="any"
                      value={sellPrice}
                      disabled={busy}
                      onChange={(e) => { setSellPrice(e.target.value); setError(null); }}
                      style={inputStyle}
                    />
                  </label>
                  {estimate != null && (
                    <span
                      data-testid="holding-delete-sell-estimate"
                      style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))', fontVariantNumeric: 'tabular-nums' }}
                    >
                      預估賣出 {estimate.toLocaleString()}
                    </span>
                  )}
                </div>
                {error && (
                  <div data-testid="holding-delete-error" style={{ marginTop: 6, fontSize: 13, color: 'hsl(var(--destructive))' }}>
                    {error}
                  </div>
                )}
                <button
                  type="button"
                  data-testid="holding-delete-sell"
                  disabled={busy}
                  onClick={confirmSell}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 mt-2 inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium disabled:opacity-50"
                >記賣出並刪除</button>
              </div>

              <div
                data-testid="holding-delete-remove-section"
                style={{ marginTop: 10, padding: '10px 0 0', borderTop: '1px solid hsl(var(--border))' }}
              >
                <div style={{ fontWeight: 600, color: 'hsl(var(--foreground))' }}>只刪除持倉</div>
                <div style={{ marginTop: 2 }}>
                  這只會把這一檔從「目前持倉」移除，<strong>不會建立賣出交易</strong>，
                  也不會更動你的交易紀錄、已實現損益或帳戶資金。
                  之後重新加入這一檔，就會自動恢復顯示。
                </div>
                <button
                  type="button"
                  data-testid="holding-delete-remove-only"
                  disabled={busy}
                  onClick={confirmRemoveOnly}
                  className="mt-2 inline-flex h-9 items-center justify-center rounded-md border border-input bg-transparent px-4 text-sm font-medium hover:bg-accent disabled:opacity-50"
                >只刪除，不記賣出</button>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="holding-delete-cancel" disabled={busy}>取消</AlertDialogCancel>
          {/* AlertDialogAction 在此不使用：兩條路各有明確按鈕，避免單一「確認刪除」語意含糊。 */}
          <span />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
