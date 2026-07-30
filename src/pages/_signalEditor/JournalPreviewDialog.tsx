import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ActionBadge } from '@/components/ActionBadge';
import { SafeRichHtml, richHtmlToPlain } from '@/components/SafeRichHtml';
import { avatarUrl } from '@/lib/imageTransform';
import { Calendar, BookOpen, Shield, Lightbulb, Target, AlertTriangle, Eye } from 'lucide-react';
import { format } from 'date-fns';
import { taipeiMondayOf, taipeiWeekRangeLabelMD } from '@/lib/taipeiWeek';
import { zhTW } from 'date-fns/locale';
import type { TradeDraft } from '@/pages/_signalEditor/types';
import { sanitizeRichHtml, isHtmlEmpty } from '@/lib/sanitizeHtml';
import { resolveAssetClass, sanitizeAssetQuantityUnit } from '@/lib/asset';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  expert:
    | { name?: string; role?: string; avatar_url?: string | null; asset_class?: string | null; currency?: string | null }
    | null;
  isTeachingOnly: boolean;
  teachingTopic: string;
  overallSummary: string;
  learningPoints: string;
  trades: TradeDraft[];
}

/**
 * 發布前的「前台預覽」：盡量比照 src/pages/app/JournalDetail.tsx 的版型，
 * 直接吃編輯器 state，未經 DB / sanitize（呈現端用 SafeRichHtml 仍會 sanitize）。
 */
export function JournalPreviewDialog({
  open, onOpenChange, expert, isTeachingOnly,
  teachingTopic, overallSummary, learningPoints, trades,
}: Props) {
  const weekStartIso = taipeiMondayOf(new Date());
  const weekRangeLabel = taipeiWeekRangeLabelMD(weekStartIso);
  const assetClass = resolveAssetClass(expert);

  const displayTrades = isTeachingOnly ? [] : trades.filter(t => t.stockCode || t.stockName || t.action);

  const weekTitle =
    teachingTopic.trim() ||
    richHtmlToPlain(sanitizeRichHtml(overallSummary)) ||
    '本週操作回顧';

  const learningPointsList = !isHtmlEmpty(learningPoints)
    ? richHtmlToPlain(sanitizeRichHtml(learningPoints))
        .split(/\n|\\n/).map(s => s.trim()).filter(Boolean)
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
        <div className="sticky top-0 z-10 bg-amber-500 text-amber-50 px-4 py-2 text-sm flex items-center justify-center gap-2 shadow">
          <Eye className="h-4 w-4" />
          <span className="font-medium">🔍 前台預覽（尚未發布）</span>
        </div>
        <DialogHeader className="px-4 pt-4">
          <DialogTitle className="sr-only">週記前台預覽</DialogTitle>
          <DialogDescription className="sr-only">
            這是發布後在會員端看到的呈現方式，圖片與排版皆與正式頁面一致。
          </DialogDescription>
        </DialogHeader>

        <div className="p-4 space-y-4">
          {/* Header */}
          <div className="flex items-center gap-3">
            <img
              src={avatarUrl(expert?.avatar_url || null, 80)}
              alt={expert?.name || ''}
              className="shrink-0 h-10 w-10 rounded-full object-cover object-[center_15%]"
            />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">{expert?.name || '（未命名）'}</span>
                <Badge variant="secondary" className="text-[10px]">
                  {expert?.role === 'mentor' ? '實戰導師' : '分析師'}
                </Badge>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">
              {weekRangeLabel}
            </span>
            <Badge variant="secondary" className="text-[10px]">T+7 歷史</Badge>
          </div>

          <h1 className="text-xl font-bold break-words">{weekTitle}</h1>

          {/* Overall summary */}
          {!isHtmlEmpty(overallSummary) && (
            <Card>
              <CardContent className="p-4">
                <h2 className="font-semibold mb-2">本週整體摘要</h2>
                <SafeRichHtml html={overallSummary} />
              </CardContent>
            </Card>
          )}

          {/* Trade list (skip in teaching-only) */}
          {displayTrades.length > 0 && (
            <div>
              <h2 className="font-semibold mb-3">本週操作列表</h2>
              <Card>
                <CardContent className="p-0">
                  <div className="divide-y divide-border">
                    {displayTrades.map(t => {
                      const instrument = [t.stockCode, t.stockName].filter(Boolean).join(' ') || '（未填股票）';
                      const price = t.priceHint?.trim();
                      const qty = t.quantity?.trim();
                      const hasDetails =
                        !isHtmlEmpty(t.reasonSummary) ||
                        !isHtmlEmpty(t.reasonDetail) ||
                        !isHtmlEmpty(t.riskNotes);
                      return (
                        <div key={t.uid} className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            {t.action ? <ActionBadge action={t.action as any} size="sm" /> : (
                              <Badge variant="outline" className="text-[10px]">未選方向</Badge>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-sm">{instrument}</span>
                                {(price || qty) && (
                                  <span className="text-xs text-foreground/80 font-medium">
                                    {price && <>價 {price}</>}
                                    {price && qty && <span className="mx-1 text-muted-foreground">·</span>}
                                {qty && <>{qty} {sanitizeAssetQuantityUnit(t.quantityUnit, assetClass)}</>}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          {hasDetails && (
                            <div className="mt-3 ml-9 space-y-3">
                              {!isHtmlEmpty(t.reasonSummary) && (
                                <div>
                                  <h3 className="text-xs font-semibold flex items-center gap-1.5 mb-1">
                                    <Lightbulb className="h-3.5 w-3.5 text-primary" /> 為什麼這樣操作？
                                  </h3>
                                  <SafeRichHtml html={t.reasonSummary} className="text-xs" />
                                </div>
                              )}
                              {!isHtmlEmpty(t.reasonDetail) && (
                                <div>
                                  <h3 className="text-xs font-semibold flex items-center gap-1.5 mb-1">
                                    <Target className="h-3.5 w-3.5 text-primary" /> 部位控管想法
                                  </h3>
                                  <SafeRichHtml html={t.reasonDetail} className="text-xs" />
                                </div>
                              )}
                              {!isHtmlEmpty(t.riskNotes) && (
                                <div>
                                  <h3 className="text-xs font-semibold flex items-center gap-1.5 mb-1 text-warning">
                                    <AlertTriangle className="h-3.5 w-3.5" /> 風險提醒
                                  </h3>
                                  <SafeRichHtml html={t.riskNotes} className="text-xs" />
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Learning points */}
          {learningPointsList.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <h2 className="font-semibold mb-2 flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-mentor" /> 本週教學重點
                </h2>
                {/* 直接渲染 HTML 保留圖片與格式；同時若使用者用條列分行，仍可閱讀 */}
                <SafeRichHtml html={learningPoints} />
              </CardContent>
            </Card>
          )}

          {/* Empty hint */}
          {isTeachingOnly && isHtmlEmpty(overallSummary) && isHtmlEmpty(learningPoints) && !teachingTopic.trim() && (
            <p className="text-sm text-muted-foreground text-center py-6">
              還沒有內容，填好教學主題 / 整體摘要 / 教學重點再預覽。
            </p>
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
      </DialogContent>
    </Dialog>
  );
}
