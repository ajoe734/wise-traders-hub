import { cn } from '@/lib/utils';
import type { SignalRowViewModel } from './useSignalRowViewModel';

/**
 * 幣別來源指示器。
 * - explicit → 完全不渲染（回歸「異常標示」語意，減少價位欄視覺負擔）。
 * - 其他 → 8px amber 圓點 + tooltip。
 * 保留 `data-testid` / `data-currency` / `data-source` 契約供 E2E 與單元測試斷言。
 */
export function CurrencyDot({ vm }: { vm: SignalRowViewModel }) {
  const { code, source, isInferred, sourceLabel } = vm.currency;
  if (!isInferred) return null;
  return (
    <span
      data-testid="admin-signal-currency-source"
      data-currency={code}
      data-source={source}
      title={`幣別 ${code}（來源：${sourceLabel}）`}
      aria-label={`幣別來源：${sourceLabel}`}
      className={cn(
        'inline-block w-2 h-2 rounded-full align-middle',
        'bg-amber-400 dark:bg-amber-500',
      )}
    />
  );
}
