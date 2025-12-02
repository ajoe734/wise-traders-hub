import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { LineLayout } from '@/components/layouts/LineLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getPersonBySlug } from '@/data/mockData';
import { PersonRole } from '@/types';
import { TrendingUp, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';

const LinePerformance = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const expert = expertSlug ? getPersonBySlug(expertSlug) : undefined;
  const [period, setPeriod] = useState<'1M' | '3M' | '6M' | '1Y'>('1Y');

  if (!expert) {
    return null;
  }

  const isAdvisor = expert.role === PersonRole.ADVISOR;

  // Mock performance data
  const performanceData = {
    '1M': { return: 5.2, maxDrawdown: -3.1, volatility: 12.5 },
    '3M': { return: 12.8, maxDrawdown: -5.4, volatility: 14.2 },
    '6M': { return: 18.7, maxDrawdown: -8.2, volatility: 15.8 },
    '1Y': { return: 24.5, maxDrawdown: -12.3, volatility: 16.4 },
  };

  const currentData = performanceData[period];

  return (
    <LineLayout>
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="mb-4">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            績效追蹤
          </h1>
          <p className="text-sm text-muted-foreground">
            {expert.name} 的策略績效表現
          </p>
        </div>

        {/* Period Selector */}
        <div className="flex gap-2">
          {(['1M', '3M', '6M', '1Y'] as const).map(p => (
            <Button
              key={p}
              variant={period === p ? (isAdvisor ? 'advisor' : 'mentor') : 'outline'}
              size="sm"
              onClick={() => setPeriod(p)}
              className="flex-1"
            >
              {p === '1M' ? '1個月' : p === '3M' ? '3個月' : p === '6M' ? '6個月' : '1年'}
            </Button>
          ))}
        </div>

        {/* Equity Curve Placeholder */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              淨值曲線
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Placeholder chart */}
            <div className={cn(
              "h-48 rounded-lg flex items-center justify-center",
              "bg-gradient-to-br from-muted/50 to-muted"
            )}>
              <div className="text-center">
                <TrendingUp className={cn(
                  "h-12 w-12 mx-auto mb-2",
                  currentData.return >= 0 ? "text-success" : "text-destructive"
                )} />
                <p className="text-2xl font-bold">
                  {currentData.return >= 0 ? '+' : ''}{currentData.return}%
                </p>
                <p className="text-xs text-muted-foreground">
                  {period === '1M' ? '近1個月' : period === '3M' ? '近3個月' : period === '6M' ? '近6個月' : '近1年'}報酬
                </p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground text-center mt-2">
              圖表為示意，實際數據待接入後台
            </p>
          </CardContent>
        </Card>

        {/* Key Metrics */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">績效指標</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-muted/30 rounded-lg text-center">
                <p className="text-xs text-muted-foreground mb-1">累積報酬</p>
                <p className={cn(
                  "text-xl font-bold",
                  currentData.return >= 0 ? "text-success" : "text-destructive"
                )}>
                  {currentData.return >= 0 ? '+' : ''}{currentData.return}%
                </p>
              </div>
              <div className="p-3 bg-muted/30 rounded-lg text-center">
                <p className="text-xs text-muted-foreground mb-1">最大回撤</p>
                <p className="text-xl font-bold text-warning">
                  {currentData.maxDrawdown}%
                </p>
              </div>
              <div className="p-3 bg-muted/30 rounded-lg text-center">
                <p className="text-xs text-muted-foreground mb-1">波動度</p>
                <p className="text-xl font-bold">
                  {currentData.volatility}%
                </p>
              </div>
              <div className="p-3 bg-muted/30 rounded-lg text-center">
                <p className="text-xs text-muted-foreground mb-1">Sharpe Ratio</p>
                <p className="text-xl font-bold">
                  1.85
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Risk Indicators */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">風險護欄狀態</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">整體曝險</span>
                <Badge variant="secondary" className="bg-success/10 text-success">
                  ✅ 正常
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">單一標的集中度</span>
                <Badge variant="secondary" className="bg-success/10 text-success">
                  ✅ 正常
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">產業曝險</span>
                <Badge variant="secondary" className="bg-warning/10 text-warning">
                  ⚠️ 接近上限
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Note */}
        <div className={cn(
          "p-3 rounded-lg text-sm",
          isAdvisor ? "bg-advisor/5" : "bg-mentor/5"
        )}>
          <p className="text-muted-foreground text-xs">
            以上為回測或模擬數據，僅供教育參考。過去績效不代表未來表現，投資有風險，請謹慎評估。
          </p>
        </div>

        {/* Compliance */}
        <div className="compliance-disclaimer">
          過去績效不代表未來表現，投資有風險，請謹慎評估。
        </div>
      </div>
    </LineLayout>
  );
};

export default LinePerformance;