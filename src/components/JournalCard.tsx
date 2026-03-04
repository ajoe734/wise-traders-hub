import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChevronRight, Calendar, BookOpen } from 'lucide-react';
import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';

interface JournalSignal {
  id: string;
  instrument: string;
  action: string;
  reason_summary: string | null;
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

const actionLabel: Record<string, string> = {
  buy: '買進', sell: '賣出', add: '加碼', trim: '減碼', exit: '出場',
};

export function JournalCard({ weekStart, weekEnd, signals, expert, to }: JournalCardProps) {
  const formatDate = (date: Date) => format(date, 'MM/dd', { locale: zhTW });

  // Collect unique learning points from all signals in this week
  const allPoints = signals
    .map(s => s.learning_points)
    .filter(Boolean)
    .flatMap(lp => lp!.split('\n').filter(l => l.trim()));

  return (
    <Link to={to}>
      <Card variant="interactive" className="overflow-hidden hover:border-mentor/30">
        <CardContent className="p-4">
          {/* Expert Info */}
          <div className="flex items-center gap-2 mb-3">
            <img
              src={expert.avatar_url || '/placeholder.svg'}
              alt={expert.name}
              className="h-8 w-8 rounded-full object-cover"
            />
            <span className="font-medium">{expert.name}</span>
            <Badge variant="secondary" className="text-[10px]">
              {expert.role === 'mentor' ? '實戰導師' : '分析師'}
            </Badge>
          </div>

          {/* Week Range */}
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">
              {formatDate(weekStart)} ~ {formatDate(weekEnd)}
            </span>
            <Badge variant="mentor-light" className="text-[10px] ml-auto">
              已解鎖（T+7 歷史）
            </Badge>
          </div>

          {/* Trades summary */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
            <span className="flex items-center gap-1">
              <BookOpen className="h-3.5 w-3.5" />
              本週 {signals.length} 筆操作
            </span>
            <div className="flex gap-1">
              {signals.slice(0, 3).map(s => (
                <Badge key={s.id} variant="outline" className="text-[10px]">
                  {actionLabel[s.action] || s.action} {s.instrument}
                </Badge>
              ))}
              {signals.length > 3 && (
                <Badge variant="outline" className="text-[10px]">+{signals.length - 3}</Badge>
              )}
            </div>
          </div>

          {/* First signal summary as preview */}
          {signals[0]?.reason_summary && (
            <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
              {signals[0].reason_summary}
            </p>
          )}

          {/* Learning Points Preview */}
          {allPoints.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {allPoints.slice(0, 2).map((point, idx) => (
                <Badge key={idx} variant="secondary" className="text-xs">
                  {point.slice(0, 15)}{point.length > 15 ? '...' : ''}
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
