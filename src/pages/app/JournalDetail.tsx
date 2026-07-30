import { ShareButton } from '@/components/ShareButton';
import { SEO } from '@/components/SEO';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { UnifiedAppLayout, markAppJournalsAsRead } from '@/components/layouts/UnifiedAppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ActionBadge } from '@/components/ActionBadge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import {
  taipeiMondayOf,
  taipeiWeekRangeUtc,
  taipeiWeekRangeLabelMD,
  taipeiWeekFridayIso,
  taipeiIsoToDisplayDate,
} from '@/lib/taipeiWeek';
import { zhTW } from 'date-fns/locale';
import { Calendar, BookOpen, Shield, Loader2, ChevronDown, ChevronUp, Lightbulb, Target, AlertTriangle, Eye, Download, MessageCircle, ArrowLeft } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { SafeRichHtml, richHtmlToPlain } from '@/components/SafeRichHtml';
import { avatarUrl } from '@/lib/imageTransform';
import { toast } from 'sonner';
import { exportJournalPdf } from '@/lib/exportJournalPdf';
import { FxHint } from '@/components/FxHint';
import { InstrumentTooltip } from '@/components/InstrumentTooltip';
import { CURRENCY_SYMBOL, normalizeCurrency, type Currency } from '@/lib/currency';
import { sanitizeAssetQuantityUnit } from '@/lib/asset';
import { SubscriptionTimeline } from '@/components/SubscriptionTimeline';
import { useSubscriptionTimeline } from '@/hooks/useSubscriptionTimeline';
import { useEffectiveUserId } from '@/hooks/useEffectiveUserId';
import { UnavailableContent } from '@/components/UnavailableContent';
import { parseInstrument } from '@/lib/instrument';
import { resolveStockNames } from '@/lib/stockNameResolver';
import { usePreviewMode } from '@/hooks/usePreviewMode';

interface SignalDetail {
  id: string;
  instrument: string;
  action: string;
  price_hint: number | null;
  quantity: number | null;
  quantity_unit: string | null;
  currency?: string | null;
  reason_summary: string | null;
  reason_detail: string | null;
  risk_notes: string | null;
  learning_points: string | null;
  published_at: string;
  expert_id: string;
  experts: {
    name: string;
    slug: string;
    role: string;
    avatar_url: string | null;
    currency?: string | null;
    asset_class?: string | null;
  };
}

const TeachingDebugBadge = ({ raw }: { raw: string | null }) => {
  const rawStr = raw ?? '';
  const rawLen = rawStr.length;
  const plain = rawStr ? richHtmlToPlain(rawStr) : '';
  const plainLen = plain.length;
  const imgCount = (rawStr.match(/<img\b/gi) || []).length;
  const iframeCount = (rawStr.match(/<iframe\b/gi) || []).length;
  const status = raw === null ? 'null' : raw === '' ? 'empty-string' : plainLen === 0 && imgCount === 0 ? 'html-no-text-no-img' : 'ok';
  const tone =
    status === 'ok' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : status === 'null' || status === 'empty-string' ? 'bg-rose-50 text-rose-700 border-rose-200'
    : 'bg-amber-50 text-amber-700 border-amber-200';
  return (
    <div
      data-testid="jd-learning-debug"
      data-lp-status={status}
      data-lp-raw-len={rawLen}
      data-lp-plain-len={plainLen}
      data-lp-img-count={imgCount}
      className={`mt-1 mb-2 inline-flex flex-wrap items-center gap-1.5 rounded border px-2 py-1 text-[10px] font-mono ${tone}`}
    >
      <span className="font-semibold">learning_points</span>
      <span>status={status}</span>
      <span>raw={rawLen}b</span>
      <span>plain={plainLen}b</span>
      <span>img={imgCount}</span>
      {iframeCount > 0 && <span>iframe={iframeCount}</span>}
    </div>
  );
};

const isRichHtmlEmpty = (raw: string | null | undefined): boolean => {
  if (!raw) return true;
  const hasMedia = /<(img|iframe|video)\b/i.test(raw);
  if (hasMedia) return false;
  return richHtmlToPlain(raw).trim().length === 0;
};

