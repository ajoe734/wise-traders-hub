import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { LineLayout } from '@/components/layouts/LineLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getPersonBySlug, getSignalsForUser, getJournalsForUser } from '@/data/mockData';
import { useAuth } from '@/contexts/AuthContext';
import { PersonRole, SignalAction } from '@/types';
import { Filter, Calendar, TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

const LineSignals = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const { user } = useAuth();
  const expert = expertSlug ? getPersonBySlug(expertSlug) : undefined;
  const [actionFilter, setActionFilter] = useState<SignalAction | null>(null);

  if (!expert) {
    return null;
  }

  const isAdvisor = expert.role === PersonRole.ADVISOR;

  // Get signals or journals for this expert
  const allSignals = user ? getSignalsForUser(user.id) : [];
  const expertSignals = allSignals.filter(s => s.person.slug === expertSlug);
  
  const allJournals = user ? getJournalsForUser(user.id) : [];
  const expertJournals = allJournals.filter(j => j.person.slug === expertSlug);

  const filteredSignals = actionFilter 
    ? expertSignals.filter(s => s.action === actionFilter)
    : expertSignals;

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
          <h1 className="text-xl font-bold">
            {isAdvisor ? '即時訊號牆' : '實戰週記'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isAdvisor 
              ? `${expert.name} 的即時策略訊號`
              : `${expert.name} 的 T+7 操作回顧`
            }
          </p>
        </div>

        {/* Advisor: Signal List */}
        {isAdvisor && (
          <>
            {/* Filters */}
            <div className="flex items-center gap-2 overflow-x-auto pb-2">
              <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
              <Button
                variant={actionFilter === null ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setActionFilter(null)}
              >
                全部
              </Button>
              {Object.values(SignalAction).map(action => (
                <Button
                  key={action}
                  variant={actionFilter === action ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setActionFilter(action)}
                >
                  {getActionLabel(action)}
                </Button>
              ))}
            </div>

            {/* Signal Cards */}
            {filteredSignals.length > 0 ? (
              <div className="space-y-3">
                {filteredSignals.map(signal => (
                  <Card key={signal.id} variant="interactive">
                    <Link to={`/line/${expertSlug}/signal/${signal.id}`}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Badge className={cn("text-xs", getActionColor(signal.action))}>
                              {getActionLabel(signal.action)}
                            </Badge>
                            {new Date().getTime() - signal.timeTrade.getTime() < 24 * 60 * 60 * 1000 && (
                              <Badge variant="advisor" className="text-xs">即時</Badge>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {format(signal.timeTrade, 'MM/dd HH:mm')}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mb-2">
                          {signal.action === SignalAction.BUY || signal.action === SignalAction.ADD ? (
                            <TrendingUp className="h-4 w-4 text-success" />
                          ) : (
                            <TrendingDown className="h-4 w-4 text-destructive" />
                          )}
                          <span className="font-bold text-lg">{signal.instrument}</span>
                          {signal.priceHint && (
                            <span className="text-sm text-muted-foreground">
                              {signal.priceHint}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {signal.reasonSummary}
                        </p>
                        {signal.riskNotes.length > 0 && (
                          <p className="text-xs text-warning mt-2 line-clamp-1">
                            ⚠️ {signal.riskNotes[0]}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-2">
                          點擊查看詳解與教學 →
                        </p>
                      </CardContent>
                    </Link>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="bg-muted/30">
                <CardContent className="py-8 text-center">
                  <p className="text-muted-foreground">目前沒有符合條件的訊號</p>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* Mentor: Weekly Journals */}
        {!isAdvisor && (
          <>
            {expertJournals.length > 0 ? (
              <div className="space-y-4">
                {expertJournals.map(journal => (
                  <Card key={journal.id} className="overflow-hidden">
                    <div className="h-1 gradient-mentor" />
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">
                          {format(journal.weekStart, 'yyyy/MM/dd')} - {format(journal.weekEnd, 'MM/dd')}
                        </span>
                        <Badge variant="mentor-light" className="text-xs">
                          T+7 已解鎖
                        </Badge>
                      </div>
                      <h3 className="font-semibold mb-2">{journal.title}</h3>
                      <p className="text-sm text-muted-foreground mb-3">
                        {journal.summary}
                      </p>
                      
                      {/* Trades in this week */}
                      {journal.trades && journal.trades.length > 0 && (
                        <div className="space-y-2 mb-3">
                          <p className="text-xs font-medium text-muted-foreground">
                            本週操作 ({journal.trades.length} 筆)
                          </p>
                          {journal.trades.map(trade => (
                            <div key={trade.id} className="flex items-center justify-between text-sm p-2 bg-muted/30 rounded">
                              <div className="flex items-center gap-2">
                                <Badge className={cn("text-xs", getActionColor(trade.action))}>
                                  {getActionLabel(trade.action)}
                                </Badge>
                                <span className="font-medium">{trade.instrument}</span>
                              </div>
                              {trade.outcome && (
                                <span className={cn(
                                  "text-xs font-medium",
                                  trade.outcome.includes('+') || trade.outcome.includes('獲利') 
                                    ? "text-success" 
                                    : trade.outcome.includes('-') || trade.outcome.includes('停損')
                                    ? "text-destructive"
                                    : ""
                                )}>
                                  {trade.outcome}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Learning Points */}
                      {journal.learningPoints.length > 0 && (
                        <div className="p-3 bg-mentor/5 rounded-lg">
                          <p className="text-xs font-medium text-mentor mb-2">📚 本週學習重點</p>
                          <ul className="space-y-1">
                            {journal.learningPoints.map((point, idx) => (
                              <li key={idx} className="text-xs text-muted-foreground">
                                • {point}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="bg-muted/30">
                <CardContent className="py-8 text-center">
                  <p className="text-muted-foreground">目前沒有可查看的週記</p>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* Compliance */}
        <div className="compliance-disclaimer">
          過去績效不代表未來表現，投資有風險，請謹慎評估。
          {!isAdvisor && '所有內容至少延遲 7 天發布，僅供教學參考。'}
        </div>
      </div>
    </LineLayout>
  );
};

export default LineSignals;