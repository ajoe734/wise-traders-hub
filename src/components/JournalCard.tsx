import { Link } from 'react-router-dom';
import { JournalWithPerson } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RoleBadge } from '@/components/RoleBadge';
import { ChevronRight, Calendar, BookOpen } from 'lucide-react';
import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';

interface JournalCardProps {
  journal: JournalWithPerson;
  showPerson?: boolean;
}

export function JournalCard({ journal, showPerson = true }: JournalCardProps) {
  const formatDate = (date: Date) => {
    return format(date, 'MM/dd', { locale: zhTW });
  };

  return (
    <Link to={`/app/journal/${journal.id}`}>
      <Card variant="interactive" className="overflow-hidden hover:border-mentor/30">
        <CardContent className="p-4">
          {/* Person Info */}
          {showPerson && (
            <div className="flex items-center gap-2 mb-3">
              <img
                src={journal.person.avatarUrl || '/placeholder.svg'}
                alt={journal.person.name}
                className="h-8 w-8 rounded-full object-cover"
              />
              <span className="font-medium">{journal.person.name}</span>
              <RoleBadge role={journal.person.role} size="sm" />
            </div>
          )}

          {/* Week Range */}
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">
              {formatDate(journal.weekStart)} ~ {formatDate(journal.weekEnd)}
            </span>
            <Badge variant="mentor-light" className="text-[10px] ml-auto">
              已解鎖（T+7 歷史）
            </Badge>
          </div>

          {/* Title */}
          <h3 className="font-semibold mb-2 line-clamp-1">{journal.title}</h3>

          {/* Summary */}
          <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
            {journal.summary}
          </p>

          {/* Stats */}
          {journal.trades && journal.trades.length > 0 && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
              <span className="flex items-center gap-1">
                <BookOpen className="h-3.5 w-3.5" />
                本週 {journal.trades.length} 筆操作
              </span>
            </div>
          )}

          {/* Learning Points Preview */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {journal.learningPoints.slice(0, 2).map((point, idx) => (
              <Badge key={idx} variant="secondary" className="text-xs">
                {point.slice(0, 15)}...
              </Badge>
            ))}
          </div>

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
