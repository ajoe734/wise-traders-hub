// Risk Summary Card Component
import { cn } from '@/lib/utils';
import { RiskSummary, RiskLevel } from '@/types/strategy';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, AlertTriangle, AlertCircle, Info } from 'lucide-react';

interface RiskSummaryCardProps {
  summary: RiskSummary;
  isDelayed?: boolean;
  className?: string;
}

const riskLevelConfig: Record<RiskLevel, { color: string; bgColor: string; label: string }> = {
  '低': { color: 'text-success', bgColor: 'bg-success/10', label: '低風險' },
  '中': { color: 'text-warning', bgColor: 'bg-warning/10', label: '中風險' },
  '高': { color: 'text-destructive', bgColor: 'bg-destructive/10', label: '高風險' },
};

export function RiskSummaryCard({ summary, isDelayed, className }: RiskSummaryCardProps) {
  const levelConfig = riskLevelConfig[summary.riskLevel];

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            風險摘要
          </CardTitle>
          <div className="flex items-center gap-2">
            {isDelayed && (
              <Badge variant="outline" className="text-[10px] bg-mentor/10 text-mentor border-mentor/20">
                T+7
              </Badge>
            )}
            <Badge className={cn("text-xs", levelConfig.bgColor, levelConfig.color)}>
              {levelConfig.label}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Exposure Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-2 bg-muted/30 rounded-lg">
            <p className="text-xs text-muted-foreground">當前曝險</p>
            <p className="font-medium">{summary.currentExposurePct}%</p>
          </div>
          <div className="p-2 bg-muted/30 rounded-lg">
            <p className="text-xs text-muted-foreground">單一標的上限</p>
            <p className="font-medium">{summary.maxSinglePositionPct}%</p>
          </div>
          {summary.sectorConcentrationTop && (
            <div className="p-2 bg-muted/30 rounded-lg">
              <p className="text-xs text-muted-foreground">最大產業集中</p>
              <p className="font-medium">{summary.sectorConcentrationTop}%</p>
            </div>
          )}
          {summary.var1dPct && (
            <div className="p-2 bg-muted/30 rounded-lg">
              <p className="text-xs text-muted-foreground">日VaR</p>
              <p className="font-medium">{summary.var1dPct.toFixed(1)}%</p>
            </div>
          )}
        </div>

        {/* Risk Alerts */}
        {summary.recentAlerts.length > 0 && (
          <div className="pt-2 border-t space-y-2">
            <p className="text-xs font-medium text-muted-foreground">風險提示</p>
            {summary.recentAlerts.filter(a => !a.resolved).map((alert) => {
              const AlertIcon = alert.level === 'danger' ? AlertCircle 
                : alert.level === 'warning' ? AlertTriangle 
                : Info;
              const alertColor = alert.level === 'danger' ? 'text-destructive bg-destructive/5'
                : alert.level === 'warning' ? 'text-warning bg-warning/5'
                : 'text-muted-foreground bg-muted/30';

              return (
                <div 
                  key={alert.id}
                  className={cn("p-2 rounded-lg", alertColor)}
                >
                  <div className="flex items-center gap-2">
                    <AlertIcon className="h-4 w-4 shrink-0" />
                    <div>
                      <p className="text-sm font-medium">{alert.title}</p>
                      <p className="text-xs opacity-80">{alert.description}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
