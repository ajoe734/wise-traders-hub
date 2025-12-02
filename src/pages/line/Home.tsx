import { useParams, Link } from 'react-router-dom';
import { LineLayout } from '@/components/layouts/LineLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getPersonBySlug, getUserSubscriptions, getSignalsForUser, getJournalsForUser } from '@/data/mockData';
import { getStrategySystemByExpertSlug } from '@/data/strategyMockData';
import { useAuth } from '@/contexts/AuthContext';
import { PersonRole, PlanType } from '@/types';
import { Radio, BookOpen, TrendingUp, ArrowRight, Calendar, BarChart3, Flame, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Sparkline } from '@/components/strategy/Sparkline';
import { FourIndicatorsDashboard, mockFourIndicators, FourIndicator } from '@/components/strategy/FourIndicatorsDashboard';

// Special 4有 indicators for Zhao's pages - simulating real-time data
const zhaoLiveIndicators: FourIndicator[] = [
  {
    id: '有漲',
    label: '股價強勢',
    description: '股價站上均線、盤中表現強勢',
    status: 'active',
    value: 88,
    detail: '突破季線',
  },
  {
    id: '有人',
    label: '買盤積極',
    description: '委買量大於委賣量',
    status: 'active',
    value: 95,
    detail: '買賣比 2.3',
  },
  {
    id: '有人買',
    label: '散戶買超',
    description: '散戶買超訊號',
    status: 'active',
    value: 72,
    detail: '連2日買超',
  },
  {
    id: '有大人買',
    label: '主力進場',
    description: '大戶/法人連續買超',
    status: 'active',
    value: 85,
    detail: '連5日買超',
  },
];

// Featured signals for Zhao advisor
const zhaoFeaturedSignals = [
  {
    id: 'zhao-feat-1',
    symbol: '3443.TW',
    name: '創意',
    action: 'BUY',
    price: 1420,
    indicatorsActive: 4,
    time: new Date(),
    reason: '4有同步觸發，量能放大突破前高',
  },
  {
    id: 'zhao-feat-2',
    symbol: '6770.TW',
    name: '力積電',
    action: 'BUY',
    price: 43.5,
    indicatorsActive: 3,
    time: new Date(Date.now() - 3600000),
    reason: '開盤強勢表態，委買張數快速增加',
  },
];

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
            {/* Special 4有 Dashboard for Zhao */}
            {(expertSlug === 'zhao-advisor' || expertSlug === 'zhao-mentor') && (
              <div className="mb-4">
                <FourIndicatorsDashboard 
                  indicators={expertSlug === 'zhao-advisor' ? zhaoLiveIndicators : mockFourIndicators}
                  symbol={zhaoFeaturedSignals[0]?.symbol}
                />
              </div>
            )}
            
            {/* Featured signals for Zhao */}
            {expertSlug === 'zhao-advisor' && (
              <div className="space-y-2 mb-4">
                <p className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                  <Flame className="h-4 w-4 text-advisor" />
                  精選漲停訊號
                </p>
                {zhaoFeaturedSignals.map(signal => (
                  <Card key={signal.id} variant="interactive" className="p-3 border-advisor/30">
                    <Link to={`/line/${expertSlug}/signals`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="advisor" className="text-xs">
                            {signal.action === 'BUY' ? '買進' : '賣出'}
                          </Badge>
                          <Badge variant="outline" className="text-xs font-mono">
                            {signal.indicatorsActive}/4 有
                          </Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {format(signal.time, 'HH:mm')}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold">{signal.name}</p>
                          <p className="text-xs text-muted-foreground font-mono">{signal.symbol}</p>
                        </div>
                        <p className="text-lg font-bold text-advisor">${signal.price}</p>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-1 mt-1">
                        {signal.reason}
                      </p>
                    </Link>
                  </Card>
                ))}
              </div>
            )}

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
            ) : expertSlug !== 'zhao-advisor' ? (
              <Card className="bg-muted/30 p-4 text-center">
                <p className="text-sm text-muted-foreground">暫無最新訊號</p>
              </Card>
            ) : null}
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
                
                {/* Mini Sparkline */}
                {strategySystem?.equityHistory && (
                  <div className="mb-4">
                    <p className="text-xs text-muted-foreground mb-1">近期走勢</p>
                    <Sparkline 
                      data={strategySystem.equityHistory} 
                      isPositive={summary.sinceInceptionReturnPct >= 0}
                    />
                  </div>
                )}
                
                {/* Core metrics grid */}
                {(() => {
                  // Calculate relative performance vs benchmark
                  const equityHistory = strategySystem?.equityHistory;
                  const latestPoint = equityHistory?.[equityHistory.length - 1];
                  const strategyReturn = latestPoint ? (latestPoint.equity - 100) : summary.sinceInceptionReturnPct;
                  const benchmarkReturn = latestPoint?.benchmarkEquity ? (latestPoint.benchmarkEquity - 100) : 0;
                  const relativeReturn = strategyReturn - benchmarkReturn;
                  
                  return (
                    <>
                      {/* 2x2 core metrics */}
                      <div className="grid grid-cols-2 gap-4 mb-4">
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
                      
                      {/* Relative performance vs benchmark */}
                      <div className={cn(
                        "p-3 rounded-lg border mb-4",
                        relativeReturn >= 0 
                          ? "bg-success/5 border-success/20" 
                          : "bg-destructive/5 border-destructive/20"
                      )}>
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs text-muted-foreground">相對大盤</p>
                            <p className="text-xs text-muted-foreground/70">vs 加權指數</p>
                          </div>
                          <div className="text-right">
                            <p className={cn(
                              "text-lg font-bold",
                              relativeReturn >= 0 ? "text-success" : "text-destructive"
                            )}>
                              {relativeReturn >= 0 ? '+' : ''}{relativeReturn.toFixed(1)}%
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {relativeReturn >= 0 ? '超越' : '落後'}大盤
                            </p>
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })()}
                
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

        {/* History Link (for Zhao only) */}
        {(expertSlug === 'zhao-advisor' || expertSlug === 'zhao-mentor') && (
          <section>
            <Card className="border-2 border-yellow-500/20 bg-gradient-to-br from-yellow-500/5 to-transparent">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Trophy className="h-5 w-5 text-yellow-500" />
                  <h3 className="font-semibold">漲停捕捉紀錄</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  查看過去6個月的漲停捕捉戰績與月度統計
                </p>
                <Button 
                  variant="outline"
                  size="sm" 
                  className="w-full border-yellow-500/30 hover:bg-yellow-500/10"
                  asChild
                >
                  <Link to={`/line/${expertSlug}/history`}>
                    查看歷史戰績
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </section>
        )}

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