import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ALL_ASSET_CLASSES, getAssetSpec, resolveAssetClass, type AssetClass } from '@/lib/asset';

/**
 * 資產類別小徽章：出現在專家名稱旁，讓用戶一眼看出這則內容是 台股/美股/加密。
 */
export function AssetBadge({
  source,
  className,
}: {
  source: AssetClass | { asset_class?: string | null; currency?: string | null } | null | undefined;
  className?: string;
}) {
  const ac: AssetClass =
    typeof source === 'string' ? source : resolveAssetClass(source as any);
  const spec = getAssetSpec(ac);
  const tone: Record<AssetClass, string> = {
    tw_stock: 'bg-blue-500/10 text-blue-700 border-blue-300/60',
    us_stock: 'bg-indigo-500/10 text-indigo-700 border-indigo-300/60',
    crypto: 'bg-amber-500/10 text-amber-700 border-amber-300/60',
  };
  return (
    <Badge
      variant="outline"
      className={cn('text-[10px] px-1.5 py-0 h-5 font-medium', tone[ac], className)}
      title={`${spec.label}（${spec.currency}）`}
    >
      {spec.shortLabel}
    </Badge>
  );
}

/**
 * 資產類別過濾器：訊號牆 / 週記頂端使用。null = 全部。
 */
export function AssetFilterChips({
  value,
  onChange,
  available,
  className,
}: {
  value: AssetClass | null;
  onChange: (v: AssetClass | null) => void;
  /** 只顯示這些選項；未提供則顯示全部 3 種 */
  available?: AssetClass[];
  className?: string;
}) {
  const list = (available && available.length > 0 ? available : ALL_ASSET_CLASSES);
  if (list.length <= 1) return null;
  return (
    <div className={cn('flex items-center gap-1.5 flex-wrap', className)}>
      <ChipButton active={value === null} onClick={() => onChange(null)}>全部</ChipButton>
      {list.map((a) => {
        const spec = getAssetSpec(a);
        return (
          <ChipButton key={a} active={value === a} onClick={() => onChange(a)}>
            {spec.shortLabel}
          </ChipButton>
        );
      })}
    </div>
  );
}

function ChipButton({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'text-xs px-2.5 h-7 rounded-full border transition-colors',
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-background text-muted-foreground border-border hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
