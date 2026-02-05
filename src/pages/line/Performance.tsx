import { useParams, Link } from 'react-router-dom';
import { LineLayout } from '@/components/layouts/LineLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getPersonBySlug } from '@/data/mockData';
import { getStrategySystemByExpertSlug } from '@/data/strategyMockData';
import { PersonRole } from '@/types';
import { BarChart3, FileCheck } from 'lucide-react';
 import { Monitor, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

import { PerformanceMetrics } from '@/components/strategy/PerformanceMetrics';
import { PeriodPerformanceTable } from '@/components/strategy/PeriodPerformanceTable';
import { EquityCurveChart } from '@/components/strategy/EquityCurveChart';
import { UnderwaterChart } from '@/components/strategy/UnderwaterChart';
import { PositionsTable } from '@/components/strategy/PositionsTable';
import { TradeStatsCard } from '@/components/strategy/TradeStatsCard';
import { RiskSummaryCard } from '@/components/strategy/RiskSummaryCard';
import { ReturnDistributionChart } from '@/components/strategy/ReturnDistributionChart';
import { MonthlyHeatmap } from '@/components/strategy/MonthlyHeatmap';
import { FourIndicatorsBacktest } from '@/components/strategy/FourIndicatorsBacktest';

const LinePerformance = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const expert = expertSlug ? getPersonBySlug(expertSlug) : undefined;
  const strategySystem = expertSlug ? getStrategySystemByExpertSlug(expertSlug) : undefined;

  const isAdvisor = expert?.role === PersonRole.ADVISOR;
  const isDelayed = strategySystem?.delayMode === 't7';

  return (
    <LineLayout>
      {expert && strategySystem && (
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="h-5 w-5" />
            <h1 className="text-xl font-bold">策略成績單</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {expert.name} • {strategySystem.name}
          </p>
         </div>
 
         {/* Web Version Hint */}
         <a
           href="https://wise-traders-hub.lovable.app/app/performance"
           target="_blank"
           rel="noopener noreferrer"
            className="flex items-center gap-3 px-3 py-2.5 bg-foreground dark:bg-white rounded-lg hover:opacity-90 transition-opacity"
         >
            <Monitor className="h-4 w-4 text-background dark:text-foreground shrink-0" />
            <span className="text-sm text-background dark:text-foreground flex-1">
             想看更詳細？網頁版有完整圖表分析
           </span>
            <ChevronRight className="h-4 w-4 text-background dark:text-foreground shrink-0" />
         </a>
 
          {isDelayed && (
            <div className="mt-2 p-3 bg-mentor/5 rounded-lg text-sm">
              <p className="text-mentor font-medium">📋 T+7 教學用資料</p>
              <p className="text-muted-foreground text-xs mt-1">
                以下為一週前策略示範帳戶的實際交易紀錄與績效，僅供教學參考，不構成即時投資建議。
              </p>
            </div>
          )}

        {/* Section 1: Overall Performance Summary */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">整體成績總覽</CardTitle>
          </CardHeader>
          <CardContent>
            <PerformanceMetrics 
              summary={strategySystem.performanceSummary} 
              isDelayed={isDelayed}
            />
            <p className="text-xs text-muted-foreground text-center mt-3">
              數據為示意，投資必有風險，過去績效不代表未來表現。
            </p>
          </CardContent>
        </Card>

        {/* Section 2: Period Performance */}
        <Card>
          <CardContent className="pt-4">
            <PeriodPerformanceTable 
              data={strategySystem.performanceByPeriod}
              isDelayed={isDelayed}
            />
          </CardContent>
        </Card>

        {/* Section 3: Equity Curve */}
        <EquityCurveChart 
          data={strategySystem.equityHistory}
          isDelayed={isDelayed}
        />

        {/* Section 4: Underwater Chart (Drawdown) */}
        <UnderwaterChart 
          data={strategySystem.equityHistory}
          isDelayed={isDelayed}
        />

        {/* Section 5: Monthly Heatmap */}
        <MonthlyHeatmap 
          data={strategySystem.equityHistory}
          isDelayed={isDelayed}
        />

        {/* Section 6: Return Distribution */}
        {strategySystem.recentTrades && strategySystem.recentTrades.length > 0 && (
          <ReturnDistributionChart 
            trades={strategySystem.recentTrades}
            isDelayed={isDelayed}
          />
        )}

        {/* Section 6.5: 4有 Backtest Analysis (for Zhao) */}
        {(expertSlug === 'zhao-advisor' || expertSlug === 'zhao-mentor') && (
          <FourIndicatorsBacktest isDelayed={isDelayed} />
        )}

        {/* Section 7: Trade Stats */}
        <TradeStatsCard 
          stats={strategySystem.tradeStats}
          isDelayed={isDelayed}
        />

        {/* Section 8: Current Positions */}
        <Card>
          <CardContent className="pt-4">
            <PositionsTable 
              positions={strategySystem.positions}
              isDelayed={isDelayed}
            />
          </CardContent>
        </Card>

        {/* Section 9: Risk Summary */}
        <RiskSummaryCard 
          summary={strategySystem.riskSummary}
          isDelayed={isDelayed}
        />

        {/* Advisor L2 Diagnosis CTA */}
        {isAdvisor && (
          <Card className={cn("border-2 border-advisor/20")}>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <FileCheck className="h-8 w-8 text-advisor" />
                <div className="flex-1">
                  <p className="font-medium">持股健檢服務</p>
                  <p className="text-xs text-muted-foreground">
                    上傳您的持股，獲得專業診斷報告
                  </p>
                </div>
                <Link to={`/line/${expertSlug}/diagnosis`}>
                  <Button variant="advisor" size="sm">
                    查看診斷
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Compliance */}
        <div className="compliance-disclaimer">
          過去績效不代表未來表現，投資有風險，請謹慎評估。
        </div>
      </div>
      )}
    </LineLayout>
  );
};

export default LinePerformance;
