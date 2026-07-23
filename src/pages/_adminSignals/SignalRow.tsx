import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, Loader2, Send, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PermissionTooltip } from '@/components/admin/PermissionTooltip';
import { SafeRichHtml, richHtmlPreview, PREVIEW_LIMITS } from '@/components/SafeRichHtml';
import { canRecallSignal } from '@/lib/publishingWindow';
import { actionLabels } from './actionLabels';
import { CURRENCY_SYMBOL, inferCurrencyFromInstrument, type Currency } from '@/lib/currency';
import { getAssetSpec, normalizeAssetClass, type AssetClass } from '@/lib/asset';
import { assetBadge } from '@/pages/_adminPerformance/types';
import { FxHint } from '@/components/FxHint';
import { InstrumentTooltip } from '@/components/InstrumentTooltip';

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
  /** 該分析師的預設幣別，個別 signal.currency 優先 */
  defaultCurrency?: Currency;
  /** 該分析師的資產類別，signal.asset_class 優先 */
  defaultAssetClass?: AssetClass | string | null;
}

export function SignalRow({
  signal, isMentor, isAdvisor, isReadOnly, isExpanded, setExpandedId,
  openInstruments, addBuySignalIds, batchInfo, collapsedBatches, setCollapsedBatches,
  recalling, repushingId, onRepush, onRecall, onEdit,
  defaultCurrency = 'TWD', defaultAssetClass,
}: Props) {
  const ai = actionLabels[signal.action] || actionLabels.buy;
  const hasDetail = signal.reason_detail || signal.risk_notes || signal.reason_summary || signal.learning_points;
  const isBatchCollapsed = signal.batch_id && collapsedBatches.has(signal.batch_id) && (batchInfo.get(signal.batch_id)?.count || 0) > 1;
  const recall = canRecallSignal((signal as any).published_at);
  const assetClass: AssetClass = normalizeAssetClass(signal.asset_class ?? defaultAssetClass);
  const spec = getAssetSpec(assetClass);
  const currency: Currency = normalizeCurrency(signal.currency) || spec.currency || defaultCurrency;
  const priceSymbol = CURRENCY_SYMBOL[currency];
  const qtyUnit = signal.quantity_unit || spec.defaultUnit;
  const badge = assetBadge(assetClass);

  return (
    <React.Fragment>
      <tr className="border-b last:border-0 hover:bg-muted/30">
        <td className="p-3 text-sm text-muted-foreground whitespace-nowrap">
          {signal.published_at ? new Date(signal.published_at).toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
        </td>
        <td className="p-3 text-sm font-medium">
          <div className="flex items-center gap-1.5 flex-wrap">
            {signal.action === 'teaching' ? (
              <span className="break-words [overflow-wrap:anywhere]">純教學週記</span>
            ) : (
              (() => {
                const full = `${signal.instrument}${isBatchCollapsed ? ` 等 ${batchInfo.get(signal.batch_id)!.count} 檔` : ''}`;
                return (
                  <InstrumentTooltip
                    full={full}
                    data-testid="admin-signal-row-instrument"
                    className="break-words [overflow-wrap:anywhere] font-medium"
                  >
                    <span className="line-clamp-2">{full}</span>
                  </InstrumentTooltip>
                );
              })()
            )}
            {badge && signal.action !== 'teaching' && (
              <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 h-4', badge.className)}>
                {badge.label}
              </Badge>
            )}
            {signal.batch_id && batchInfo.get(signal.batch_id) && batchInfo.get(signal.batch_id)!.count > 1 && (
              <Badge
                variant="secondary"
                className="text-[10px] px-1.5 py-0 h-4 cursor-pointer select-none"
                title={`同篇週記共 ${batchInfo.get(signal.batch_id)!.count} 檔，點擊${isBatchCollapsed ? '展開' : '折疊'}`}
                onClick={() => {
                  setCollapsedBatches((prev) => {
                    const next = new Set(prev);
                    if (next.has(signal.batch_id)) next.delete(signal.batch_id);
                    else next.add(signal.batch_id);
                    return next;
                  });
                }}
              >
                📦 {isBatchCollapsed ? '展開' : '折疊'} {batchInfo.get(signal.batch_id)!.count}
              </Badge>
            )}
          </div>
        </td>
        <td className="p-3"><Badge className={`${ai.className} text-xs`}>{ai.label}</Badge></td>
        <td className="p-3 text-sm whitespace-nowrap tabular-nums align-top">
          {signal.price_hint ? (
            <>
              {priceSymbol}{Number(signal.price_hint).toLocaleString(undefined, { minimumFractionDigits: spec.priceDigits >= 4 ? 2 : (currency === 'USD' ? 2 : 0), maximumFractionDigits: spec.priceDigits })}
              {signal.quantity && (
                <span className="text-muted-foreground">（{signal.quantity}{qtyUnit}）</span>
              )}
              {currency === 'USD' && signal.price_hint && signal.quantity && (
                <FxHint
                  amount={Number(signal.price_hint) * Number(signal.quantity)}
                  currency="USD"
                  showMeta={false}
                  forceAuto
                  className="block whitespace-nowrap"
                />
              )}
            </>
          ) : '-'}
        </td>
        <td className="p-3 text-sm" style={{ maxWidth: '200px' }}>
          <p className="text-muted-foreground truncate overflow-hidden text-ellipsis whitespace-nowrap">{richHtmlPreview(signal.reason_summary, PREVIEW_LIMITS.cardTitle) || '-'}</p>
        </td>
        {isMentor && (
          <td className="p-3">
            {signal.status === 'pending' ? (
              <Badge className="text-xs border border-mentor/40 bg-mentor/10 text-mentor">待發布</Badge>
            ) : (
              <Badge className="text-xs border border-success/40 bg-success/10 text-success">已發布</Badge>
            )}
          </td>
        )}
        <td className="p-3">
          {signal.action === 'teaching' ? (
            <Badge className="text-xs border border-mentor/40 bg-mentor/10 text-mentor">教學</Badge>
          ) : signal.action === 'hold' ? (
            <Badge className="text-xs border border-border bg-white text-foreground dark:bg-white dark:text-black">觀察</Badge>
          ) : signal.action === 'exit' ? (
            <Badge className="text-xs border border-muted-foreground/40 bg-muted text-muted-foreground">已平倉</Badge>
          ) : ['sell', 'trim'].includes(signal.action) ? (
            openInstruments.has(signal.instrument) ? (
              <Badge className="text-xs border border-amber-400/40 bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700">減碼</Badge>
            ) : (
              <Badge className="text-xs border border-muted-foreground/40 bg-muted text-muted-foreground">已平倉</Badge>
            )
          ) : signal.action === 'add' ? (
            <Badge className="text-xs border border-blue-400/40 bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-700">加碼</Badge>
          ) : signal.action === 'buy' && addBuySignalIds.has(signal.id) ? (
            <Badge className="text-xs border border-blue-400/40 bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-700">加碼</Badge>
          ) : (
            <Badge className="text-xs border border-border bg-white text-foreground dark:bg-white dark:text-black">持有中</Badge>
          )}
        </td>
        <td className="p-3">
          <div className="flex items-center gap-1">
            {hasDetail && (
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setExpandedId(isExpanded ? null : signal.id)}>
                {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {isExpanded ? '收起' : '展開'}
              </Button>
            )}
            {isAdvisor && signal.status === 'published' && (
              <PermissionTooltip disabled={isReadOnly}>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                  onClick={() => onRepush(signal.id)}
                  disabled={repushingId === signal.id || isReadOnly}
                  title="重新推送此訊號給 LINE 訂閱者（標記為「已更新」）"
                >
                  {repushingId === signal.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                  重推 LINE
                </Button>
              </PermissionTooltip>
            )}
            {signal.batch_id && (
              <PermissionTooltip disabled={isReadOnly}>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                  onClick={() => onEdit(signal.batch_id)}
                  disabled={isReadOnly}
                  title="編輯整批"
                >
                  編輯
                </Button>
              </PermissionTooltip>
            )}
            <PermissionTooltip disabled={isReadOnly}>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
                onClick={() => onRecall(signal.id)}
                disabled={recalling || isReadOnly || !recall.ok}
                title={!recall.ok ? recall.reason : undefined}
              >
                <Undo2 className="h-3 w-3" />收回
              </Button>
            </PermissionTooltip>
          </div>
        </td>
      </tr>
      {isExpanded && (
        <tr className="border-b last:border-0">
          <td colSpan={isMentor ? 8 : 7} className="p-0">
            <div className="bg-muted/30 px-6 py-3 text-xs space-y-2">
              {(signal as any).teaching_topic && (
                <div>
                  <span className="font-medium text-foreground">教學主題</span>
                  <p className="text-muted-foreground mt-0.5 whitespace-pre-wrap">{(signal as any).teaching_topic}</p>
                </div>
              )}
              {(signal as any).overall_summary && (
                <div>
                  <span className="font-medium text-foreground">整體摘要</span>
                  <p className="text-muted-foreground mt-0.5 whitespace-pre-wrap">{(signal as any).overall_summary}</p>
                </div>
              )}
              {signal.reason_summary && (
                <div>
                  <span className="font-medium text-foreground">為什麼這樣操作？</span>
                  <SafeRichHtml html={signal.reason_summary} className="mt-0.5 text-xs" />
                </div>
              )}
              {signal.reason_detail && (
                <div>
                  <span className="font-medium text-foreground">部位控管想法</span>
                  <SafeRichHtml html={signal.reason_detail} className="mt-0.5 text-xs" />
                </div>
              )}
              {signal.risk_notes && (
                <div>
                  <span className="font-medium text-foreground">風險提醒</span>
                  <SafeRichHtml html={signal.risk_notes} className="mt-0.5 text-xs" />
                </div>
              )}
              {signal.learning_points && (
                <div>
                  <span className="font-medium text-foreground">教學重點</span>
                  <SafeRichHtml html={signal.learning_points} className="mt-0.5 text-xs" />
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  );
}
