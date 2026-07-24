import { getActionMeta, type ActionMeta } from '@/lib/signalAction';
import { canRecallSignal } from '@/lib/publishingWindow';
import { getAssetSpec, normalizeAssetClass, type AssetClass } from '@/lib/asset';
import { CURRENCY_SYMBOL, inferCurrencyFromInstrument, type Currency } from '@/lib/currency';
import { assetBadge } from '@/pages/_adminPerformance/types';
import { richHtmlPreview, PREVIEW_LIMITS } from '@/components/SafeRichHtml';
import type { SignalToneKey } from './signalTone';

// ─────────────────────────── 幣別 (single source) ───────────────────────────
export type SignalCurrencySource =
  | 'explicit'
  | 'asset-class'
  | 'inferred-instrument'
  | 'default-fallback';

export const SIGNAL_CURRENCY_SOURCE_LABEL: Record<SignalCurrencySource, string> = {
  explicit: '明確設定',
  'asset-class': '資產類別',
  'inferred-instrument': '代號推斷',
  'default-fallback': '預設',
};

export function pickSignalCurrencyWithSource(
  signal: any,
  specCurrency: Currency,
  defaultCurrency: Currency = 'TWD',
): { currency: Currency; source: SignalCurrencySource } {
  if (signal?.currency === 'USD' || signal?.currency === 'TWD') {
    return { currency: signal.currency, source: 'explicit' };
  }
  if (specCurrency === 'USD') return { currency: 'USD', source: 'asset-class' };
  const inferred = inferCurrencyFromInstrument(signal?.instrument);
  if (inferred) return { currency: inferred, source: 'inferred-instrument' };
  return { currency: defaultCurrency, source: 'default-fallback' };
}

export function pickSignalCurrency(
  signal: any,
  specCurrency: Currency,
  defaultCurrency: Currency = 'TWD',
): Currency {
  return pickSignalCurrencyWithSource(signal, specCurrency, defaultCurrency).currency;
}

// ─────────────────────────── holdingStatus toneKey ───────────────────────────
function computeHoldingStatus(
  signal: any,
  openInstruments: Set<string>,
  addBuySignalIds: Set<string>,
): { label: string; toneKey: SignalToneKey } {
  switch (signal.action) {
    case 'teaching':
      return { label: '教學', toneKey: 'mentor' };
    case 'hold':
      return { label: '觀察', toneKey: 'neutral' };
    case 'exit':
      return { label: '已平倉', toneKey: 'muted' };
    case 'sell':
    case 'trim':
      return openInstruments.has(signal.instrument)
        ? { label: '減碼', toneKey: 'warn' }
        : { label: '已平倉', toneKey: 'muted' };
    case 'add':
      return { label: '加碼', toneKey: 'info' };
    case 'buy':
      return addBuySignalIds.has(signal.id)
        ? { label: '加碼', toneKey: 'info' }
        : { label: '持有中', toneKey: 'neutral' };
    default:
      return { label: '持有中', toneKey: 'neutral' };
  }
}

// ─────────────────────────── ViewModel ───────────────────────────
export interface SignalRowViewModel {
  id: string;
  batchId: string | null;
  isTeaching: boolean;
  publishedAtText: string;
  displayInstrument: { text: string; tooltipFull: string } | null;
  assetBadge: { label: string; className: string } | null;
  batchBadge: { count: number; collapsed: boolean } | null;
  actionMeta: ActionMeta;
  price: {
    symbol: string;
    formatted: string;
    quantityText: string | null;
    fx: { amount: number; currency: Currency } | null;
  } | null;
  currency: {
    code: Currency;
    source: SignalCurrencySource;
    isInferred: boolean;
    sourceLabel: string;
  };
  reasonSummaryPreview: string;
  hasDetail: boolean;
  publishStatus: { label: string; toneKey: SignalToneKey } | null;
  holdingStatus: { label: string; toneKey: SignalToneKey };
  actions: {
    canRepush: boolean;
    canEdit: boolean;
    recallDisabled: boolean;
    recallReason: string | undefined;
  };
  expanded: {
    teachingTopic: string | null;
    overallSummary: string | null;
    reasonSummary: string | null;
    reasonDetail: string | null;
    riskNotes: string | null;
    learningPoints: string | null;
  };
}

