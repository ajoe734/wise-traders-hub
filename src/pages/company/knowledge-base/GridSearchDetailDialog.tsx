import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowUpDown } from 'lucide-react';

interface Props {
  runId: string | null;
  onClose: () => void;
}

type SortKey = 'score' | 'win_rate' | 'avg_return_pct' | 'total_hits';

export function GridSearchDetailDialog({ runId, onClose }: Props) {
  const [run, setRun] = useState<any | null>(null);
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    if (!runId) return;
    setLoading(true);
    (async () => {
      const [runRes, gridRes] = await Promise.all([
        supabase.from('knowledge_backtest_runs').select('*').eq('id', runId).maybeSingle(),
        supabase.from('knowledge_grid_search_results').select('*').eq('run_id', runId),
      ]);
      setRun(runRes.data);
      setResults(gridRes.data ?? []);
      setLoading(false);
    })();
  }, [runId]);

  const sorted = useMemo(() => {
    const arr = [...results];
    arr.sort((a, b) => {
      const av = Number(a[sortKey] ?? 0);
      const bv = Number(b[sortKey] ?? 0);
      return sortDir === 'desc' ? bv - av : av - bv;
    });
    return arr;
  }, [results, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    else { setSortKey(k); setSortDir('desc'); }
  }

  if (!runId) return null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>網格搜尋結果 <Badge variant="outline" className="ml-2">grid_search</Badge></DialogTitle>
        </DialogHeader>
        {loading && <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>}
        {!loading && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Kpi label="網格大小" value={results.length} />
              <Kpi label="最佳勝率" value={
                run?.win_rate != null ? `${(run.win_rate * 100).toFixed(1)}%` : 'N/A'
              } />
              <Kpi label="最佳平均報酬" value={
                run?.avg_return_pct != null ? `${run.avg_return_pct.toFixed(2)}%` : '—'
              } />
              <Kpi label="樣本數" value={run?.total_hits ?? 0} />
            </div>

            {run?.details?.best_params && (
              <div className="border rounded p-3 bg-muted/40">
                <div className="text-xs text-muted-foreground mb-1">最佳參數</div>
                <pre className="text-xs">{JSON.stringify(run.details.best_params, null, 2)}</pre>
              </div>
            )}

            <div className="border rounded overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left p-2">最佳</th>
                    <SortHeader label="綜合分數" k="score" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    <SortHeader label="勝率" k="win_rate" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    <SortHeader label="平均報酬" k="avg_return_pct" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    <SortHeader label="樣本數" k="total_hits" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    <th className="text-left p-2">參數組合</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.length === 0 && (
                    <tr><td colSpan={6} className="p-3 text-center text-muted-foreground">無結果</td></tr>
                  )}
                  {sorted.map((r) => (
                    <tr key={r.id} className={`border-t ${r.is_best ? 'bg-emerald-50 dark:bg-emerald-950/30' : ''}`}>
                      <td className="p-2">{r.is_best ? <Badge variant="default" className="text-xs">最佳</Badge> : ''}</td>
                      <td className="p-2 tabular-nums">{Number(r.score ?? 0).toFixed(3)}</td>
                      <td className="p-2 tabular-nums">{r.win_rate != null ? `${(r.win_rate * 100).toFixed(1)}%` : '—'}</td>
                      <td className={`p-2 tabular-nums ${Number(r.avg_return_pct) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {r.avg_return_pct != null ? `${Number(r.avg_return_pct).toFixed(2)}%` : '—'}
                      </td>
                      <td className="p-2 tabular-nums text-muted-foreground">{r.total_hits ?? 0}</td>
                      <td className="p-2 font-mono text-muted-foreground truncate max-w-md">
                        {Object.entries(r.parameters ?? {}).filter(([k]) => k !== 'type').map(([k, v]) => `${k}=${v}`).join(' · ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SortHeader({ label, k, sortKey, sortDir, onClick }: any) {
  const active = sortKey === k;
  return (
    <th className="text-right p-2">
      <button onClick={() => onClick(k)} className="inline-flex items-center gap-1 hover:underline">
        {label}<ArrowUpDown className={`h-3 w-3 ${active ? 'text-foreground' : 'text-muted-foreground'}`} />
        {active && <span className="text-[10px]">{sortDir === 'desc' ? '↓' : '↑'}</span>}
      </button>
    </th>
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
