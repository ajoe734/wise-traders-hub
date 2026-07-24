import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, Loader2, Send, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PermissionTooltip } from '@/components/admin/PermissionTooltip';
import { InstrumentTooltip } from '@/components/InstrumentTooltip';
import type { SignalRowViewModel } from './useSignalRowViewModel';
import { toneClass } from './signalTone';
import { CurrencyDot } from './CurrencyDot';
import { SignalExpandedDetails } from './SignalExpandedDetails';

interface Props {
  vm: SignalRowViewModel;
  compact?: boolean;
  isReadOnly: boolean;
  isExpanded: boolean;
  setExpandedId: (id: string | null) => void;
  setCollapsedBatches: React.Dispatch<React.SetStateAction<Set<string>>>;
  recalling: boolean;
  repushingId: string | null;
  onRepush: (id: string) => void;
  onRecall: (id: string) => void;
  onEdit: (batchId: string) => void;
}

/**
 * 卡片形態：768–1279px 使用。三行結構：
 *   Row1 時間 · 標的 · asset · batch   │ 方向 · 狀態
 *   Row2 大字價位 + CurrencyDot · 數量 │ 理由摘要 (line-clamp:2)
 *   Row3 操作列
 * 教學卡：Row1 隱藏標的、Row2 隱藏價位。
 */
export function SignalListItem({
  vm, compact, isReadOnly, isExpanded, setExpandedId, setCollapsedBatches,
  recalling, repushingId, onRepush, onRecall, onEdit,
}: Props) {
  const padding = compact ? 'p-3 gap-2' : 'p-4 gap-3';
  const toggleBatch = () => {
    if (!vm.batchId) return;
    setCollapsedBatches((prev) => {
      const next = new Set(prev);
      if (next.has(vm.batchId!)) next.delete(vm.batchId!);
      else next.add(vm.batchId!);
      return next;
    });
  };

  return (
    <div
      data-signal-card
      data-testid="admin-signal-card"
      className={cn(
        'border-b last:border-0 flex flex-col',
        padding,
      )}
      style={{ contentVisibility: 'auto', containIntrinsicSize: '180px' } as React.CSSProperties}
    >
      {/* Row 1 */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="text-xs text-muted-foreground whitespace-nowrap">{vm.publishedAtText}</span>
          {vm.isTeaching ? (
            <span className="text-sm font-medium">純教學週記</span>
          ) : vm.displayInstrument && (
            <InstrumentTooltip full={vm.displayInstrument.tooltipFull} className="text-sm font-medium min-w-0 break-words [overflow-wrap:anywhere]">
              <span className="line-clamp-2">{vm.displayInstrument.text}</span>
            </InstrumentTooltip>
          )}
          {vm.assetBadge && (
            <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 h-4', vm.assetBadge.className)}>
              {vm.assetBadge.label}
            </Badge>
          )}
          {vm.batchBadge && (
            <Badge
              variant="secondary"
              className="text-[10px] px-1.5 py-0 h-4 cursor-pointer select-none"
              title={`同篇週記共 ${vm.batchBadge.count} 檔，點擊${vm.batchBadge.collapsed ? '展開' : '折疊'}`}
              onClick={toggleBatch}
            >
              📦 {vm.batchBadge.collapsed ? '展開' : '折疊'} {vm.batchBadge.count}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge className={cn(vm.actionMeta.className, 'text-xs')}>{vm.actionMeta.label}</Badge>
          {vm.publishStatus && <Badge className={cn('text-xs', toneClass(vm.publishStatus.toneKey))}>{vm.publishStatus.label}</Badge>}
          <Badge className={cn('text-xs', toneClass(vm.holdingStatus.toneKey))}>{vm.holdingStatus.label}</Badge>
        </div>
      </div>

      {/* Row 2 */}
      {(vm.price || !vm.isTeaching) && (
        <div className="flex items-start gap-3 flex-wrap min-w-0">
          {vm.price ? (
            <div className="flex items-baseline gap-1.5 tabular-nums whitespace-nowrap">
              <span className="text-base font-semibold">{vm.price.symbol}{vm.price.formatted}</span>
              <CurrencyDot vm={vm} />
              {vm.price.quantityText && <span className="text-xs text-muted-foreground">（{vm.price.quantityText}）</span>}
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground min-w-0 flex-1 line-clamp-2">{vm.reasonSummaryPreview}</p>
        </div>
      )}
      {vm.isTeaching && (
        <p className="text-xs text-muted-foreground line-clamp-2">{vm.reasonSummaryPreview}</p>
      )}

      {/* Row 3 */}
      <div className="flex items-center gap-1 flex-wrap">
        {vm.hasDetail && (
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setExpandedId(isExpanded ? null : vm.id)}>
            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {isExpanded ? '收起' : '展開'}
          </Button>
        )}
        {vm.actions.canRepush && (
          <PermissionTooltip disabled={isReadOnly}>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
              onClick={() => onRepush(vm.id)}
              disabled={repushingId === vm.id || isReadOnly}
              title="重新推送此訊號給 LINE 訂閱者（標記為「已更新」）"
            >
              {repushingId === vm.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              重推 LINE
            </Button>
          </PermissionTooltip>
        )}
        {vm.actions.canEdit && vm.batchId && (
          <PermissionTooltip disabled={isReadOnly}>
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
              onClick={() => onEdit(vm.batchId!)} disabled={isReadOnly} title="編輯整批">
              編輯
            </Button>
          </PermissionTooltip>
        )}
        <PermissionTooltip disabled={isReadOnly}>
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
            onClick={() => onRecall(vm.id)}
            disabled={recalling || isReadOnly || vm.actions.recallDisabled}
            title={vm.actions.recallReason}>
            <Undo2 className="h-3 w-3" />收回
          </Button>
        </PermissionTooltip>
      </div>

      {isExpanded && <SignalExpandedDetails vm={vm} as="div" />}
    </div>
  );
}
