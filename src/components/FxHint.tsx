import { useFxRate } from '@/hooks/useFxRate';
import { formatMoneyByCurrency, type Currency } from '@/lib/currency';
import { cn } from '@/lib/utils';

interface Props {
  /** 原始金額 */
  amount: number | null | undefined;
  /** 原始金額幣別 */
  currency: Currency | undefined;
  /** 換算目標，預設 TWD（僅 USD → TWD 有效） */
  target?: Currency;
  /** 是否顯示匯率來源 tooltip 內容（預設 true）。false 只顯示金額。 */
  showMeta?: boolean;
  className?: string;
}

/**
 * 在 USD 金額旁顯示「≈ NT$xxx（匯率 31.52，Yahoo Finance · MM/DD HH:mm）」。
 * TWD 金額或匯率未載入時不渲染。
 */
export function FxHint({ amount, currency, target = 'TWD', showMeta = true, className }: Props) {
  const { data: fx } = useFxRate('USDTWD');
  if (currency !== 'USD' || target !== 'TWD') return null;
  if (amount == null || !Number.isFinite(Number(amount))) return null;
  if (!fx) return null;

  const twd = Number(amount) * fx.rate;
  const timeStr = new Date(fx.fetchedAt).toLocaleString('zh-TW', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  return (
    <span
      className={cn('text-xs text-muted-foreground ml-1 tabular-nums', className)}
      title={showMeta ? `匯率 ${fx.rate.toFixed(4)}｜${fx.source}｜更新 ${timeStr}` : undefined}
    >
      ≈ {formatMoneyByCurrency(twd, 'TWD')}
      {showMeta && (
        <span className="ml-1 opacity-70">
          （匯率 {fx.rate.toFixed(2)}）
        </span>
      )}
    </span>
  );
}

/** 匯率狀態列（放在頁面 header 下方或 Capital 卡片內）。 */
export function FxRateFootnote({ className }: { className?: string }) {
  const { data: fx } = useFxRate('USDTWD');
  if (!fx) return null;
  const timeStr = new Date(fx.fetchedAt).toLocaleString('zh-TW', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  return (
    <p className={cn('text-xs text-muted-foreground', className)}>
      USD/TWD 匯率 <span className="font-medium tabular-nums">{fx.rate.toFixed(4)}</span>
      　來源：{fx.source}　更新：{timeStr}
    </p>
  );
}
