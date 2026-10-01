import { useEffect, useState } from 'react';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { buildHoldingEditTrade } from '@/checkup/lib/holdingEditTrade';
import { calcWeightedAvgCost } from '@/checkup/lib/holdingMath';

export default function HoldingEditDialog({ open, onOpenChange, holding, onConfirm }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  holding: { code?: string; name?: string; qty?: number; cost?: number; price?: number };
  onConfirm: (entry: ReturnType<typeof buildHoldingEditTrade> & { ok: true }) => Promise<unknown> | unknown;
}) {
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const updateProjectedCost = (nextQty: string, nextPrice: string) => {
    const oldQty = Number(holding.qty);
    const newQty = Number(nextQty);
    const tradePrice = Number(nextPrice);
    if (newQty > oldQty && oldQty > 0 && tradePrice > 0) {
      setCost(calcWeightedAvgCost(Number(holding.cost), oldQty, tradePrice, newQty - oldQty).toFixed(2));
    } else {
      setCost(String(holding.cost ?? ''));
    }
  };
  useEffect(() => {
    if (!open) return;
    setQty(String(holding.qty ?? ''));
    setCost(String(holding.cost ?? ''));
    setPrice('');
    setError('');
  }, [open, holding.code]);
  const submit = async () => {
    const result = buildHoldingEditTrade({ holding, targetQty: qty, targetCost: cost, executionPrice: price });
    if (result.ok === false) { setError(result.error); return; }
    setBusy(true);
    try {
      const response = await onConfirm(result);
      if ((response as { ok?: boolean } | undefined)?.ok === false) { setError('儲存失敗，請稍後重試'); return; }
      onOpenChange(false);
    } finally { setBusy(false); }
  };
  const inputClass = 'w-full rounded-md border border-input bg-background px-3 py-2 text-foreground tabular-nums';
  return <AlertDialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
    <AlertDialogContent data-testid="holding-edit-dialog">
      <AlertDialogHeader>
        <AlertDialogTitle>編輯持倉 {holding.code} {holding.name}</AlertDialogTitle>
        <AlertDialogDescription>股數差額會記為實際買進或賣出。成本由成交價計算；若只需修正舊成本，請在交易紀錄修改原成交價格。</AlertDialogDescription>
      </AlertDialogHeader>
      <div className="grid gap-3 text-sm">
        <label>持有股數<input className={inputClass} data-testid="holding-edit-qty" type="number" min="1" step="any" value={qty} onChange={(e) => { setQty(e.target.value); updateProjectedCost(e.target.value, price); setError(''); }} /></label>
        <label>目標每股成本（元）<input className={inputClass} data-testid="holding-edit-cost" type="number" min="0.01" step="0.01" value={cost} onChange={(e) => { setCost(e.target.value); setError(''); }} /></label>
        <label>實際成交價（元）<input className={inputClass} data-testid="holding-edit-price" type="number" min="0.01" step="0.01" value={price} onChange={(e) => { setPrice(e.target.value); updateProjectedCost(qty, e.target.value); setError(''); }} placeholder="請輸入本次成交價格" /></label>
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </div>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
        <Button data-testid="holding-edit-submit" disabled={busy} onClick={submit}>記錄成交並更新</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}