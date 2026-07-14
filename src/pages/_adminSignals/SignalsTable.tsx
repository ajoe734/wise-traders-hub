import { Card, CardContent } from '@/components/ui/card';
import { SignalRow } from './SignalRow';
import type { HoldingSummaryRow } from './derive';
import { formatMoneyByCurrency, type Currency } from '@/lib/currency';

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
}

export function SignalsTable(p: Props) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 text-xs font-medium text-muted-foreground">時間</th>
                <th className="text-left p-3 text-xs font-medium text-muted-foreground">標的</th>
                <th className="text-left p-3 text-xs font-medium text-muted-foreground">方向</th>
                <th className="text-left p-3 text-xs font-medium text-muted-foreground">價位</th>
                <th className="text-left p-3 text-xs font-medium text-muted-foreground">理由</th>
                {p.isMentor && <th className="text-left p-3 text-xs font-medium text-muted-foreground">發布狀態</th>}
                <th className="text-left p-3 text-xs font-medium text-muted-foreground">狀態</th>
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
                  />
                ))
              )}
            </tbody>
            {p.holdingSummary && p.holdingSummary.length > 0 && (
              <tfoot>
                {p.holdingSummary.map(({ instrument, zhangQty, guQty, cost }) => (
                  <tr key={instrument} className="border-t bg-muted/40">
                    <td colSpan={3} className="p-3 text-sm font-medium text-muted-foreground">
                      {instrument} 目前持有
                    </td>
                    <td colSpan={2} className="p-3 text-sm font-bold text-foreground">
                      {zhangQty} 張　{guQty} 股　
                      <span className="text-muted-foreground font-medium">
                        成本 {cost.toLocaleString('zh-TW')} 元
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
