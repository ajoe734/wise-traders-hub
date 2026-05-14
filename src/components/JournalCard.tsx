import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChevronRight, Calendar, BookOpen } from 'lucide-react';
import { format, startOfWeek, addDays } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { richHtmlPreview } from '@/components/SafeRichHtml';
import { avatarUrl } from '@/lib/imageTransform';

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
  weekStart: Date;
  weekEnd: Date;
  signals: JournalSignal[];
  expert: {
    name: string;
    slug: string;
    role: string;
    avatar_url: string | null;
  };
  to: string;
}

export function JournalCard({ weekStart, weekEnd, signals, expert, to }: JournalCardProps) {
  // Compute Mon-Fri range from weekStart (Monday)
  const monDate = startOfWeek(weekStart, { weekStartsOn: 1 });
  const friDate = addDays(monDate, 4);
  const formatDate = (date: Date) => format(date, 'MM/dd', { locale: zhTW });

  // Use first signal's reason_summary as the weekly title
  const weekTitle = richHtmlPreview(signals[0]?.reason_summary, 80) || null;
  // Use first signal's reason_detail as the summary paragraph
  const weekSummary = richHtmlPreview(signals[0]?.reason_detail, 220) || null;

  // Collect unique learning points from all signals
  const allPoints = signals
    .map(s => richHtmlPreview(s.learning_points, 500))
    .filter(Boolean)
    .flatMap(lp => lp!.split('\n').filter(l => l.trim()));

  return (
    <Link to={to}>
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
          </div>

          {/* Week Range */}
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">
              {formatDate(monDate)} ~ {formatDate(friDate)}
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