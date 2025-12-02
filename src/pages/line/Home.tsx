import { useParams, Link } from 'react-router-dom';
import { LineLayout } from '@/components/layouts/LineLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getPersonBySlug, getUserSubscriptions, getSignalsForUser, getJournalsForUser } from '@/data/mockData';
import { getStrategySystemByExpertSlug } from '@/data/strategyMockData';
import { useAuth } from '@/contexts/AuthContext';
import { PersonRole, PlanType } from '@/types';
import { Radio, BookOpen, TrendingUp, ArrowRight, Calendar, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
const LineHome = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const { user } = useAuth();
  const expert = expertSlug ? getPersonBySlug(expertSlug) : undefined;

  if (!expert) {
    return null; // LineLayout handles this
  }

  const isAdvisor = expert.role === PersonRole.ADVISOR;
  const subscriptions = user ? getUserSubscriptions(user.id) : [];
  const expertSub = subscriptions.find(s => s.person.slug === expertSlug);
  
  // Get recent signals or journals for this expert
  const allSignals = user ? getSignalsForUser(user.id) : [];
  const expertSignals = allSignals.filter(s => s.person.slug === expertSlug).slice(0, 3);
  
  const allJournals = user ? getJournalsForUser(user.id) : [];
  const expertJournals = allJournals.filter(j => j.person.slug === expertSlug).slice(0, 2);

  // Get strategy performance data
  const strategySystem = expertSlug ? getStrategySystemByExpertSlug(expertSlug) : undefined;
  const summary = strategySystem?.performanceSummary;
  const oneMonthPerf = strategySystem?.performanceByPeriod?.find(p => p.period === '1M');

  return (
    <LineLayout>
      <div className="p-4 space-y-6">
        {/* Greeting */}
        <div className="mb-6">
          <h1 className="text-xl font-bold mb-1">
            嗨，{user?.name || '會員'}
          </h1>
          <p className="text-muted-foreground">
            歡迎來到 {expert.name} 的會員專區
          </p>
        </div>

        {/* Subscription Status */}
        {expertSub ? (
          <Card className={cn(
            "border-2",
            isAdvisor ? "border-advisor/30" : "border-mentor/30"
          )}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant={isAdvisor ? 'advisor' : 'mentor'}>
                  {expertSub.plan.name}
                </Badge>
                <Badge variant="secondary">有效</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                到期日：{format(expertSub.endDate, 'yyyy/MM/dd')}
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-muted/50">
            <CardContent className="p-4 text-center">
              <p className="text-muted-foreground mb-3">尚未訂閱此專家</p>
              <Button asChild size="sm">
                <Link to={`/expert/${expertSlug}`}>查看訂閱方案</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Today's Highlights - Advisor */}
        {isAdvisor && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold flex items-center gap-2">
                <Radio className="h-4 w-4 text-advisor" />
                最新訊號
              </h2>
              <Link to={`/line/${expertSlug}/signals`} className="text-sm text-advisor">
                查看全部 →
              </Link>
            </div>
            {expertSignals.length > 0 ? (
              <div className="space-y-2">
                {expertSignals.map(signal => (
                  <Card key={signal.id} variant="interactive" className="p-3">
                    <Link to={`/line/${expertSlug}/signal/${signal.id}`}>
                      <div className="flex items-center justify-between mb-1">
                        <Badge variant="advisor-light" className="text-xs">
                          {signal.action === 'BUY' ? '買進' : 
                           signal.action === 'SELL' ? '賣出' :
                           signal.action === 'ADD' ? '加碼' :
                           signal.action === 'TRIM' ? '減碼' : '出場'}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {format(signal.timeTrade, 'MM/dd HH:mm')}
                        </span>
                      </div>
                      <p className="font-medium">{signal.instrument}</p>
                      <p className="text-sm text-muted-foreground line-clamp-1">
                        {signal.reasonSummary}
                      </p>
                    </Link>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="bg-muted/30 p-4 text-center">
                <p className="text-sm text-muted-foreground">暫無最新訊號</p>
              </Card>
            )}
          </section>
        )}

        {/* Latest Teaching - Mentor */}
        {!isAdvisor && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-mentor" />
                最新週記
              </h2>
              <Link to={`/line/${expertSlug}/signals`} className="text-sm text-mentor">
                查看全部 →
              </Link>
            </div>
            {expertJournals.length > 0 ? (
              <div className="space-y-2">
                {expertJournals.map(journal => (
                  <Card key={journal.id} variant="interactive" className="p-3">
                    <Link to={`/line/${expertSlug}/signals`}>
                      <div className="flex items-center gap-2 mb-1">
                        <Calendar className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          {format(journal.weekStart, 'MM/dd')} - {format(journal.weekEnd, 'MM/dd')}
                        </span>
                        <Badge variant="mentor-light" className="text-xs">T+7 已解鎖</Badge>
                      </div>
                      <p className="font-medium line-clamp-1">{journal.title}</p>
                      <p className="text-sm text-muted-foreground line-clamp-1">
                        {journal.summary}
                      </p>
                    </Link>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="bg-muted/30 p-4 text-center">
                <p className="text-sm text-muted-foreground">暫無最新週記</p>
              </Card>
            )}
          </section>
        )}

        {/* Performance Summary */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2">
              <BarChart3 className={cn("h-4 w-4", isAdvisor ? "text-advisor" : "text-mentor")} />
              策略績效一覽
            </h2>
            <Link 
              to={`/line/${expertSlug}/performance`} 
              className={cn("text-sm", isAdvisor ? "text-advisor" : "text-mentor")}
            >
              完整成績單 →
            </Link>
          </div>
          
          {summary ? (
            <Card className={cn(
              "border",
              isAdvisor ? "border-advisor/20" : "border-mentor/20"
            )}>
              <CardContent className="p-4">
                {/* T+7 indicator for mentors */}
                {!isAdvisor && (
                  <Badge variant="mentor-light" className="mb-3 text-xs">
                    T+7 教學用資料
                  </Badge>
                )}
                
                {/* Core metrics 2x2 grid */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">累積報酬</p>
                    <p className={cn(
                      "text-xl font-bold",
                      summary.sinceInceptionReturnPct >= 0 ? "text-success" : "text-destructive"
                    )}>
                      {summary.sinceInceptionReturnPct >= 0 ? '+' : ''}
                      {summary.sinceInceptionReturnPct.toFixed(1)}%
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">最大回撤</p>
                    <p className="text-xl font-bold text-destructive">
                      {summary.maxDrawdownPct.toFixed(1)}%
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">勝率</p>
                    <p className="text-xl font-bold">
                      {summary.winRatePct?.toFixed(0) || '--'}%
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">近 1 月</p>
                    <p className={cn(
                      "text-xl font-bold",
                      (oneMonthPerf?.cumulativeReturnPct ?? 0) >= 0 ? "text-success" : "text-destructive"
                    )}>
                      {(oneMonthPerf?.cumulativeReturnPct ?? 0) >= 0 ? '+' : ''}
                      {oneMonthPerf?.cumulativeReturnPct?.toFixed(1) ?? '--'}%
                    </p>
                  </div>
                </div>
                
                {/* CTA Button */}
                <Button 
                  variant={isAdvisor ? "advisor" : "mentor"} 
                  size="sm" 
                  className="w-full mt-4"
                  asChild
                >
                  <Link to={`/line/${expertSlug}/performance`}>
                    查看完整成績單
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </Link>
                </Button>
                
                <p className="text-xs text-muted-foreground text-center mt-3">
                  ⚠️ 數據為示意，投資必有風險
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-muted/30 p-4 text-center">
              <p className="text-sm text-muted-foreground">策略績效資料準備中</p>
            </Card>
          )}
        </section>

        {/* Teaching Link */}
        <section>
          <Card className={cn(
            "border-2",
            isAdvisor ? "border-advisor/20" : "border-mentor/20"
          )}>
            <CardContent className="p-4">
              <h3 className="font-semibold mb-2">策略教學</h3>
              <p className="text-sm text-muted-foreground mb-3">
                了解 {expert.name} 的交易系統與操作邏輯
              </p>
              <Button 
                variant={isAdvisor ? 'advisor' : 'mentor'} 
                size="sm" 
                className="w-full"
                asChild
              >
                <Link to={`/line/${expertSlug}/teaching`}>
                  查看策略教學
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </section>

        {/* Compliance */}
        <div className="compliance-disclaimer">
          過去績效不代表未來表現，投資有風險，請謹慎評估。
          {!isAdvisor && '本頁內容僅供教學參考，不構成投資建議。'}
        </div>
      </div>
    </LineLayout>
  );
};

export default LineHome;