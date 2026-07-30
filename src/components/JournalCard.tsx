import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChevronRight, Calendar, BookOpen } from 'lucide-react';
import { taipeiWeekRangeLabelMD } from '@/lib/taipeiWeek';
import { richHtmlPreview, PREVIEW_LIMITS } from '@/components/SafeRichHtml';
import { avatarUrl } from '@/lib/imageTransform';
import { track } from '@/lib/analytics/events';
import { AssetBadge } from '@/components/AssetFilterChips';

interface JournalSignal {
  id: string;
  instrument: string;
  action: string;
  reason_summary: string | null;
  reason_detail: string | null;
  learning_points: string | null;
  published_at: string;
}

interface JournalCardProps {
  /** Taipei 週一 YYYY-MM-DD */
  weekStart: string;
  signals: JournalSignal[];
  expert: {
    name: string;
    slug: string;
    role: string;
    avatar_url: string | null;
    asset_class?: string | null;
    currency?: string | null;
  };
  to: string;
}

export function JournalCard({ weekStart, signals, expert, to }: JournalCardProps) {
  // Mon-Fri range (Asia/Taipei，純字串運算，不受瀏覽器時區影響)
  const weekRangeLabel = taipeiWeekRangeLabelMD(weekStart);

  // Use first signal's reason_summary as the weekly title
  const weekTitle = richHtmlPreview(signals[0]?.reason_summary, PREVIEW_LIMITS.cardTitle) || null;
  // Use first signal's reason_detail as the summary paragraph
  const weekSummary = richHtmlPreview(signals[0]?.reason_detail, PREVIEW_LIMITS.cardSummary) || null;

  // Collect unique learning points from all signals
  const allPoints = signals
    .map(s => richHtmlPreview(s.learning_points, PREVIEW_LIMITS.learningPointsCard))
    .filter(Boolean)
    .flatMap(lp => lp!.split('\n').filter(l => l.trim()));

  return (
    <Link
      to={to}
      onClick={() => track('journal_card_click', {
        journal_id: signals[0]?.id ?? 'unknown',
        expert_slug: expert.slug,
      })}
    >
      <Card variant="interactive" className="overflow-hidden hover:border-mentor/30">
        <CardContent className="p-4">
          {/* Expert Info */}
          <div className="flex items-center gap-2 mb-3">
            <img
              src={avatarUrl(expert.avatar_url, 64)}
              alt={expert.name}
              loading="lazy"
              decoding="async"
              className="shrink-0 h-8 w-8 rounded-full object-cover object-[center_15%]"
            />
            <span className="font-medium">{expert.name}</span>
            <Badge variant="secondary" className="text-[10px]">
              {expert.role === 'mentor' ? '實戰導師' : '分析師'}
            </Badge>
            <AssetBadge source={expert} />
          </div>

          {/* Week Range */}
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">
              {weekRangeLabel}
            </span>
            <Badge variant="mentor-light" className="text-[10px] ml-auto">
              已解鎖（T+7 歷史）
            </Badge>
          </div>

          {/* Weekly Title */}
          {weekTitle && (
            <h3 className="font-bold text-mentor mb-2">{weekTitle}</h3>
          )}

          {/* Summary */}
          {weekSummary && (
            <p className="text-sm text-muted-foreground line-clamp-3 mb-3">{weekSummary}</p>
          )}

          {/* Trade count */}
          <div className="flex items-center gap-1 text-xs text-muted-foreground mb-3">
            <BookOpen className="h-3.5 w-3.5" />
            <span>本週 {signals.length} 筆操作</span>
          </div>

          {/* Learning Points Preview */}
          {allPoints.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {allPoints.slice(0, 2).map((point, idx) => (
                <Badge key={idx} variant="secondary" className="text-xs font-normal">
                  {point.slice(0, 20)}{point.length > 20 ? '...' : ''}
                </Badge>
              ))}
            </div>
          )}

          {/* CTA */}
          <div className="flex items-center justify-end text-sm text-mentor font-medium">
            查看本週詳細教學
            <ChevronRight className="h-4 w-4 ml-1" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}