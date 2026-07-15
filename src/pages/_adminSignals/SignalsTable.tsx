import { Card, CardContent } from '@/components/ui/card';
import { SignalRow } from './SignalRow';
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
  const assetClass: AssetClass = normalizeAssetClass(p.defaultAssetClass);
  const spec = getAssetSpec(assetClass);
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full table-fixed">
            {/*
              固定 colgroup 寬度分配，避免長 ETF 字尾（例：00631L 元大台灣50正2）
              把 標的 欄推寬、擠壓其他欄位導致對齊錯亂。
              合計為 100%，overflow-x-auto 提供小螢幕橫向捲動兜底。
            */}
            <colgroup>
              <col style={{ width: '140px' }} />
              <col style={{ minWidth: '180px', width: '22%' }} />
              <col style={{ width: '72px' }} />
              <col style={{ width: '160px' }} />
              <col style={{ minWidth: '200px', width: 'auto' }} />
              {p.isMentor && <col style={{ width: '90px' }} />}
              <col style={{ width: '90px' }} />
              <col style={{ width: '120px' }} />
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
                <tr>
                  <td colSpan={p.isMentor ? 8 : 7} className="p-8 text-center text-muted-foreground text-sm">
                    尚無{p.contentLabel}
                  </td>
                </tr>
              ) : (
                p.visibleSignals.map((signal) => (
                  <SignalRow
                    key={signal.id}
                    signal={signal}
                    isMentor={p.isMentor}
                    isAdvisor={p.isAdvisor}
                    isReadOnly={p.isReadOnly}
                    expertSlug={p.expertSlug}
                    isExpanded={p.expandedId === signal.id}
                    setExpandedId={p.setExpandedId}
                    openInstruments={p.openInstruments}
                    addBuySignalIds={p.addBuySignalIds}
                    batchInfo={p.batchInfo}
                    collapsedBatches={p.collapsedBatches}
                    setCollapsedBatches={p.setCollapsedBatches}
                    recalling={p.recalling}
                    repushingId={p.repushingId}
                    onRepush={p.onRepush}
                    onRecall={p.onRecall}
                    onEdit={p.onEdit}
                    defaultCurrency={p.defaultCurrency}
                    defaultAssetClass={assetClass}
                  />
                ))
              )}
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
                      {assetClass === 'crypto'
                        ? <>{guQty} 顆　</>
                        : assetClass === 'us_stock'
                          ? <>{guQty} 股　</>
                          : <>{zhangQty} 張　{guQty} 股　</>}
                      <span className="text-muted-foreground font-medium">
                        成本 {formatMoneyByCurrency(cost, spec.currency)}
                      </span>
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
