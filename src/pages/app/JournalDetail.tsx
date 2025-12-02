import { useParams, Link } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RoleBadge } from '@/components/RoleBadge';
import { ActionBadge } from '@/components/ActionBadge';
import { getJournalById } from '@/data/mockData';
import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { ArrowLeft, Calendar, BookOpen, Shield } from 'lucide-react';

const JournalDetail = () => {
  const { id } = useParams<{ id: string }>();
  const journal = id ? getJournalById(id) : undefined;

  if (!journal) {
    return <AppLayout><div className="p-4 text-center">找不到此週記</div></AppLayout>;
  }

  return (
    <AppLayout>
      <div className="p-4 space-y-4">
        <Link to={`/line/${journal.person.slug}/signals`} className="flex items-center gap-1 text-sm text-muted-foreground mb-2">
          <ArrowLeft className="h-4 w-4" /> 返回週記列表
        </Link>

        {/* Header */}
        <div className="flex items-center gap-3">
          <img src={journal.person.avatarUrl || '/placeholder.svg'} alt={journal.person.name} className="h-10 w-10 rounded-full object-cover" />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">{journal.person.name}</span>
              <RoleBadge role={journal.person.role} size="sm" />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm">{format(journal.weekStart, 'MM/dd', { locale: zhTW })} ~ {format(journal.weekEnd, 'MM/dd', { locale: zhTW })}</span>
          <Badge variant="mentor-light" className="text-[10px]">T+7 歷史</Badge>
        </div>

        <h1 className="text-xl font-bold">{journal.title}</h1>

        {/* Summary */}
        <Card>
          <CardContent className="p-4">
            <h2 className="font-semibold mb-2">本週整體摘要</h2>
            <p className="text-sm text-muted-foreground">{journal.summary}</p>
          </CardContent>
        </Card>

        {/* Trades */}
        {journal.trades && journal.trades.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <h2 className="font-semibold mb-3">本週操作列表</h2>
              <div className="space-y-3">
                {journal.trades.map(trade => (
                  <div key={trade.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/50">
                    <ActionBadge action={trade.action} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{trade.instrument}</span>
                        <span className="text-xs text-muted-foreground">{format(trade.date, 'MM/dd')}</span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{trade.reason}</p>
                    </div>
                    {trade.outcome && (
                      <Badge variant={trade.outcome.includes('獲利') ? 'success-light' : 'warning-light'} className="text-[10px]">
                        {trade.outcome}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Learning Points */}
        <Card>
          <CardContent className="p-4">
            <h2 className="font-semibold mb-2 flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-mentor" /> 本週教學重點
            </h2>
            <ul className="space-y-2">
              {journal.learningPoints.map((point, idx) => (
                <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                  <span className="text-mentor">•</span> {point}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

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
    </AppLayout>
  );
};

export default JournalDetail;
