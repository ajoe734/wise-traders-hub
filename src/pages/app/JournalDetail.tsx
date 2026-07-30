import { ShareButton } from '@/components/ShareButton';
import { SEO } from '@/components/SEO';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { UnifiedAppLayout, markAppJournalsAsRead } from '@/components/layouts/UnifiedAppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { taipeiMondayOf, taipeiWeekRangeLabelMD } from '@/lib/taipeiWeek';
import { Calendar, BookOpen, Shield, Loader2, ChevronDown, ChevronUp, AlertTriangle, Eye, Download, MessageCircle, ArrowLeft } from 'lucide-react';
import { richHtmlToPlain } from '@/components/SafeRichHtml';
import { SafeRichHtml } from '@/components/SafeRichHtml';
import { avatarUrl } from '@/lib/imageTransform';
import { SubscriptionTimeline } from '@/components/SubscriptionTimeline';
import { UnavailableContent } from '@/components/UnavailableContent';
import {
  TradeItem,
  PreviewDiagnosticsBlock,
  useJournalDetail,
  useJournalPdfExport,
} from './_journalDetail';

export type { JournalFetchSource, JournalFetchDiagnostics } from '@/lib/journalRepository';
export type { SignalDetail } from './_journalDetail';

const JournalDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const { user, hasRole } = useAuth();
  const [titleExpanded, setTitleExpanded] = useState(false);

  const previewFlagFromUrl = searchParams.get('preview') === '1';
  const {
    loading,
    signal,
    weekSignals,
    diagnostics,
    topLevelError,
    timeline,
    nameMap,
    effectiveUserId,
    isPreviewSession,
    previewSlugFromSession,
    showDiagnostics,
  } = useJournalDetail(id, previewFlagFromUrl);

  const { isExporting, exportError, exportPdf } = useJournalPdfExport();

  const isPreview = previewFlagFromUrl && (
    (signal?.experts?.slug && user?.expertSlug === signal.experts.slug) || hasRole('company_admin')
  );

  useEffect(() => {
    markAppJournalsAsRead();
  }, []);

  if (loading) {
    return (
      <UnifiedAppLayout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </UnifiedAppLayout>
    );
  }

  const diagnosticsNode = showDiagnostics ? (
    <PreviewDiagnosticsBlock
      diagnostics={diagnostics}
      currentUserId={user?.id ?? null}
      effectiveUserId={effectiveUserId ?? null}
      currentExpertSlug={user?.expertSlug ?? null}
      ownerSlug={signal?.experts?.slug ?? null}
      previewSlugFromSession={previewSlugFromSession ?? null}
      isPreviewSession={isPreviewSession}
      previewFlagFromUrl={previewFlagFromUrl}
      topLevelError={topLevelError}
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

  const handleExportPdf = () => exportPdf({
    signal,
    weekSignals,
    weekStartIso,
    weekTitle,
    learningPoints: allLearningPoints,
    canExportPdf,
  });

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
