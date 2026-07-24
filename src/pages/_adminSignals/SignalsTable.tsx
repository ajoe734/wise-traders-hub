import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { SignalRow } from './SignalRow';
import { SignalListItem } from './SignalListItem';
import { buildSignalRowViewModel } from './useSignalRowViewModel';
import { useAdminSignalsLayout } from './breakpoints';
import type { HoldingSummaryRow } from './derive';
import { formatMoneyByCurrency, type Currency } from '@/lib/currency';
import { getAssetSpec, normalizeAssetClass, type AssetClass } from '@/lib/asset';

interface Props {
  visibleSignals: any[];
  isMentor: boolean;
  isAdvisor: boolean;
  isReadOnly: boolean;
  expertSlug?: string;
  expandedId: string | null;
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
  contentLabel: string;
  holdingSummary: HoldingSummaryRow[] | null;
  defaultCurrency?: Currency;
  defaultAssetClass?: AssetClass | string | null;
}

export function SignalsTable(p: Props) {
  const layout = useAdminSignalsLayout();
  const assetClass: AssetClass = normalizeAssetClass(p.defaultAssetClass);
  const spec = getAssetSpec(assetClass);

  // 建立 view models（唯一資料入口）
  const viewModels = React.useMemo(() => p.visibleSignals.map((signal) =>
    buildSignalRowViewModel({
      signal, isMentor: p.isMentor, isAdvisor: p.isAdvisor,
      openInstruments: p.openInstruments, addBuySignalIds: p.addBuySignalIds,
      batchInfo: p.batchInfo, collapsedBatches: p.collapsedBatches,
      defaultCurrency: p.defaultCurrency, defaultAssetClass: assetClass,
    }),
  ), [p.visibleSignals, p.isMentor, p.isAdvisor, p.openInstruments, p.addBuySignalIds, p.batchInfo, p.collapsedBatches, p.defaultCurrency, assetClass]);

  if (layout === 'table') {
    return <TableView p={p} viewModels={viewModels} assetClass={assetClass} specCurrency={spec.currency} />;
  }
  return <CardListView p={p} viewModels={viewModels} compact={layout === 'card-compact'} assetClass={assetClass} specCurrency={spec.currency} />;
}

// ─────────────────────────── Table view (≥1280px) ───────────────────────────
function TableView({ p, viewModels, assetClass, specCurrency }: {
  p: Props; viewModels: ReturnType<typeof buildSignalRowViewModel>[];
  assetClass: AssetClass; specCurrency: Currency;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full table-fixed">
            <colgroup>
              <col style={{ width: '128px' }} />
              <col style={{ minWidth: '180px', width: '22%' }} />
              <col style={{ width: '68px' }} />
              <col style={{ width: '180px' }} />
              <col style={{ minWidth: '200px', width: 'auto' }} />
              {p.isMentor && <col style={{ width: '88px' }} />}
              <col style={{ width: '96px' }} />
              <col style={{ width: '148px' }} />
            </colgroup>
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 text-xs font-medium text-muted-foreground whitespace-nowrap">時間</th>
                <th className="text-left p-3 text-xs font-medium text-muted-foreground">標的</th>
                <th className="text-left p-3 text-xs font-medium text-muted-foreground whitespace-nowrap">方向</th>
                <th className="text-left p-3 text-xs font-medium text-muted-foreground whitespace-nowrap">價位</th>
                <th className="text-left p-3 text-xs font-medium text-muted-foreground">理由</th>
                {p.isMentor && <th className="text-left p-3 text-xs font-medium text-muted-foreground whitespace-nowrap">發布狀態</th>}
                <th className="text-left p-3 text-xs font-medium text-muted-foreground whitespace-nowrap">狀態</th>
                <th className="text-left p-3 text-xs font-medium text-muted-foreground"></th>
              </tr>
            </thead>
            <tbody>
              {p.visibleSignals.length === 0 ? (
                <tr><td colSpan={p.isMentor ? 8 : 7} className="p-8 text-center text-muted-foreground text-sm">尚無{p.contentLabel}</td></tr>
              ) : p.visibleSignals.map((signal, idx) => (
                <SignalRow key={signal.id} signal={signal} viewModel={viewModels[idx]}
                  isMentor={p.isMentor} isAdvisor={p.isAdvisor} isReadOnly={p.isReadOnly} expertSlug={p.expertSlug}
                  isExpanded={p.expandedId === signal.id} setExpandedId={p.setExpandedId}
                  openInstruments={p.openInstruments} addBuySignalIds={p.addBuySignalIds}
                  batchInfo={p.batchInfo} collapsedBatches={p.collapsedBatches}
                  setCollapsedBatches={p.setCollapsedBatches}
                  recalling={p.recalling} repushingId={p.repushingId}
                  onRepush={p.onRepush} onRecall={p.onRecall} onEdit={p.onEdit}
                  defaultCurrency={p.defaultCurrency} defaultAssetClass={assetClass}
                />
              ))}
            </tbody>
            {p.holdingSummary && p.holdingSummary.length > 0 && (
              <tfoot>
                {p.holdingSummary.map(({ instrument, zhangQty, guQty, cost }) => (
                  <tr key={instrument} className="border-t bg-muted/40">
                    <td colSpan={3} className="p-3 text-sm font-medium text-muted-foreground align-top">
                      <span className="break-words [overflow-wrap:anywhere]">{instrument}</span>
                      <span className="whitespace-nowrap"> 目前持有</span>
                    </td>
                    <td colSpan={2} className="p-3 text-sm font-bold text-foreground">
                      {assetClass === 'crypto' ? <>{guQty} 顆　</> : assetClass === 'us_stock' ? <>{guQty} 股　</> : <>{zhangQty} 張　{guQty} 股　</>}
                      <span className="text-muted-foreground font-medium">成本 {formatMoneyByCurrency(cost, specCurrency)}</span>
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                ))}
              </tfoot>
            )}
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────── Card list view (<1280px) ───────────────────────────
function CardListView({ p, viewModels, compact, assetClass, specCurrency }: {
  p: Props; viewModels: ReturnType<typeof buildSignalRowViewModel>[]; compact: boolean;
  assetClass: AssetClass; specCurrency: Currency;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        {p.visibleSignals.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">尚無{p.contentLabel}</div>
        ) : (
          <div className="flex flex-col">
            {p.visibleSignals.map((signal, idx) => (
              <SignalListItem key={signal.id} vm={viewModels[idx]} compact={compact}
                isReadOnly={p.isReadOnly}
                isExpanded={p.expandedId === signal.id} setExpandedId={p.setExpandedId}
                setCollapsedBatches={p.setCollapsedBatches}
                recalling={p.recalling} repushingId={p.repushingId}
                onRepush={p.onRepush} onRecall={p.onRecall} onEdit={p.onEdit}
              />
            ))}
          </div>
        )}
        {p.holdingSummary && p.holdingSummary.length > 0 && (
          <div className="border-t border-border/40 bg-muted/40 divide-y divide-border/40">
            {p.holdingSummary.map(({ instrument, zhangQty, guQty, cost }) => (
              <div key={instrument} className="p-3 text-sm flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-medium text-muted-foreground break-words [overflow-wrap:anywhere]">{instrument} 目前持有</span>
                <span className="font-bold text-foreground">
                  {assetClass === 'crypto' ? `${guQty} 顆` : assetClass === 'us_stock' ? `${guQty} 股` : `${zhangQty} 張 ${guQty} 股`}
                </span>
                <span className="text-xs text-muted-foreground">成本 {formatMoneyByCurrency(cost, specCurrency)}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