const TradeItem = ({ signal, nameMap, showDebug }: { signal: SignalDetail; nameMap: Record<string, string>; showDebug: boolean }) => {
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


export type JournalFetchSource = 'rls' | 'owner_rpc' | 'none';

export interface JournalFetchDiagnostics {
  source: JournalFetchSource;
  rlsError: string | null;
  rlsHitRow: boolean;
  ownerRpcAttempted: boolean;
  ownerRpcError: string | null;
  forceOwner: boolean;
  signalId: string;
  ownerExpertId: string | null;
  fetchedAt: string;
}

const fetchJournalBundle = async (signalId: string, forceOwner: boolean) => {
  const diagnostics: JournalFetchDiagnostics = {
    source: 'none',
    rlsError: null,
    rlsHitRow: false,
    ownerRpcAttempted: false,
    ownerRpcError: null,
    forceOwner,
    signalId,
    ownerExpertId: null,
    fetchedAt: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('expert_signals')
    .select('id, instrument, action, price_hint, quantity, quantity_unit, reason_summary, reason_detail, risk_notes, learning_points, published_at, expert_id, experts(name, slug, role, avatar_url, currency, asset_class)')
    .eq('id', signalId)
    .maybeSingle();

  let signal: SignalDetail | null = (data as any) ?? null;
  diagnostics.rlsError = error?.message ?? null;
  diagnostics.rlsHitRow = !!signal;
  let fetchError: string | null = error?.message ?? null;

  // Owner fallback：直接 RLS 拉不到，改走 SECURITY DEFINER RPC（僅 owner 有效）
  if (!signal && forceOwner) {
    diagnostics.ownerRpcAttempted = true;
    const { data: rpcData, error: rpcErr } = await supabase
      .rpc('get_owned_journal_bundle', { _signal_id: signalId });
    if (rpcErr) {
      diagnostics.ownerRpcError = rpcErr.message;
      fetchError = rpcErr.message;
    }
    if (rpcData && (rpcData as any).signal) {
      const bundle = rpcData as any;
      diagnostics.source = 'owner_rpc';
      diagnostics.ownerExpertId = bundle.signal?.expert_id ?? null;
      return {
        signal: bundle.signal as SignalDetail,
        weekSignals: (bundle.weekSignals ?? []) as SignalDetail[],
        error: null as string | null,
        diagnostics,
      };
    }
  }

  if (!signal) {
    return {
      signal: null,
      weekSignals: [] as SignalDetail[],
      error: fetchError ?? 'not_found_or_forbidden',
      diagnostics,
    };
  }

  diagnostics.source = 'rls';
  diagnostics.ownerExpertId = signal.expert_id ?? null;

  const s = signal;
  const pubDate = new Date(s.published_at);
  const weekStartIso = taipeiMondayOf(pubDate);
  const { startIso, endIso } = taipeiWeekRangeUtc(weekStartIso);

  const { data: weekData } = await supabase
    .from('expert_signals')
    .select('id, instrument, action, price_hint, quantity, quantity_unit, reason_summary, reason_detail, risk_notes, learning_points, published_at, expert_id, experts(name, slug, role, avatar_url, currency, asset_class)')
    .eq('expert_id', s.expert_id)
    .eq('status', 'published')
    .gte('published_at', startIso)
    .lt('published_at', endIso)
    .order('published_at', { ascending: false });

  return {
    signal: s,
    weekSignals: ((weekData as any) || []) as SignalDetail[],
    error: null as string | null,
    diagnostics,
  };
};

const PreviewDiagnosticsBlock = ({
  diagnostics,
  currentUserId,
  effectiveUserId,
  currentExpertSlug,
  ownerSlug,
  previewSlugFromSession,
  isPreviewSession,
  previewFlagFromUrl,
  topLevelError,
}: {
  diagnostics: JournalFetchDiagnostics | null;
  currentUserId: string | null | undefined;
  effectiveUserId: string | null | undefined;
  currentExpertSlug: string | null | undefined;
  ownerSlug: string | null | undefined;
  previewSlugFromSession: string | null | undefined;
  isPreviewSession: boolean;
  previewFlagFromUrl: boolean;
  topLevelError: string | null;
}) => {
  const [expanded, setExpanded] = useState(true);
  if (!diagnostics) return null;
  const sourceLabel =
    diagnostics.source === 'rls' ? 'RLS 直接讀取' :
    diagnostics.source === 'owner_rpc' ? 'Owner Fallback RPC' :
    '未取得資料';
  const sourceColor =
    diagnostics.source === 'rls' ? 'text-emerald-700 bg-emerald-50 border-emerald-200' :
    diagnostics.source === 'owner_rpc' ? 'text-amber-700 bg-amber-50 border-amber-200' :
    'text-red-700 bg-red-50 border-red-200';
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div className="flex gap-2 text-[11px] leading-relaxed">
      <span className="w-32 shrink-0 text-muted-foreground">{k}</span>
      <span className="flex-1 font-mono break-all">{v ?? <em className="text-muted-foreground">null</em>}</span>
    </div>
  );
  return (
    <div className="max-w-3xl mx-auto mt-4 px-4" data-testid="journal-preview-diagnostics">
      <div className="rounded border border-dashed border-warning/40 bg-warning/5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium"
        >
          <span className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded border text-[10px] font-semibold ${sourceColor}`}>
              {sourceLabel}
            </span>
            <span>預覽診斷</span>
          </span>
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        {expanded && (
          <div className="px-3 pb-3 space-y-1 border-t border-warning/20 pt-2">
            <Row k="Signal ID" v={diagnostics.signalId} />
            <Row k="Owner Expert ID" v={diagnostics.ownerExpertId} />
            <Row k="Owner Slug" v={ownerSlug} />
            <Row k="Current User ID" v={currentUserId} />
            <Row k="Effective User ID" v={effectiveUserId} />
            <Row k="Current Expert Slug" v={currentExpertSlug} />
            <Row k="Force Owner" v={String(diagnostics.forceOwner)} />
            <Row k="Preview Session" v={String(isPreviewSession)} />
            <Row k="Preview URL Flag" v={String(previewFlagFromUrl)} />
            <Row k="Preview Slug (session)" v={previewSlugFromSession} />
            <Row k="RLS 命中" v={String(diagnostics.rlsHitRow)} />
            <Row k="RLS 錯誤" v={diagnostics.rlsError} />
            <Row k="Owner RPC 觸發" v={String(diagnostics.ownerRpcAttempted)} />
            <Row k="Owner RPC 錯誤" v={diagnostics.ownerRpcError} />
            <Row k="Top-level Error" v={topLevelError} />
            <Row k="抓取時間" v={diagnostics.fetchedAt} />
          </div>
        )}
      </div>
    </div>
  );
};

const JournalDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const { user, hasRole } = useAuth();
  const [titleExpanded, setTitleExpanded] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const { isPreview: isPreviewSession, previewSlug: previewSlugFromSession } = usePreviewMode();
  const previewFlagFromUrl = searchParams.get('preview') === '1';
  const forceOwner = isPreviewSession || previewFlagFromUrl || !!user?.expertSlug || hasRole('company_admin');

  const { data, isLoading: loading } = useQuery({
    queryKey: ['app-journal-detail', id, forceOwner, 'v2'],
    queryFn: () => fetchJournalBundle(id!, forceOwner),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    placeholderData: (prev) => prev,
  });

  const signal = data?.signal ?? null;
  const weekSignals = data?.weekSignals ?? [];

  const { userId: effectiveUserId } = useEffectiveUserId();
  const { data: timelines = [] } = useSubscriptionTimeline(
    effectiveUserId ?? undefined,
    signal?.expert_id ?? null,
  );
  const timeline = timelines[0] ?? null;


  const isPreview = searchParams.get('preview') === '1' && (
    (signal?.experts?.slug && user?.expertSlug === signal.experts.slug) || hasRole('company_admin')
  );

  useEffect(() => {
    markAppJournalsAsRead();
  }, []);

  // 名稱回填：若 instrument 只存了代號（例如 "00631L"）而沒有名稱，透過 stock_names
  // 補上人類可讀名稱。使用 batch 查詢一次抓齊本週所有缺名的代號。
  const [nameMap, setNameMap] = useState<Record<string, string>>({});
  useEffect(() => {
    const missingCodes = Array.from(new Set(
      (weekSignals || [])
        .map(s => {
          const { code, name } = parseInstrument(s.instrument);
          return code && !name ? code : null;
        })
        .filter((c): c is string => !!c),
    ));
    if (missingCodes.length === 0) return;
    let cancelled = false;
    resolveStockNames(missingCodes)
      .then((map) => { if (!cancelled) setNameMap(prev => ({ ...prev, ...map })); })
      .catch(() => { /* 靜默失敗：仍會顯示代號 */ });
    return () => { cancelled = true; };
  }, [weekSignals]);


  if (loading) {
    return (
      <UnifiedAppLayout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </UnifiedAppLayout>
    );
  }

  const showDiagnostics = isPreviewSession || previewFlagFromUrl || hasRole('company_admin') || !!user?.expertSlug;
  const diagnosticsNode = showDiagnostics ? (
    <PreviewDiagnosticsBlock
      diagnostics={data?.diagnostics ?? null}
      currentUserId={user?.id ?? null}
      effectiveUserId={effectiveUserId ?? null}
      currentExpertSlug={user?.expertSlug ?? null}
      ownerSlug={signal?.experts?.slug ?? null}
      previewSlugFromSession={previewSlugFromSession ?? null}
      isPreviewSession={isPreviewSession}
      previewFlagFromUrl={previewFlagFromUrl}
      topLevelError={data?.error ?? null}
    />
  ) : null;

  if (!signal) {
    return (
      <UnifiedAppLayout>
        <UnavailableContent kind="journal" />
        {diagnosticsNode}
      </UnifiedAppLayout>
    );
  }

  const pubDate = new Date(signal.published_at);
  const weekStartIso = taipeiMondayOf(pubDate);
  const weekRangeLabel = taipeiWeekRangeLabelMD(weekStartIso);

  const weekTitle = richHtmlToPlain(signal.reason_summary) || '本週操作回顧';
  const TITLE_COLLAPSE_THRESHOLD = 80;
  const isTitleLong = weekTitle.length > TITLE_COLLAPSE_THRESHOLD;

  const allLearningPoints = weekSignals
    .map(s => richHtmlToPlain(s.learning_points))
    .filter(Boolean)
    .flatMap(lp => lp.split(/\\n|\n/).filter(l => l.trim()));

  const canExportPdf = hasRole('company_admin');

  const handleExportPdf = async () => {
    if (!canExportPdf) {
      toast.error('僅後台管理員可匯出 PDF');
      return;
    }
    if (isExporting) return;
    setIsExporting(true);
    setExportError(null);
    const toastId = toast.loading('驗證權限並產生 PDF 中…');
    try {
      // Backend authorization gate — refuses non-admin callers even if the
      // frontend check was bypassed.
      const { data: authz, error: authzErr } = await supabase.functions.invoke(
        'authorize-pdf-export',
        { body: {} },
      );
      if (authzErr || !authz?.allowed) {
        const msg = authz?.message || authzErr?.message || '後端拒絕匯出授權';
        throw new Error(msg);
      }

      await exportJournalPdf({
        headSignal: signal as any,
        weekSignals: weekSignals as any,
        weekStart: taipeiIsoToDisplayDate(weekStartIso),
        weekEnd: taipeiIsoToDisplayDate(taipeiWeekFridayIso(weekStartIso)),
        weekTitle,
        learningPoints: allLearningPoints,
        avatarSrc: avatarUrl(signal.experts.avatar_url, 240),
      });
      toast.success('已匯出週記 PDF', { id: toastId });
    } catch (e: any) {
      console.error('[exportJournalPdf]', e);
      const reason = e?.message ? String(e.message) : '未知錯誤';
      setExportError(reason);
      toast.error(`匯出 PDF 失敗：${reason}`, {
        id: toastId,
        duration: 8000,
        action: { label: '重試匯出', onClick: () => handleExportPdf() },
      });
    } finally {
      setIsExporting(false);
    }
  };


  return (
    <UnifiedAppLayout>
      <SEO
        title={`${(signal as any)?.instrument || '導師週記'}｜週記詳情 | legendflow`}
        description={`${(signal as any)?.instrument || ''} 實戰導師週記覆盤、策略思路與市場觀察。`}
        path={`/app/journal/${id || ''}`}
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
      {diagnosticsNode}
      <div className="p-4 space-y-4">
        {/* AI guide banner */}
        {signal.experts.slug && (
          <div className="rounded-lg border border-mentor/20 bg-mentor/5 p-3 flex items-start gap-3">
            <div className="shrink-0 rounded-full bg-mentor/10 p-1.5 text-mentor">
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">想進一步了解 {signal.experts.name} 老師？</p>
              <p className="text-xs text-muted-foreground mt-0.5">返回導師主頁查看策略與方案，或使用 AI 一對一詢問本週操作。</p>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
              <Button asChild size="sm" variant="outline" className="gap-1.5">
                <Link to={`/app/expert/${signal.experts.slug}`} data-testid="journal-back-to-expert-btn">
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  返回導師
                </Link>
              </Button>
              <Button asChild size="sm" className="gap-1.5 bg-mentor hover:bg-mentor/90 text-white">
                <Link to={`/app/expert/${signal.experts.slug}?tab=ai-chat`} data-testid="journal-ai-guide-btn">
                  <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  問 AI
                </Link>
              </Button>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center gap-3">
          <img src={avatarUrl(signal.experts.avatar_url, 80)} alt={signal.experts.name} loading="lazy" decoding="async" className="shrink-0 h-10 w-10 rounded-full object-cover object-[center_15%]" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold">{signal.experts.name}</span>
              <Badge variant="secondary" className="text-[10px]">
                {signal.experts.role === 'mentor' ? '實戰導師' : '分析師'}
              </Badge>
            </div>
          </div>
          {signal.experts.slug && (
            <Button asChild size="sm" variant="outline" className="gap-1.5 shrink-0">
              <Link to={`/app/expert/${signal.experts.slug}?tab=ai-chat`} data-testid="journal-ask-ai-btn">
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                問這位老師 AI
              </Link>
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm">{weekRangeLabel}</span>
          <Badge variant="mentor-light" className="text-[10px]">T+7 歷史</Badge>
        </div>

        {timeline && timeline.segments && timeline.segments.length > 0 && (
          <SubscriptionTimeline
            segments={timeline.segments}
            expertName={signal.experts?.name}
            expertAvatarUrl={signal.experts?.avatar_url ?? null}
            showMentorLookback
            highlightAt={new Date(signal.published_at)}
          />
        )}



        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h1
              id="journal-week-title"
              className={`text-xl font-bold break-words transition-[max-height] duration-300 ease-out overflow-hidden ${
                isTitleLong
                  ? titleExpanded
                    ? 'max-h-[60rem]'
                    : 'max-h-[3.75rem] line-clamp-2'
                  : ''
              }`}
            >
              {weekTitle}
            </h1>
            {isTitleLong && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setTitleExpanded(v => !v)}
                aria-expanded={titleExpanded}
                aria-controls="journal-week-title"
                className="mt-1 h-8 px-2 -ml-2 gap-1 text-xs text-mentor hover:text-mentor"
              >
                {titleExpanded ? (
                  <>
                    <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                    收合
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    顯示全部
                  </>
                )}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {canExportPdf && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleExportPdf}
                disabled={isExporting}
                className="h-8 gap-1.5"
                aria-label="匯出週記 PDF（後台專用）"
                title="後台專用：匯出週記 PDF"
              >
                {isExporting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span className="text-xs">{isExporting ? '產生中…' : '匯出 PDF'}</span>
              </Button>
            )}
            {id && <ShareButton target={{ kind: "journal", id }} />}
        </div>

        {exportError && (
          <div
            role="alert"
            aria-live="assertive"
            className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
          >
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-destructive">PDF 匯出失敗</p>
              <p className="text-xs text-muted-foreground break-words mt-0.5">{exportError}</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleExportPdf}
              disabled={isExporting}
              className="h-8 gap-1.5 shrink-0"
            >
              {isExporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span className="text-xs">重試匯出</span>
            </Button>
          </div>
        )}
        </div>


        {/* Summary */}
        {signal.reason_detail && (
          <Card>
            <CardContent className="p-4">
              <h2 className="font-semibold mb-2">本週整體摘要</h2>
              <SafeRichHtml html={signal.reason_detail} />
            </CardContent>
          </Card>
        )}

        {/* Trades with expandable details */}
        {weekSignals.length > 0 && (
          <div>
            <h2 className="font-semibold mb-3">本週操作列表</h2>
            <Card>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {weekSignals.map(ws => (
                    <TradeItem key={ws.id} signal={ws} nameMap={nameMap} showDebug={showDiagnostics || searchParams.get('debug') === '1'} />
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Learning Points */}
        {allLearningPoints.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <h2 className="font-semibold mb-2 flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-mentor" /> 本週教學重點
              </h2>
              <ul className="space-y-2">
                {allLearningPoints.map((point, idx) => (
                  <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="text-mentor">•</span> {point}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Disclaimer */}
        <Card className="bg-muted/30">
          <CardContent className="p-4 flex items-start gap-2">
            <Shield className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
            <p className="text-xs text-muted-foreground">
              本頁內容為一週前之操作回顧（T+7），僅供教學用途，不構成任何即時投資建議。
            </p>
          </CardContent>
        </Card>
      </div>
    </UnifiedAppLayout>
  );
};

export default JournalDetail;
