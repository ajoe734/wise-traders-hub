import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { TrendingUp, Target } from 'lucide-react';

interface BacktestData {
  indicator: string;
  avgReturn: number;
  winRate: number;
  tradeCount: number;
  maxReturn: number;
}

interface FourIndicatorsBacktestProps {
  className?: string;
  isDelayed?: boolean;
}

// Mock backtesting data for 4有 indicators
const backtestData: BacktestData[] = [
  { indicator: '有漲', avgReturn: 4.2, winRate: 65, tradeCount: 156, maxReturn: 18.5 },
  { indicator: '有人', avgReturn: 3.8, winRate: 62, tradeCount: 142, maxReturn: 15.2 },
  { indicator: '有人買', avgReturn: 3.5, winRate: 58, tradeCount: 128, maxReturn: 12.8 },
  { indicator: '有大人買', avgReturn: 5.1, winRate: 68, tradeCount: 98, maxReturn: 22.5 },
];

// Combination data
const combinationData = [
  { name: '單一指標', avgReturn: 2.8, winRate: 52, color: 'hsl(var(--muted-foreground))' },
  { name: '2個指標', avgReturn: 4.5, winRate: 60, color: 'hsl(var(--warning))' },
  { name: '3個指標', avgReturn: 6.2, winRate: 68, color: 'hsl(var(--chart-2))' },
  { name: '4有同步', avgReturn: 8.8, winRate: 78, color: 'hsl(var(--success))' },
];

export function FourIndicatorsBacktest({ className, isDelayed = false }: FourIndicatorsBacktestProps) {
  return (
    <Card className={cn("", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="h-4 w-4" />
            「4有」指標回測分析
          </CardTitle>
          {isDelayed && (
            <Badge variant="outline" className="text-[10px] bg-mentor/10 text-mentor border-mentor/20">
              T+7 教學
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          基於過去一年 {backtestData.reduce((sum, d) => sum + d.tradeCount, 0)} 筆交易的回測結果
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Individual Indicator Stats */}
        <div>
          <h4 className="text-sm font-medium mb-3">各指標觸發時平均報酬</h4>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={backtestData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                <XAxis type="number" domain={[0, 'dataMax']} tickFormatter={(v) => `${v}%`} />
                <YAxis type="category" dataKey="indicator" width={60} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload as BacktestData;
                      return (
                        <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
                          <p className="font-semibold">{data.indicator}</p>
                          <p className="text-sm text-success">平均報酬：+{data.avgReturn}%</p>
                          <p className="text-sm text-muted-foreground">勝率：{data.winRate}%</p>
                          <p className="text-sm text-muted-foreground">交易筆數：{data.tradeCount}</p>
                          <p className="text-sm text-muted-foreground">最大獲利：+{data.maxReturn}%</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="avgReturn" radius={[0, 4, 4, 0]}>
                  {backtestData.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={entry.avgReturn >= 5 ? 'hsl(var(--success))' : 'hsl(var(--chart-2))'} 
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Combination Analysis */}
        <div>
          <h4 className="text-sm font-medium mb-3">指標組合分析</h4>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={combinationData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => `${v}%`} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
                          <p className="font-semibold">{data.name}</p>
                          <p className="text-sm text-success">平均報酬：+{data.avgReturn}%</p>
                          <p className="text-sm text-muted-foreground">勝率：{data.winRate}%</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="avgReturn" radius={[4, 4, 0, 0]}>
                  {combinationData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Key Findings */}
        <div className="p-4 bg-success/5 border border-success/20 rounded-lg">
          <h4 className="text-sm font-semibold text-success mb-2 flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            關鍵發現
          </h4>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li>• 「有大人買」觸發時平均報酬最高（+5.1%）</li>
            <li>• 4有同步觸發時，平均報酬達 +8.8%，勝率 78%</li>
            <li>• 僅單一指標觸發時勝率僅 52%，不建議進場</li>
            <li>• 建議至少等待 3 個以上指標同步再考慮進場</li>
          </ul>
        </div>

        <p className="text-xs text-muted-foreground text-center">
          ⚠️ 歷史回測不代表未來表現，僅供教學參考
        </p>
      </CardContent>
    </Card>
  );
}
