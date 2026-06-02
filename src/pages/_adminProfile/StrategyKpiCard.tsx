import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Lock } from 'lucide-react';

interface Props {
  strategyName: string;
  riskPreference: string;
  operationCycle: string;
  strategySummary: string;
  perf: any;
  isReadOnly: boolean;
  setStrategyName: (v: string) => void;
  setRiskPreference: (v: string) => void;
  setOperationCycle: (v: string) => void;
  setStrategySummary: (v: string) => void;
}

export default function StrategyKpiCard({
  strategyName, riskPreference, operationCycle, strategySummary, perf, isReadOnly,
  setStrategyName, setRiskPreference, setOperationCycle, setStrategySummary,
}: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          策略與回測
          <Badge variant="outline" className="text-[10px] font-normal">
            <Lock className="h-3 w-3 mr-1" />KPI 系統計算
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>交易系統名稱</Label>
          <Input
            value={strategyName}
            onChange={(e) => setStrategyName(e.target.value)}
            placeholder="例:價值持有 — 高股息選股"
            disabled={isReadOnly}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>風險偏好</Label>
            <select
              value={riskPreference}
              onChange={(e) => setRiskPreference(e.target.value)}
              disabled={isReadOnly}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
            >
              <option value="">未設定</option>
              <option value="保守">保守</option>
              <option value="穩健">穩健</option>
              <option value="積極">積極</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label>操作週期</Label>
            <select
              value={operationCycle}
              onChange={(e) => setOperationCycle(e.target.value)}
              disabled={isReadOnly}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
            >
              <option value="">未設定</option>
              <option value="短線">短線</option>
              <option value="波段">波段</option>
              <option value="長線">長線</option>
            </select>
          </div>
        </div>
        <div className="space-y-2">
          <Label>策略摘要</Label>
          <Textarea
            value={strategySummary}
            onChange={(e) => setStrategySummary(e.target.value)}
            rows={3}
            placeholder="一段話總結您的選股與操作邏輯，會顯示於前台「交易系統」卡片"
            disabled={isReadOnly}
          />
          <p className="text-xs text-muted-foreground">顯示於前台「策略簡介 → 交易系統」卡片</p>
        </div>

        <div>
          <Label className="mb-2 block">回測 KPI（系統依實際交易紀錄自動計算，不可手動修改）</Label>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">1 年累積報酬</div>
              <div className="text-lg font-semibold tabular-nums mt-1">
                {perf?.return_1y != null ? `${perf.return_1y.toFixed(2)}%` : '—'}
              </div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">最大回撤</div>
              <div className="text-lg font-semibold tabular-nums mt-1">
                {perf?.max_drawdown != null ? `${perf.max_drawdown.toFixed(2)}%` : '—'}
              </div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">總報酬率（含未實現）</div>
              <div className="text-lg font-semibold tabular-nums mt-1">
                {(perf as any)?.total_return_pct != null
                  ? `${Number((perf as any).total_return_pct).toFixed(2)}%`
                  : '—'}
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            數值會隨您發布的訊號與已平倉交易自動更新
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
