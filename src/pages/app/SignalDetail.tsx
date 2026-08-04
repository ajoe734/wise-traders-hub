import { ShareButton } from '@/components/ShareButton';
import { SEO } from '@/components/SEO';
import { useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useGoBack } from '@/lib/backNav';
import { UnifiedAppLayout, markAppSignalsAsRead } from '@/components/layouts/UnifiedAppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { AlertTriangle, BookOpen, Lightbulb, Shield, Target, ArrowLeft, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { SafeRichHtml } from '@/components/SafeRichHtml';
import { FxHint } from '@/components/FxHint';
import { CURRENCY_SYMBOL, CURRENCY_SOURCE_LABEL, resolveDisplayCurrencyWithSource, type Currency } from '@/lib/currency';
import { sanitizeAssetQuantityUnit } from '@/lib/asset';
import { trackRaw } from '@/lib/analytics/events';
import { buildSignalCurrencyResolutionPayload } from '@/lib/analytics/signalCurrencyResolution';
import { UnavailableContent } from '@/components/UnavailableContent';
import { InstrumentTooltip } from '@/components/InstrumentTooltip';
import {
  resolveInstrument,
  resolveNumeric,
  safeMultiply,
  INSTRUMENT_MARKET_LABEL,
  INSTRUMENT_SOURCE_LABEL,
  NUMERIC_SOURCE_LABEL,
} from '@/lib/signalFieldResolvers';
import { getActionMeta, getSignalDisplayInstrument } from '@/lib/signalAction';

interface DbSignal {
  id: string;
  instrument: string;
  action: string;
  price_hint: number | null;
  quantity: number | null;
  quantity_unit: string;
  reason_summary: string | null;
  reason_detail: string | null;
  risk_notes: string | null;
  learning_points: string | null;
  published_at: string | null;
  experts: {
    name: string;
    slug: string;
    role: string;
    avatar_url: string | null;
    currency?: string | null;
    asset_class?: string | null;
  } | null;
}

const TextBlock = ({ text, dotColor }: { text: string; dotColor?: string }) => {
  const lines = text.split('\n').map(l => l.replace(/^[•·]\s*/, '').trim()).filter(Boolean);
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => (
        <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
          {dotColor && <span className={`mt-1.5 ml-1 h-1.5 w-1.5 rounded-full shrink-0 ${dotColor}`} />}
          <p>{line}</p>
        </div>
      ))}
    </div>
  );
};

const fetchSignalDetail = async (signalId: string): Promise<DbSignal | null> => {
  const { data } = await supabase
    .from('expert_signals')
    .select('id, instrument, action, price_hint, quantity, quantity_unit, reason_summary, reason_detail, risk_notes, learning_points, published_at, experts(name, slug, role, avatar_url, currency, asset_class)')
    .eq('id', signalId)
    .single();
  return (data as unknown as DbSignal | null) ?? null;
};

