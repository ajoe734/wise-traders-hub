import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, Loader2, Send, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PermissionTooltip } from '@/components/admin/PermissionTooltip';
import { InstrumentTooltip } from '@/components/InstrumentTooltip';
import type { Currency } from '@/lib/currency';
import type { AssetClass } from '@/lib/asset';
import { buildSignalRowViewModel, type SignalRowViewModel } from './useSignalRowViewModel';
import { toneClass } from './signalTone';
import { CurrencyDot } from './CurrencyDot';
import { SignalExpandedDetails } from './SignalExpandedDetails';

// ── Back-compat re-exports（保留給既有 test / 外部 import）───────────────────
export {
  pickSignalCurrency,
  pickSignalCurrencyWithSource,
  SIGNAL_CURRENCY_SOURCE_LABEL,
} from './useSignalRowViewModel';
export type { SignalCurrencySource } from './useSignalRowViewModel';

interface Props {
  signal: any;
  isMentor: boolean;
  isAdvisor: boolean;
  isReadOnly: boolean;
  expertSlug?: string;
  isExpanded: boolean;
  setExpandedId: (id: string | null) => void;
  openInstruments: Set<string>;
  addBuySignalIds: Set<string>;
  batchInfo: Map<string, { count: number }>;
  collapsedBatches: Set<string>;
  setCollapsedBatches: React.Dispatch<React.SetStateAction<Set<string>>>;
  recalling: boolean;
  repushingId: string | null;
  onRepush: (id: string) => void;
  onRecall: (id: string) => void;
  onEdit: (batchId: string) => void;
  defaultCurrency?: Currency;
  defaultAssetClass?: AssetClass | string | null;
  /** 已預先建好的 view model（避免重複計算）。若未提供則現算。 */
  viewModel?: SignalRowViewModel;
}

export function SignalRow(p: Props) {
  const vm = p.viewModel ?? buildSignalRowViewModel({
    signal: p.signal,
    isMentor: p.isMentor,
    isAdvisor: p.isAdvisor,
    openInstruments: p.openInstruments,
    addBuySignalIds: p.addBuySignalIds,
    batchInfo: p.batchInfo,
    collapsedBatches: p.collapsedBatches,
    defaultCurrency: p.defaultCurrency,
    defaultAssetClass: p.defaultAssetClass,
  });

  const toggleBatch = () => {
    if (!vm.batchId) return;
    p.setCollapsedBatches((prev) => {
      const next = new Set(prev);
      if (next.has(vm.batchId!)) next.delete(vm.batchId!); else next.add(vm.batchId!);
      return next;
    });
  };

  return (
    <React.Fragment>
      <tr className="border-b last:border-0 hover:bg-muted/30">
        <td className="p-3 text-sm text-muted-foreground whitespace-nowrap">{vm.publishedAtText}</td>
        <td className="p-3 text-sm font-medium">
          <div className="flex items-center gap-1.5 flex-wrap">
            {vm.isTeaching ? (
              <span className="break-words [overflow-wrap:anywhere]">純教學週記</span>
            ) : vm.displayInstrument && (
              <InstrumentTooltip full={vm.displayInstrument.tooltipFull} data-testid="admin-signal-row-instrument"
                className="break-words [overflow-wrap:anywhere] font-medium">
                <span className="line-clamp-2">{vm.displayInstrument.text}</span>
              </InstrumentTooltip>
            )}
            {vm.assetBadge && (
              <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 h-4', vm.assetBadge.className)}>
                {vm.assetBadge.label}
              </Badge>
            )}
            {vm.batchBadge && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 cursor-pointer select-none"
                title={`同篇週記共 ${vm.batchBadge.count} 檔，點擊${vm.batchBadge.collapsed ? '展開' : '折疊'}`}
                onClick={toggleBatch}>
                📦 {vm.batchBadge.collapsed ? '展開' : '折疊'} {vm.batchBadge.count}
              </Badge>
            )}
          </div>
        </td>
        <td className="p-3"><Badge className={`${vm.actionMeta.className} text-xs`}>{vm.actionMeta.label}</Badge></td>
        <td className="p-3 text-sm whitespace-nowrap tabular-nums align-top">
          {vm.price ? (
            <>
              <span className="inline-flex items-baseline gap-1">
                <span>{vm.price.symbol}{vm.price.formatted}</span>
                <CurrencyDot vm={vm} />
              </span>
              {vm.price.quantityText && <span className="text-muted-foreground">（{vm.price.quantityText}）</span>}
            </>
          ) : '-'}
        </td>
        <td className="p-3 text-sm" style={{ maxWidth: '200px' }}>
          <p className="text-muted-foreground truncate overflow-hidden text-ellipsis whitespace-nowrap">{vm.reasonSummaryPreview}</p>
        </td>
        {vm.publishStatus && (
          <td className="p-3"><Badge className={cn('text-xs', toneClass(vm.publishStatus.toneKey))}>{vm.publishStatus.label}</Badge></td>
        )}
        <td className="p-3"><Badge className={cn('text-xs', toneClass(vm.holdingStatus.toneKey))}>{vm.holdingStatus.label}</Badge></td>
        <td className="p-3">
          <div className="flex items-center gap-1">
            {vm.hasDetail && (
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => p.setExpandedId(p.isExpanded ? null : vm.id)}>
                {p.isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {p.isExpanded ? '收起' : '展開'}
              </Button>
            )}
            {vm.actions.canRepush && (
              <PermissionTooltip disabled={p.isReadOnly}>
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                  onClick={() => p.onRepush(vm.id)} disabled={p.repushingId === vm.id || p.isReadOnly}
                  title="重新推送此訊號給 LINE 訂閱者（標記為「已更新」）">
                  {p.repushingId === vm.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                  重推 LINE
                </Button>
              </PermissionTooltip>
            )}
            {vm.actions.canEdit && vm.batchId && (
              <PermissionTooltip disabled={p.isReadOnly}>
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                  onClick={() => p.onEdit(vm.batchId!)} disabled={p.isReadOnly} title="編輯整批">編輯</Button>
              </PermissionTooltip>
            )}
            <PermissionTooltip disabled={p.isReadOnly}>
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
                onClick={() => p.onRecall(vm.id)} disabled={p.recalling || p.isReadOnly || vm.actions.recallDisabled}
                title={vm.actions.recallReason}>
                <Undo2 className="h-3 w-3" />收回
              </Button>
            </PermissionTooltip>
          </div>
        </td>
      </tr>
      {p.isExpanded && <SignalExpandedDetails vm={vm} as="tr" colSpan={p.isMentor ? 8 : 7} />}
    </React.Fragment>
  );
}
