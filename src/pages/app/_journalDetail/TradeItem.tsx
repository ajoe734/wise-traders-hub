import { useState } from 'react';
import { format } from 'date-fns';
import { ChevronDown, ChevronUp, Lightbulb, Target, AlertTriangle, BookOpen } from 'lucide-react';
import { ActionBadge } from '@/components/ActionBadge';
import { SafeRichHtml } from '@/components/SafeRichHtml';
import { FxHint } from '@/components/FxHint';
import { InstrumentTooltip } from '@/components/InstrumentTooltip';
import { CURRENCY_SYMBOL, normalizeCurrency, type Currency } from '@/lib/currency';
import { sanitizeAssetQuantityUnit } from '@/lib/asset';
import { parseInstrument } from '@/lib/instrument';
import { isRichHtmlEmpty } from './richHtml';
import { TeachingDebugBadge } from './TeachingDebugBadge';
import type { SignalDetail } from './types';

/** 本週操作列表的單列：可展開的操作理由／部位想法／風險／教學重點。 */
export const TradeItem = ({ signal, nameMap, showDebug }: { signal: SignalDetail; nameMap: Record<string, string>; showDebug: boolean }) => {
  const isTeaching = signal.action === 'teaching';
  const learningEmpty = isRichHtmlEmpty(signal.learning_points);
  const hasNonLearningDetails = !!(signal.reason_summary || signal.reason_detail || signal.risk_notes);
  // teaching 條目一律視為有展開內容（即使 learning_points 空也要顯示缺失提示，避免整段消失）
  const hasDetails = hasNonLearningDetails || !!signal.learning_points || isTeaching;
  const [expanded, setExpanded] = useState(isTeaching || hasDetails);
  const cur: Currency = normalizeCurrency(signal.currency ?? signal.experts?.currency);
  const sym = CURRENCY_SYMBOL[cur];
  const assetClassForUnit = signal.experts?.asset_class ?? (cur === 'USD' ? 'us_stock' : 'tw_stock');
  const unit = sanitizeAssetQuantityUnit(signal.quantity_unit, assetClassForUnit);
  const showTrade = !isTeaching && (signal.price_hint != null || signal.quantity != null);
  const total = !isTeaching && signal.price_hint != null && signal.quantity != null
    ? Number(signal.price_hint) * Number(signal.quantity)
    : null;

  // 保留 ETF 字尾（L / R / B）+ 名稱回填：DB 若只存了代號（過去 fetchStockInfo 失敗過），
  // 用 stock_names 補上人類可讀名稱。
  const { code, name: nameFromInstrument } = parseInstrument(signal.instrument);
  const resolvedName = nameFromInstrument || (code ? nameMap[code] : '') || '';
  const displayInstrument = code
    ? (resolvedName ? `${code} ${resolvedName}` : code)
    : (signal.instrument || '');

  return (
    <div className="px-4 py-3">
      <div
        className={`flex items-center gap-3 ${hasDetails ? 'cursor-pointer' : ''}`}
        onClick={() => hasDetails && setExpanded(!expanded)}
      >
        <ActionBadge action={signal.action as any} size="sm" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {displayInstrument ? (
              <InstrumentTooltip
                full={displayInstrument}
                data-testid="journal-detail-instrument"
                className="font-medium text-sm min-w-0 break-words [overflow-wrap:anywhere]"
              >
                {code ? (
                  <>
                    <span className="font-mono tabular-nums tracking-tight">{code}</span>
                    {resolvedName && <> <span>{resolvedName}</span></>}
                  </>
                ) : (
                  displayInstrument
                )}
              </InstrumentTooltip>
            ) : isTeaching ? (
              <span className="font-medium text-sm text-mentor">教學筆記</span>
            ) : null}
            <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">{format(new Date(signal.published_at), 'MM/dd')}</span>
            {showTrade && (
              <span className="text-xs text-foreground/80 font-medium inline-flex items-baseline flex-wrap gap-x-1">
                {signal.price_hint != null && (
                  <span data-testid="jd-price" className="whitespace-nowrap font-mono tabular-nums tracking-normal">
                    <span className="font-sans">價 </span>{sym}{Number(signal.price_hint).toLocaleString(undefined, { minimumFractionDigits: cur === 'USD' ? 2 : 0, maximumFractionDigits: 2 })}
                  </span>
                )}
                {signal.price_hint != null && signal.quantity != null && <span className="text-muted-foreground">·</span>}
                {signal.quantity != null && (
                  <span data-testid="jd-qty" className="whitespace-nowrap font-mono tabular-nums tracking-normal">
                    {signal.quantity} <span className="font-sans">{unit}</span>
                  </span>
                )}
              </span>
            )}
            {total != null && <FxHint amount={total} currency={cur} showMeta={false} />}
          </div>
        </div>
        {hasDetails && (
          <button className="text-muted-foreground shrink-0">
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        )}
      </div>

      {expanded && hasDetails && (
        <div className="mt-3 ml-9 space-y-3">
          {signal.reason_summary && (
            <div>
              <h3 className="text-xs font-semibold flex items-center gap-1.5 mb-1">
                <Lightbulb className="h-3.5 w-3.5 text-primary" /> 為什麼這樣操作？
              </h3>
              <SafeRichHtml html={signal.reason_summary} className="text-xs" />
            </div>
          )}
          {signal.reason_detail && (
            <div>
              <h3 className="text-xs font-semibold flex items-center gap-1.5 mb-1">
                <Target className="h-3.5 w-3.5 text-primary" /> 部位控管想法
              </h3>
              <SafeRichHtml html={signal.reason_detail} className="text-xs" />
            </div>
          )}
          {signal.risk_notes && (
            <div>
              <h3 className="text-xs font-semibold flex items-center gap-1.5 mb-1 text-warning">
                <AlertTriangle className="h-3.5 w-3.5" /> 風險提醒
              </h3>
              <SafeRichHtml html={signal.risk_notes} className="text-xs" />
            </div>
          )}
          {(isTeaching || signal.learning_points) && (
            <div data-testid="jd-learning-points" data-lp-empty={learningEmpty ? '1' : '0'}>
              <h3 className="text-xs font-semibold flex items-center gap-1.5 mb-1 text-mentor">
                <BookOpen className="h-3.5 w-3.5" /> 教學重點
              </h3>
              {showDebug && <TeachingDebugBadge raw={signal.learning_points} />}
              {!learningEmpty ? (
                <SafeRichHtml html={signal.learning_points!} className="text-xs" />
              ) : (
                <div
                  data-testid="jd-learning-empty"
                  className="rounded border border-dashed border-mentor/40 bg-mentor/5 px-3 py-2 text-xs text-muted-foreground flex items-start gap-2"
                >
                  <AlertTriangle className="h-3.5 w-3.5 text-mentor mt-0.5 shrink-0" />
                  <div className="space-y-0.5">
                    <p className="text-foreground/80 font-medium">教學重點尚未填寫或內容為空</p>
                    <p>
                      {signal.learning_points === null || signal.learning_points === undefined
                        ? '導師此週未填寫教學重點欄位。'
                        : signal.learning_points === ''
                          ? '此欄位存在但為空字串，可能發布時被清空。'
                          : '內容僅含空白標籤，實際文字與圖片皆為空。'}
                      {showDebug ? '' : ' 若你是導師，請回到後台補上內容再重新發布。'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
