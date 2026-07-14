import { useFxRate } from '@/hooks/useFxRate';
import { formatMoneyByCurrency, type Currency } from '@/lib/currency';
import { cn } from '@/lib/utils';
import { useDisplayCurrency } from '@/contexts/DisplayCurrencyContext';

interface Props {
  /** 原始金額 */
  amount: number | null | undefined;
  /** 原始金額幣別 */
  currency: Currency | undefined;
  /** 手動指定換算目標；未指定則吃 DisplayCurrencyContext。 */
  target?: Currency;
  /** 若未指定 target，是否忽略 context、強制以 auto 行為顯示（僅 USD→TWD）。 */
  forceAuto?: boolean;
  /** 是否附上「（匯率 X.XX）」小字。 */
  showMeta?: boolean;
  className?: string;
}

/**
 * 在金額旁顯示 FX 換算。行為：
 * - 有 `target`：直接以該幣別換算（若跟 currency 相同則不顯示）。
 * - 無 `target` 且 `forceAuto=true`：僅 USD 原生時顯示 TWD hint（歷史行為）。
 * - 無 `target`：吃 `useDisplayCurrency()` 偏好，`auto` 等同 forceAuto。
 */
export function FxHint({ amount, currency, target, forceAuto, showMeta = true, className }: Props) {
  const { data: fx } = useFxRate('USDTWD');
  const { shouldShowHint } = useDisplayCurrency();

  if (amount == null || !Number.isFinite(Number(amount))) return null;
  if (!fx || !currency) return null;

  let targetCurrency: Currency;
  if (target) {
    if (target === currency) return null;
    targetCurrency = target;
  } else if (forceAuto) {
    if (currency !== 'USD') return null;
    targetCurrency = 'TWD';
  } else {
    const { show, target: t } = shouldShowHint(currency);
    if (!show) return null;
    targetCurrency = t;
  }

  const rate = Number(fx.rate);
  if (!Number.isFinite(rate) || rate <= 0) return null;

  const converted =
    currency === 'USD' && targetCurrency === 'TWD'
      ? Number(amount) * rate
      : currency === 'TWD' && targetCurrency === 'USD'
        ? Number(amount) / rate
        : null;
  if (converted == null) return null;

  const timeStr = new Date(fx.fetchedAt).toLocaleString('zh-TW', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  return (
    <span
      className={cn('text-xs text-muted-foreground ml-1 tabular-nums', className)}
      title={`匯率 USD/TWD ${rate.toFixed(4)}｜${fx.source}｜更新 ${timeStr}`}
    >
      ≈ {formatMoneyByCurrency(converted, targetCurrency)}
      {showMeta && (
        <span className="ml-1 opacity-70">
          （匯率 {rate.toFixed(2)}）
        </span>
      )}
    </span>
  );
}

/** 匯率狀態列（頁面級註腳）。 */
export function FxRateFootnote({ className }: { className?: string }) {
  const { data: fx } = useFxRate('USDTWD');
  if (!fx) return null;
  const timeStr = new Date(fx.fetchedAt).toLocaleString('zh-TW', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  return (
    <p className={cn('text-xs text-muted-foreground', className)}>
      USD/TWD 匯率 <span className="font-medium tabular-nums">{Number(fx.rate).toFixed(4)}</span>
      　來源：{fx.source}　更新：{timeStr}
    </p>
  );
}
