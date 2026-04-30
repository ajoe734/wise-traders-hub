import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';

interface Props {
  runId: string | null;
  onClose: () => void;
}

export function BacktestRunDetailDialog({ runId, onClose }: Props) {
  const [run, setRun] = useState<any | null>(null);
  const [validations, setValidations] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!runId) return;
    setLoading(true);
    (async () => {
      const [runRes, valRes] = await Promise.all([
        supabase.from('knowledge_backtest_runs').select('*').eq('id', runId).maybeSingle(),
        supabase.from('checkup_knowledge_validations')
          .select('*')
          .filter('details->>run_id', 'eq', runId)
          .order('actual_change_pct', { ascending: false })
          .limit(500),
      ]);
      setRun(runRes.data);
      setValidations(valRes.data ?? []);
      setLoading(false);
    })();
  }, [runId]);

  if (!runId) return null;

  // 命中分佈（每 5% 為一組）
  const buckets: Record<string, number> = {};
  for (const v of validations) {
    const c = Number(v.actual_change_pct ?? 0);
    const b = Math.floor(c / 5) * 5;
    const key = `${b}~${b + 5}%`;
    buckets[key] = (buckets[key] ?? 0) + 1;
  }
  const sortedBuckets = Object.entries(buckets).sort((a, b) => {
    const ka = parseInt(a[0]); const kb = parseInt(b[0]); return ka - kb;
  });
  const maxBucket = Math.max(1, ...Object.values(buckets));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>回測明細 {run?.run_mode && <Badge variant="outline" className="ml-2">{run.run_mode}</Badge>}</DialogTitle>
        </DialogHeader>
        {loading && <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>}
        {run && !loading && (
          <div className="space-y-4">
            {/* KPI */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Kpi label="勝率" value={run.win_rate != null ? `${(run.win_rate * 100).toFixed(1)}%` : 'N/A'} />
              <Kpi label="樣本數" value={run.total_hits} />
              <Kpi label="平均報酬" value={run.avg_return_pct != null ? `${run.avg_return_pct.toFixed(2)}%` : '—'} />
              <Kpi label="最大回撤" value={run.max_drawdown != null ? `${run.max_drawdown.toFixed(2)}%` : '—'} />
            </div>

            {/* 自動規則動作 */}
            {run.auto_action && (
              <div className="border rounded p-3 bg-muted/40">
                <div className="text-xs text-muted-foreground mb-1">自動規則動作</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={run.auto_action.includes('archived') ? 'destructive' : 'default'}>
                    {run.auto_action}
                  </Badge>
                  <span className="text-sm">{run.auto_action_reason}</span>
                </div>
              </div>
            )}

            {/* 參數 */}
            {run.parameters && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">參數</div>
                <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">{JSON.stringify(run.parameters, null, 2)}</pre>
              </div>
            )}

            {/* 分佈直方圖 */}
            {sortedBuckets.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground mb-2">命中後 {validations[0]?.horizon_days ?? '?'} 日報酬分佈（n={validations.length}）</div>
                <div className="space-y-1">
                  {sortedBuckets.map(([k, v]) => {
                    const isPositive = parseInt(k) >= 0;
                    return (
                      <div key={k} className="flex items-center gap-2 text-xs">
                        <span className="w-16 text-right tabular-nums">{k}</span>
                        <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
                          <div className={`h-full ${isPositive ? 'bg-emerald-500' : 'bg-red-500'}`}
                            style={{ width: `${(v / maxBucket) * 100}%` }} />
                        </div>
                        <span className="w-10 tabular-nums text-muted-foreground">{v}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 命中明細表 */}
            <div>
              <div className="text-xs text-muted-foreground mb-2">每筆命中（前 500 筆，依報酬排序）</div>
              <div className="border rounded overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-left p-2">股票</th>
                      <th className="text-left p-2">觸發日</th>
                      <th className="text-right p-2">{validations[0]?.horizon_days ?? '?'}日報酬</th>
                      <th className="text-center p-2">命中</th>
                      <th className="text-left p-2">細節</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validations.length === 0 && (
                      <tr><td colSpan={5} className="p-3 text-center text-muted-foreground">無明細資料</td></tr>
                    )}
                    {validations.map((v) => (
                      <tr key={v.id} className="border-t">
                        <td className="p-2 font-mono">{v.stock_code}</td>
                        <td className="p-2 text-muted-foreground">{v.details?.trigger_date ?? '—'}</td>
                        <td className={`p-2 text-right tabular-nums ${Number(v.actual_change_pct) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {Number(v.actual_change_pct).toFixed(2)}%
                        </td>
                        <td className="p-2 text-center">
                          {v.is_correct ? <Badge variant="default" className="text-xs">✓</Badge> : <Badge variant="secondary" className="text-xs">✗</Badge>}
                        </td>
                        <td className="p-2 text-muted-foreground truncate max-w-xs">
                          {v.details ? Object.entries(v.details).filter(([k]) => k !== 'run_id' && k !== 'trigger_date').map(([k, vv]) => `${k}=${vv}`).join(' · ') : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Kpi({ label, value }: { label: string; value: any }) {
  return (
    <div className="border rounded p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