export interface ViewModelInput {
  signal: any;
  isMentor: boolean;
  isAdvisor: boolean;
  openInstruments: Set<string>;
  addBuySignalIds: Set<string>;
  batchInfo: Map<string, { count: number }>;
  collapsedBatches: Set<string>;
  defaultCurrency?: Currency;
  defaultAssetClass?: AssetClass | string | null;
}

export function buildSignalRowViewModel(input: ViewModelInput): SignalRowViewModel {
  const { signal, isMentor, isAdvisor, openInstruments, addBuySignalIds, batchInfo, collapsedBatches } = input;
  const defaultCurrency: Currency = input.defaultCurrency ?? 'TWD';
  const assetClass = normalizeAssetClass(signal.asset_class ?? input.defaultAssetClass);
  const spec = getAssetSpec(assetClass);
  const { currency, source } = pickSignalCurrencyWithSource(signal, spec.currency, defaultCurrency);
  const isInferred = source !== 'explicit';
  const badge = assetBadge(assetClass);

  const batch = signal.batch_id ? batchInfo.get(signal.batch_id) : undefined;
  const isBatchCollapsed = !!(signal.batch_id && collapsedBatches.has(signal.batch_id) && (batch?.count ?? 0) > 1);
  const isTeaching = signal.action === 'teaching';

  const publishedAtText = signal.published_at
    ? new Date(signal.published_at).toLocaleString('zh-TW', {
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      })
    : '-';

  const displayInstrument = isTeaching
    ? null
    : {
        text: `${signal.instrument}${isBatchCollapsed && batch ? ` 等 ${batch.count} 檔` : ''}`,
        tooltipFull: `${signal.instrument}${isBatchCollapsed && batch ? ` 等 ${batch.count} 檔` : ''}`,
      };

  const quantityUnit = signal.quantity_unit || spec.defaultUnit;
  const price = signal.price_hint != null
    ? {
        symbol: CURRENCY_SYMBOL[currency],
        formatted: Number(signal.price_hint).toLocaleString(undefined, {
          minimumFractionDigits: spec.priceDigits >= 4 ? 2 : (currency === 'USD' ? 2 : 0),
          maximumFractionDigits: spec.priceDigits,
        }),
        quantityText: signal.quantity ? `${signal.quantity}${quantityUnit}` : null,
        fx: currency === 'USD' && signal.quantity
          ? { amount: Number(signal.price_hint) * Number(signal.quantity), currency: 'USD' as Currency }
          : null,
      }
    : null;

  const recall = canRecallSignal(signal.published_at);
  const hasDetail = !!(signal.reason_detail || signal.risk_notes || signal.reason_summary || signal.learning_points);

  return {
    id: signal.id,
    batchId: signal.batch_id ?? null,
    isTeaching,
    publishedAtText,
    displayInstrument,
    assetBadge: !isTeaching && badge ? badge : null,
    batchBadge: signal.batch_id && batch && batch.count > 1 ? { count: batch.count, collapsed: isBatchCollapsed } : null,
    actionMeta: getActionMeta(signal.action),
    price,
    currency: {
      code: currency,
      source,
      isInferred,
      sourceLabel: SIGNAL_CURRENCY_SOURCE_LABEL[source],
    },
    reasonSummaryPreview: richHtmlPreview(signal.reason_summary, PREVIEW_LIMITS.cardTitle) || '-',
    hasDetail,
    publishStatus: isMentor
      ? signal.status === 'pending'
        ? { label: '待發布', toneKey: 'mentor' }
        : { label: '已發布', toneKey: 'success' }
      : null,
    holdingStatus: computeHoldingStatus(signal, openInstruments, addBuySignalIds),
    actions: {
      canRepush: isAdvisor && signal.status === 'published',
      canEdit: !!signal.batch_id,
      recallDisabled: !recall.ok,
      recallReason: recall.ok ? undefined : recall.reason,
    },
    expanded: {
      teachingTopic: signal.teaching_topic ?? null,
      overallSummary: signal.overall_summary ?? null,
      reasonSummary: signal.reason_summary ?? null,
      reasonDetail: signal.reason_detail ?? null,
      riskNotes: signal.risk_notes ?? null,
      learningPoints: signal.learning_points ?? null,
    },
  };
}
