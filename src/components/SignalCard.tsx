import { Link } from 'react-router-dom';
import { SignalWithPerson } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RoleBadge } from '@/components/RoleBadge';
import { ActionBadge } from '@/components/ActionBadge';
import { ChevronRight, Clock } from 'lucide-react';
import { format, isToday, differenceInHours } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { avatarUrl } from '@/lib/imageTransform';

interface SignalCardProps {
  signal: SignalWithPerson;
  /** Custom link path. If not provided, defaults to LINE mini-app path */
  to?: string;
}

export function SignalCard({ signal, to }: SignalCardProps) {
  const linkPath = to ?? `/line/${signal.person.slug}/signal/${signal.id}`;
  const isRecent = differenceInHours(new Date(), signal.timeTrade) < 24;

  const formatTime = (date: Date) => {
    return format(date, 'MM/dd HH:mm', { locale: zhTW });
  };

  return (
    <Link to={linkPath}>
      <Card variant="interactive" className="overflow-hidden">
        <CardContent className="p-4">
          {/* Top Row: Time & Status */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <span>{formatTime(signal.timeTrade)}</span>
            </div>
            {isToday(signal.timeTrade) ? (
              <Badge variant="success-light" className="text-[10px]">即時</Badge>
            ) : isRecent ? (
              <Badge variant="warning-light" className="text-[10px]">近期</Badge>
            ) : null}
          </div>

          {/* Middle: Instrument & Action */}
          <div className="flex items-center gap-3 mb-3">
            <ActionBadge action={signal.action} />
            <span className="font-semibold text-lg">{signal.instrument}</span>
          </div>

          {/* Source */}
          <div className="flex items-center gap-2 mb-3">
            <img
              src={avatarUrl(signal.person.avatarUrl, 48)}
              alt={signal.person.name}
              loading="lazy"
              decoding="async"
              className="shrink-0 h-6 w-6 rounded-full object-cover object-[center_15%]"
            />
            <span className="text-sm text-muted-foreground">
              {signal.person.name}
            </span>
            <RoleBadge role={signal.person.role} size="sm" />
          </div>

          {/* Summary */}
          <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
            {signal.reasonSummary}
          </p>

          {/* Risk Note Preview */}
          {signal.riskNotes.length > 0 && (
            <div className="bg-warning-light/50 rounded-lg p-2.5 text-xs text-warning mb-3">
              💡 {signal.riskNotes[0].slice(0, 50)}...
            </div>
          )}

          {/* CTA */}
          <div className="flex items-center justify-end text-sm text-primary font-medium">
            查看詳解與教學
            <ChevronRight className="h-4 w-4 ml-1" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