const SignalDetail = () => {
  const { id } = useParams<{ id: string }>();
  const goBack = useGoBack('/app/signals');
  const [searchParams] = useSearchParams();
  const { user, hasRole } = useAuth();

  const { data: signal, isLoading: loading } = useQuery({
    queryKey: ['app-signal-detail', id],
    queryFn: () => fetchSignalDetail(id!),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    // 訂閱門檻由 RLS 決定，持久化快取需在掛載時重驗。
    refetchOnMount: 'always',
    placeholderData: (prev) => prev,
  });

  const isPreview = searchParams.get('preview') === '1' && (
    (signal?.experts?.slug && user?.expertSlug === signal.experts.slug) || hasRole('company_admin')
  );

  useEffect(() => {
    markAppSignalsAsRead();
  }, []);

  // 幣別解析（含來源）：一次算完供整頁使用；signal 未載入時給安全預設值。
  const { currency: resolvedCurrency, source: currencySource } = signal
    ? resolveDisplayCurrencyWithSource(signal.experts?.currency, signal.instrument)
    : { currency: 'TWD' as Currency, source: 'default-fallback' as const };

  // 幣別解析事件：signal 就緒後送出，方便日後查 explicit / inferred / fallback 比例
  useEffect(() => {
    if (!signal?.id) return;
    trackRaw(
      'signal_currency_resolution',
      buildSignalCurrencyResolutionPayload({
        signal_id: signal.id,
        expert_slug: signal.experts?.slug ?? null,
        expert_currency: signal.experts?.currency,
        instrument: signal.instrument,
        is_preview: isPreview,
      }),
    );
  }, [signal?.id, resolvedCurrency, currencySource, isPreview, signal?.experts?.slug, signal?.experts?.currency, signal?.instrument]);


  if (loading) {
    return <UnifiedAppLayout><div className="p-4 text-center text-muted-foreground">載入中...</div></UnifiedAppLayout>;
  }

  if (!signal) {
    return <UnifiedAppLayout><UnavailableContent kind="signal" /></UnifiedAppLayout>;
  }

  const ac = getActionMeta(signal.action);
  const publishedAt = signal.published_at ? new Date(signal.published_at) : null;
  // 韌性解析：instrument / price / quantity 一律走 resolver，避免 NaN、undefined、null 進畫面
  const inst = resolveInstrument(signal?.instrument);
  const { code: tickerCode, name: tickerName, display: displaySymbol } = inst;
  const priceResolved = resolveNumeric(signal.price_hint, { allowZero: false });
  const qtyResolved = resolveNumeric(signal.quantity, { allowZero: false });
  const totalAmount = safeMultiply(priceResolved.value, qtyResolved.value);

  return (
    <UnifiedAppLayout>
      <SEO
        title={`${(signal as any)?.instrument || '策略訊號'} ${(signal as any)?.action === 'buy' ? '買進' : (signal as any)?.action === 'sell' ? '賣出' : ''}｜訊號詳情 | legendflow`}
        description={`${(signal as any)?.instrument || ''} 策略訊號詳情、操作建議與風險說明。`}
        path={`/app/signal/${id || ''}`}
        type="article"
        noindex
      />
      {isPreview && (
        <div className="sticky top-0 z-50 bg-amber-500 text-amber-50 px-4 py-2 text-sm flex items-center justify-center gap-2 shadow">
          <Eye className="h-4 w-4" />
          <span className="font-medium">🔍 訂閱者預覽模式</span>
          <Button size="sm" variant="outline" className="ml-2 h-7 bg-amber-50 text-amber-700 border-amber-100 hover:bg-amber-100" onClick={() => window.close()}>
            退出預覽
          </Button>
        </div>
      )}
      <div className="p-4 space-y-4">
        {/* Back button + share */}
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 -ml-2"
            onClick={goBack}
          >
            <ArrowLeft className="h-4 w-4" />
            返回訊號中心
          </Button>
          {id && <ShareButton target={{ kind: "signal", id }} />}
        </div>
        {/* Header: instrument + expert name + stock price */}
        {/* Row 1: Badge + ticker */}
        <div className="flex items-start gap-3 flex-wrap">
          <Badge className={cn(ac.className, 'text-xs px-2 py-0.5 shrink-0 mt-1')}>{ac.label}</Badge>
          <h1 className="text-2xl font-bold min-w-0 break-words [overflow-wrap:anywhere] leading-tight">
            <InstrumentTooltip
              full={displaySymbol}
              data-testid="signal-detail-instrument"
              className="text-2xl font-bold leading-tight"
            >
              {tickerCode ? (
                <>
                  <span className="font-mono tabular-nums tracking-tight">{tickerCode}</span>
                  {tickerName ? (
                    <> <span>{tickerName}</span></>
                  ) : inst.market === 'tw-stock' ? (
                    <span className="text-muted-foreground">.TW</span>
                  ) : null}
                </>
              ) : inst.name ? (
                <span>{inst.name}</span>
              ) : (
                <span className="text-muted-foreground" data-testid="sd-instrument-missing">
                  未提供商品資訊
                </span>
              )}
            </InstrumentTooltip>
          </h1>
          {isPreview && inst.raw && (
            <span
              data-testid="sd-instrument-source"
              data-market={inst.market}
              data-source={inst.source}
              className="mt-2 text-[11px] text-muted-foreground border border-border/60 rounded px-2 py-0.5"
            >
              {INSTRUMENT_MARKET_LABEL[inst.market]}｜{INSTRUMENT_SOURCE_LABEL[inst.source]}
            </span>
          )}

        </div>
        {/* Row 2: date + expert name + role badge */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {publishedAt && <span>{format(publishedAt, 'yyyy/MM/dd HH:mm', { locale: zhTW })}</span>}
          {signal.experts && (
            <>
              <span>•</span>
              <span className="font-medium text-foreground">{signal.experts.name}</span>
              <Badge className="text-[10px] px-2 py-0.5" style={{ backgroundColor: 'hsl(0,25%,16%)', color: '#ffffff', borderColor: 'hsl(0,35%,28%)' }}>
                {signal.experts.role === 'advisor' ? '投顧分析師' : '實戰導師'}
              </Badge>
            </>
          )}
        </div>

        {/* Price hint（韌性渲染：resolveNumeric 已濾掉 NaN / 負值 / 空字串） */}
        {(priceResolved.value !== null || qtyResolved.value !== null) && (() => {
          const cur: Currency = resolvedCurrency;
          const sym = CURRENCY_SYMBOL[cur];
          const assetClassForUnit = signal.experts?.asset_class ?? (cur === 'USD' ? 'us_stock' : 'tw_stock');
          const unit = sanitizeAssetQuantityUnit(signal.quantity_unit, assetClassForUnit);
          return (
            <div className="text-sm text-muted-foreground inline-flex items-baseline flex-wrap gap-x-1">
              <span className="font-sans">參考價位：</span>
              {priceResolved.value !== null ? (
                <span data-testid="sd-price" className="font-medium text-foreground whitespace-nowrap font-mono tabular-nums tracking-normal">
                  {sym}{priceResolved.value.toLocaleString(undefined, { minimumFractionDigits: cur === 'USD' ? 2 : 0, maximumFractionDigits: 2 })}
                </span>
              ) : (
                <span data-testid="sd-price-missing" className="text-muted-foreground italic">未提供</span>
              )}
              {qtyResolved.value !== null && (
                <span data-testid="sd-qty" className="font-medium text-foreground whitespace-nowrap font-mono tabular-nums tracking-normal">
                  （{qtyResolved.value}<span className="font-sans">{unit}</span>）
                </span>
              )}
              {totalAmount !== null && <FxHint amount={totalAmount} currency={cur} className="ml-2" showMeta={false} />}
              {isPreview && (
                <span
                  data-testid="sd-numeric-source"
                  data-price-source={priceResolved.source}
                  data-qty-source={qtyResolved.source}
                  className="ml-2 text-[11px] text-muted-foreground border border-border/60 rounded px-2 py-0.5"
                >
                  價：{NUMERIC_SOURCE_LABEL[priceResolved.source]} ／ 量：{NUMERIC_SOURCE_LABEL[qtyResolved.source]}
                </span>
              )}
            </div>
          );
        })()}


        {/* Preview 模式下顯示幣別解析來源，方便老師 / 管理員除錯 */}
        {isPreview && (
          <div
            data-testid="sd-currency-source"
            data-currency={resolvedCurrency}
            data-source={currencySource}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground border border-border/60 rounded px-2 py-0.5"
          >
            <span>幣別來源：</span>
            <span className="font-medium text-foreground">{CURRENCY_SOURCE_LABEL[currencySource]}</span>
            <span>→ {resolvedCurrency}</span>
          </div>
        )}

        {/* 1. 為什麼這樣操作？ */}
        {signal.reason_detail && (
          <Card>
            <CardContent className="p-4">
              <h2 className="font-semibold mb-2 flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-primary" /> 為什麼這樣操作？
              </h2>
              <SafeRichHtml html={signal.reason_detail} />
            </CardContent>
          </Card>
        )}

        {/* 2. 部位控管想法 */}
        {signal.reason_summary && (
          <Card>
            <CardContent className="p-4">
              <h2 className="font-semibold mb-2 flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" /> 部位控管想法
              </h2>
              <SafeRichHtml html={signal.reason_summary} />
            </CardContent>
          </Card>
        )}

        {/* 3. 風險提醒 */}
        {signal.risk_notes && (
          <Card className="bg-warning-light/30 border-warning/20">
            <CardContent className="p-4">
              <h2 className="font-semibold mb-2 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" /> 風險提醒
              </h2>
              <SafeRichHtml html={signal.risk_notes} />
            </CardContent>
          </Card>
        )}

        {/* 4. 延伸學習 */}
        {signal.learning_points && (
          <Card>
            <CardContent className="p-4">
              <h2 className="font-semibold mb-2 flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-mentor" /> 延伸學習
              </h2>
              <SafeRichHtml html={signal.learning_points} />
            </CardContent>
          </Card>
        )}

        {/* Disclaimer */}
        <Card className="bg-muted/30">
          <CardContent className="p-4 flex items-start gap-2">
            <Shield className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
            <p className="text-xs text-muted-foreground">
              本訊號為投顧服務的一部分，提供之分析意見僅供參考，不保證獲利。投資有風險，請審慎評估。
            </p>
          </CardContent>
        </Card>
      </div>
    </UnifiedAppLayout>
  );
};

import { SignalDetailErrorBoundary } from './SignalDetailErrorBoundary';

const SignalDetailWithBoundary = () => {
  const { id } = useParams<{ id: string }>();
  return (
    <SignalDetailErrorBoundary signalId={id ?? null}>
      <SignalDetail />
    </SignalDetailErrorBoundary>
  );
};

export default SignalDetailWithBoundary;
