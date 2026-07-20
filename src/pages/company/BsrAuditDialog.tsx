import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';

type AuditResult = {
  stock_id: string;
  attempted_as_of_date: string;
  lookback_chain: Array<{ date: string; rows: number }>;
  last_successful: { as_of_date: string; rows: number; lag_days: number } | null;
  rollup: Record<string, string | null>;
  failure_state: {
    unresolved: any | null;
    recent: Array<{
      trade_date: string;
      reason: string;
      attempts: number;
      consecutive_failures: number;
      next_retry_at: string | null;
      resolved_at: string | null;
      last_error: string | null;
      updated_at: string;
    }>;
  };
  aligned: boolean;
  mismatch_reason: string | null;
};

const fmtDate = (s: string | null | undefined) => (s ? s.slice(0, 10).replace(/-/g, '/') : '—');
const fmtDT = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function BsrAuditDialog({
  stockId,
  open,
  onOpenChange,
}: {
  stockId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !stockId) return;
    let cancel = false;
    (async () => {
      setLoading(true);
      setError(null);
      setResult(null);
      try {
        const { data, error } = await supabase.functions.invoke('tw-bsr-daily-sync', {
          body: { mode: 'audit', stock_ids: [stockId], lookback: 7 },
        });
        if (cancel) return;
        if (error) throw error;
        setResult((data as any)?.results?.[0] || null);
      } catch (e: any) {
        if (!cancel) setError(e?.message || 'audit failed');
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [open, stockId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="bsr-audit-dialog">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-medium">
            BSR 對齊審計 · {stockId}
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 py-8 justify-center text-foreground/60 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> 讀取中…
          </div>
        )}
        {error && (
          <div className="text-sm text-[#B23A48] py-4">錯誤：{error}</div>
        )}

        {result && (
          <div className="space-y-4 text-[12px]">
            {/* 對齊狀態 */}
            <div
              className="flex items-center gap-2 p-3 rounded"
              style={{
                background: result.aligned ? '#ECFDF5' : '#FEF3C7',
                color: result.aligned ? '#065F46' : '#92400E',
              }}
              data-testid="audit-alignment"
              data-aligned={result.aligned ? 'true' : 'false'}
            >
              {result.aligned ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              <span className="text-[13px] font-medium">
                {result.aligned
                  ? 'Rollup 與最近成功日已對齊'
                  : `未對齊 · ${result.mismatch_reason}`}
              </span>
            </div>

            {/* 三欄對齊表 */}
            <div className="grid grid-cols-3 gap-2">
              <Panel label="Attempted" value={fmtDate(result.attempted_as_of_date)} />
              <Panel
                label="Last Successful"
                value={fmtDate(result.last_successful?.as_of_date)}
                sub={result.last_successful ? `${result.last_successful.rows} rows · T-${result.last_successful.lag_days}` : '—'}
              />
              <Panel
                label="Rollup (5d)"
                value={fmtDate(result.rollup['5'])}
                sub={`20d: ${fmtDate(result.rollup['20'])} · 60d: ${fmtDate(result.rollup['60'])}`}
              />
            </div>

            {/* Lookback chain */}
            <div>
              <div className="text-[11px] text-foreground/60 mb-1.5">Lookback chain（近 {result.lookback_chain.length} 個工作日）</div>
              <div className="grid grid-cols-2 gap-1">
                {result.lookback_chain.map((d) => (
                  <div
                    key={d.date}
                    className="flex items-center gap-2 px-2 py-1 rounded"
                    style={{ background: 'hsl(var(--foreground) / 0.03)' }}
                  >
                    <span className="tabular-nums text-foreground/70 w-20">{fmtDate(d.date)}</span>
                    {d.rows > 0 ? (
                      <Badge className="text-[10px]" style={{ background: '#D1FAE5', color: '#065F46' }}>
                        ✔ {d.rows} rows
                      </Badge>
                    ) : (
                      <span className="text-foreground/40 text-[11px]">— 無資料</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Failure history */}
            {result.failure_state.recent.length > 0 && (
              <div>
                <div className="text-[11px] text-foreground/60 mb-1.5">失敗紀錄（最近 {Math.min(5, result.failure_state.recent.length)} 筆）</div>
                <div className="space-y-1">
                  {result.failure_state.recent.slice(0, 5).map((f, i) => (
                    <div key={i} className="flex items-center gap-2 px-2 py-1.5 text-[11px] rounded border border-foreground/10">
                      <span className="tabular-nums text-foreground/70 w-20">{fmtDate(f.trade_date)}</span>
                      <Badge variant="outline" className="text-[10px]" style={{ color: f.reason === 'captcha_retry_exhausted' ? '#B45309' : '#4B5563' }}>
                        {f.reason}
                      </Badge>
                      <span className="text-foreground/60">嘗試 {f.attempts} · 連續 {f.consecutive_failures}</span>
                      <span className="ml-auto text-foreground/50">
                        {f.resolved_at ? <span className="text-emerald-700">已解決</span> : `下次：${fmtDT(f.next_retry_at)}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Panel({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="p-3 rounded border border-foreground/10">
      <div className="text-[10px] uppercase tracking-wider text-foreground/50">{label}</div>
      <div className="text-[14px] font-medium mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-foreground/60 mt-0.5">{sub}</div>}
    </div>
  );
}
