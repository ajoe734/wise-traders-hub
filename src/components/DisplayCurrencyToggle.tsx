import { useDisplayCurrency, type DisplayCurrencyMode } from '@/contexts/DisplayCurrencyContext';
import { cn } from '@/lib/utils';

const OPTIONS: { value: DisplayCurrencyMode; label: string }[] = [
  { value: 'auto', label: '原幣' },
  { value: 'TWD', label: 'NT$' },
  { value: 'USD', label: 'US$' },
];

/** /app 頂部顯示幣別切換（區段式按鈕）。 */
export function DisplayCurrencyToggle({ className }: { className?: string }) {
  const { mode, setMode } = useDisplayCurrency();
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-md border border-border bg-background/60 p-0.5 text-xs',
        className,
      )}
      role="group"
      aria-label="顯示幣別"
    >
      {OPTIONS.map((opt) => {
        const active = mode === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => setMode(opt.value)}
            className={cn(
              'px-2 py-1 rounded transition-colors font-medium tabular-nums',
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            title={`切換顯示幣別：${opt.label}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
