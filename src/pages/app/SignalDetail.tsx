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
import { CURRENCY_SYMBOL, CURRENCY_SOURCE_LABEL, defaultQuantityUnit, resolveDisplayCurrencyWithSource, type Currency } from '@/lib/currency';
import { trackRaw } from '@/lib/analytics/events';
import { UnavailableContent } from '@/components/UnavailableContent';
import { parseInstrument } from '@/lib/instrument';
import { InstrumentTooltip } from '@/components/InstrumentTooltip';

const actionConfig: Record<string, { label: string; className: string }> = {
  buy: { label: '買進', className: 'bg-success text-white border-success' },
  sell: { label: '賣出', className: 'bg-destructive text-white border-destructive' },
  add: { label: '加碼', className: 'bg-blue-500 text-blue-50 border-blue-500' },
  trim: { label: '減碼', className: 'bg-amber-500 text-amber-50 border-amber-500' },
  exit: { label: '平損', className: 'bg-slate-500 text-slate-50 border-slate-500' },
};

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
    .select('id, instrument, action, price_hint, quantity, quantity_unit, reason_summary, reason_detail, risk_notes, learning_points, published_at, experts(name, slug, role, avatar_url, currency)')
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
    refetchOnMount: false,
    placeholderData: (prev) => prev,
  });

  const isPreview = searchParams.get('preview') === '1' && (
    (signal?.experts?.slug && user?.expertSlug === signal.experts.slug) || hasRole('company_admin')
  );

  useEffect(() => {
    markAppSignalsAsRead();
  }, []);

  if (loading) {
    return <UnifiedAppLayout><div className="p-4 text-center text-muted-foreground">載入中...</div></UnifiedAppLayout>;
  }

  if (!signal) {
    return <UnifiedAppLayout><UnavailableContent kind="signal" /></UnifiedAppLayout>;
  }

  const ac = actionConfig[signal.action] || actionConfig.buy;
  const publishedAt = signal.published_at ? new Date(signal.published_at) : null;
  // 保留 ETF 字尾（L / R / B）：`/^\d+/` 舊 regex 會把 00631L 截成 00631，造成報價鏈壞掉。
  const { code: tickerCode, name: tickerName } = parseInstrument(signal?.instrument);
  const displaySymbol = tickerName
    ? `${tickerCode} ${tickerName}`
    : (tickerCode ? `${tickerCode}.TW` : signal.instrument);

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
                  ) : (
                    <span className="text-muted-foreground">.TW</span>
                  )}
                </>
              ) : (
                signal.instrument
              )}
            </InstrumentTooltip>
          </h1>
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

        {/* Price hint */}
        {signal.price_hint != null && (() => {
          const cur: Currency = resolveDisplayCurrency(signal.experts?.currency, signal.instrument);
          const sym = CURRENCY_SYMBOL[cur];
          const unit = signal.quantity_unit || defaultQuantityUnit(cur);
          const total = signal.quantity != null ? Number(signal.price_hint) * Number(signal.quantity) : null;
          return (
            <div className="text-sm text-muted-foreground inline-flex items-baseline flex-wrap gap-x-1">
              <span className="font-sans">參考價位：</span>
              <span data-testid="sd-price" className="font-medium text-foreground whitespace-nowrap font-mono tabular-nums tracking-normal">
                {sym}{Number(signal.price_hint).toLocaleString(undefined, { minimumFractionDigits: cur === 'USD' ? 2 : 0, maximumFractionDigits: 2 })}
              </span>
              {signal.quantity != null && (
                <span data-testid="sd-qty" className="font-medium text-foreground whitespace-nowrap font-mono tabular-nums tracking-normal">
                  （{signal.quantity}<span className="font-sans">{unit}</span>）
                </span>
              )}
              {total != null && <FxHint amount={total} currency={cur} className="ml-2" showMeta={false} />}
            </div>
          );
        })()}

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
