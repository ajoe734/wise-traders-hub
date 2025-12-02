import { useParams, Link } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RoleBadge } from '@/components/RoleBadge';
import { ActionBadge } from '@/components/ActionBadge';
import { getSignalById } from '@/data/mockData';
import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { AlertTriangle, BookOpen, ArrowLeft, Lightbulb, Target, Shield } from 'lucide-react';

const SignalDetail = () => {
  const { id } = useParams<{ id: string }>();
  const signal = id ? getSignalById(id) : undefined;

  if (!signal) {
    return <AppLayout><div className="p-4 text-center">找不到此訊號</div></AppLayout>;
  }

  return (
    <AppLayout>
      <div className="p-4 space-y-4">
        <Link to="/app/signals" className="flex items-center gap-1 text-sm text-muted-foreground mb-2">
          <ArrowLeft className="h-4 w-4" /> 返回訊號牆
        </Link>

        {/* Header */}
        <div className="flex items-center gap-3">
          <ActionBadge action={signal.action} />
          <span className="text-2xl font-bold">{signal.instrument}</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{format(signal.timeTrade, 'yyyy/MM/dd HH:mm', { locale: zhTW })}</span>
          <span>•</span>
          <span>{signal.person.name}</span>
          <RoleBadge role={signal.person.role} size="sm" />
        </div>

        {/* Why */}
        <Card>
          <CardContent className="p-4">
            <h2 className="font-semibold mb-2 flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-primary" /> 為什麼這樣操作？
            </h2>
            <p className="text-sm text-muted-foreground whitespace-pre-line">{signal.reasonDetail}</p>
          </CardContent>
        </Card>

        {/* Position Notes */}
        {signal.positionNotes.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <h2 className="font-semibold mb-2 flex items-center gap-2">
                <Target className="h-4 w-4 text-advisor" /> 部位控管想法
              </h2>
              <ul className="space-y-2">
                {signal.positionNotes.map((note, idx) => (
                  <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="text-advisor">•</span> {note}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Risk Notes */}
        {signal.riskNotes.length > 0 && (
          <Card className="bg-warning-light/30 border-warning/20">
            <CardContent className="p-4">
              <h2 className="font-semibold mb-2 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" /> 風險提醒
              </h2>
              <ul className="space-y-2">
                {signal.riskNotes.map((note, idx) => (
                  <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="text-warning">•</span> {note}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Learning Points */}
        {signal.learningPoints.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <h2 className="font-semibold mb-2 flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-mentor" /> 延伸學習
              </h2>
              <ul className="space-y-2 mb-4">
                {signal.learningPoints.map((point, idx) => (
                  <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="text-mentor">•</span> {point}
                  </li>
                ))}
              </ul>
              <Button variant="outline" size="sm" className="w-full" asChild>
                <Link to={`/app/system/${signal.systemId}`}>看完整交易系統教學</Link>
              </Button>
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
    </AppLayout>
  );
};

export default SignalDetail;
