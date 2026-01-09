import { useParams, Link } from 'react-router-dom';
import { LineLayout } from '@/components/layouts/LineLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getPersonBySlug, getSignalsForUser } from '@/data/mockData';
import { useAuth } from '@/contexts/AuthContext';
import { PersonRole, SignalAction } from '@/types';
import { History, TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

const LineTrades = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const { user } = useAuth();
  const expert = expertSlug ? getPersonBySlug(expertSlug) : undefined;

  const isAdvisor = expert?.role === PersonRole.ADVISOR;

  // Get trades for this expert
  const allSignals = user ? getSignalsForUser(user.id) : [];
  const expertSignals = allSignals.filter(s => s.person.slug === expertSlug);

  const getActionLabel = (action: SignalAction) => {
    switch (action) {
      case SignalAction.BUY: return '買進';
      case SignalAction.SELL: return '賣出';
      case SignalAction.ADD: return '加碼';
      case SignalAction.TRIM: return '減碼';
      case SignalAction.EXIT: return '出場';
    }
  };

  const getActionColor = (action: SignalAction) => {
    switch (action) {
      case SignalAction.BUY:
      case SignalAction.ADD:
        return 'text-success bg-success/10';
      case SignalAction.SELL:
      case SignalAction.TRIM:
      case SignalAction.EXIT:
        return 'text-destructive bg-destructive/10';
    }
  };

  return (
    <LineLayout>
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="mb-4">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <History className="h-5 w-5" />
            交易紀錄
          </h1>
          <p className="text-sm text-muted-foreground">
            {isAdvisor 
              ? '策略的實際/模擬操作紀錄'
              : '延遲至少 7 天的操作紀錄（教學用）'
            }
          </p>
        </div>

        {/* Trade List */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">近期交易</CardTitle>
          </CardHeader>
          <CardContent>
            {expertSignals.length > 0 ? (
              <div className="divide-y">
                {expertSignals.map(signal => (
                  <Link 
                    key={signal.id}
                    to={`/line/${expertSlug}/signal/${signal.id}`}
                    className="flex items-center justify-between py-3 hover:bg-muted/30 -mx-4 px-4"
                  >
                    <div className="flex items-center gap-3">
                      {signal.action === SignalAction.BUY || signal.action === SignalAction.ADD ? (
                        <TrendingUp className="h-4 w-4 text-success" />
                      ) : (
                        <TrendingDown className="h-4 w-4 text-destructive" />
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{signal.instrument}</span>
                          <Badge className={cn("text-xs", getActionColor(signal.action))}>
                            {getActionLabel(signal.action)}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {format(signal.timeTrade, 'MM/dd HH:mm')}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">→</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-4">
                暫無交易紀錄
              </p>
            )}
          </CardContent>
        </Card>

        {/* Note */}
        {!isAdvisor && (
          <div className="p-3 bg-mentor/5 rounded-lg text-sm">
            <p className="text-mentor font-medium mb-1">📋 教學用途說明</p>
            <p className="text-muted-foreground text-xs">
              所有交易紀錄已延遲至少 7 天，僅作為歷史案例教學，不構成即時投資建議。
            </p>
          </div>
        )}

        {/* Compliance */}
        <div className="compliance-disclaimer">
          過去績效不代表未來表現，投資有風險，請謹慎評估。
        </div>
      </div>
    </LineLayout>
  );
};

export default LineTrades;