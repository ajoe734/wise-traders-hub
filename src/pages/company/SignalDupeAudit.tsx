import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import SEO from '@/components/SEO';
import { RefreshCw, AlertTriangle, CheckCircle2, ShieldAlert, Zap } from 'lucide-react';
import { toast } from 'sonner';

type Row = {
  signal_id: string;
  expert_id: string | null;
  expert_name: string | null;
  instrument: string | null;
  action: string | null;
  signal_published_at: string | null;
  dup_count: number;
  open_count: number;
  trade_ids: string[];
  has_manual_edit: boolean;
  earliest_created_at: string | null;
};

type FixResult = {
  ok: boolean;
  kept_id?: string;
  removed_ids?: string[];
  would_remove_count?: number;
  removed_count?: number;
  has_manual_edit?: boolean;
  executed?: boolean;
  note?: string;
};

function fmtDate(v: string | null): string {
  if (!v) return '—';
  try {
    const d = new Date(v);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch { return v; }
}

type SweepLog = {
  created_at: string;
  payload: {
    scanned?: number;
    auto_fixed?: number;
    needs_review?: number;
    removed_total?: number;
    dry_run?: boolean;
  } | null;
};

export default function SignalDupeAudit() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [previews, setPreviews] = useState<Record<string, FixResult>>({});
  const [forceOn, setForceOn] = useState<Record<string, boolean>>({});
  const [lastSweep, setLastSweep] = useState<SweepLog | null>(null);
  const [sweeping, setSweeping] = useState(false);

  const scan = useCallback(async () => {
    setScanning(true);
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_signal_dupe_trades_audit');
      if (error) throw error;
      setRows((data as any as Row[]) || []);
      setPreviews({});
    } catch (e: any) {
      toast.error(`掃描失敗：${e?.message || e}`);
    } finally {
      setLoading(false);
      setScanning(false);
    }
  }, []);

  useEffect(() => { scan(); }, [scan]);

  const summary = useMemo(() => {
    const affected = rows.length;
    const dupTrades = rows.reduce((s, r) => s + Math.max(0, (r.dup_count || 0) - 1), 0);
    const manual = rows.filter((r) => r.has_manual_edit).length;
    return { affected, dupTrades, manual };
  }, [rows]);

  const cleanRows = useMemo(() => rows.filter((r) => !r.has_manual_edit), [rows]);

  async function preview(signalId: string) {
    setBusyId(signalId);
    try {
      const { data, error } = await supabase.rpc('admin_signal_dupe_trades_fix', {
        p_signal_id: signalId, p_dry_run: true, p_force: false,
      });
      if (error) throw error;
      setPreviews((p) => ({ ...p, [signalId]: data as FixResult }));
    } catch (e: any) {
      toast.error(`試算失敗：${e?.message || e}`);
    } finally { setBusyId(null); }
  }

  async function execute(signalId: string, hasManual: boolean) {
    if (hasManual && !forceOn[signalId]) {
      toast.error('此列已被手動編輯，請先勾選「確認強制刪除」');
      return;
    }
    setBusyId(signalId);
    try {
      const { data, error } = await supabase.rpc('admin_signal_dupe_trades_fix', {
        p_signal_id: signalId, p_dry_run: false, p_force: hasManual,
      });
      if (error) throw error;
      const r = data as FixResult;
      toast.success(`已刪除 ${r.removed_count ?? 0} 筆重複紀錄`);
      await scan();
    } catch (e: any) {
      toast.error(`修復失敗：${e?.message || e}`);
    } finally { setBusyId(null); }
  }

  async function fixAllClean() {
    if (cleanRows.length === 0) return;
    if (!confirm(`將對 ${cleanRows.length} 筆「無手動編輯」個案執行修復，每列保留最舊那筆、刪除其他。確認嗎？`)) return;
    setLoading(true);
    let ok = 0, fail = 0;
    for (const r of cleanRows) {
      try {
        const { error } = await supabase.rpc('admin_signal_dupe_trades_fix', {
          p_signal_id: r.signal_id, p_dry_run: false, p_force: false,
        });
        if (error) throw error;
        ok++;
      } catch { fail++; }
    }
    toast.success(`批次完成：成功 ${ok}、失敗 ${fail}`);
    await scan();
  }

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8">
      <SEO title="Signal 重複持倉稽核｜後台" description="掃描 signal_id 對應多筆 trade_records 的異常並一鍵修復" />

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Signal 重複持倉稽核</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            掃描每個 signal_id 是否對應多筆 trade_records，保留最舊、刪除其他。
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={scan}
            disabled={scanning}
            className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted"
          >
            <RefreshCw className={`h-4 w-4 ${scanning ? 'animate-spin' : ''}`} />
            重新掃描
          </button>
          <button
            onClick={fixAllClean}
            disabled={loading || cleanRows.length === 0}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-40"
          >
            <CheckCircle2 className="h-4 w-4" />
            修復所有「無手動編輯」（{cleanRows.length}）
          </button>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-3">
        <SumCard label="受影響 signal 數" value={summary.affected} tone="orange" />
        <SumCard label="多餘 trade 總數" value={summary.dupTrades} tone="red" />
        <SumCard label="其中有手動編輯" value={summary.manual} tone="amber" />
      </div>

      {loading && rows.length === 0 ? (
        <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">掃描中…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border p-8 text-center text-sm text-emerald-700">
          <CheckCircle2 className="mx-auto mb-2 h-6 w-6" />
          目前沒有重複的 signal_id ✓
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">老師</th>
                <th className="px-3 py-2 text-left">標的</th>
                <th className="px-3 py-2 text-left">action</th>
                <th className="px-3 py-2 text-left">發佈時間</th>
                <th className="px-3 py-2 text-right">重複 / 開倉</th>
                <th className="px-3 py-2 text-left">狀態</th>
                <th className="px-3 py-2 text-left">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pv = previews[r.signal_id];
                const isBusy = busyId === r.signal_id;
                return (
                  <tr key={r.signal_id} className="border-t align-top">
                    <td className="px-3 py-2">{r.expert_name || '—'}</td>
                    <td className="px-3 py-2 font-medium">{r.instrument || '—'}</td>
                    <td className="px-3 py-2">{r.action || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.signal_published_at)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.dup_count} / {r.open_count}
                    </td>
                    <td className="px-3 py-2">
                      {r.has_manual_edit ? (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                          <ShieldAlert className="h-3 w-3" /> 疑似手動編輯
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                          可安全清理
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => preview(r.signal_id)}
                          disabled={isBusy}
                          className="rounded border px-2 py-1 text-xs hover:bg-muted"
                        >試算</button>
                        <button
                          onClick={() => setExpanded((e) => ({ ...e, [r.signal_id]: !e[r.signal_id] }))}
                          className="rounded border px-2 py-1 text-xs hover:bg-muted"
                        >
                          {expanded[r.signal_id] ? '收起' : '展開'} trade_ids
                        </button>
                        {r.has_manual_edit && (
                          <label className="inline-flex items-center gap-1 text-xs text-amber-900">
                            <input
                              type="checkbox"
                              checked={!!forceOn[r.signal_id]}
                              onChange={(e) => setForceOn((f) => ({ ...f, [r.signal_id]: e.target.checked }))}
                            />
                            確認強制刪除
                          </label>
                        )}
                        <button
                          onClick={() => execute(r.signal_id, r.has_manual_edit)}
                          disabled={isBusy || (r.has_manual_edit && !forceOn[r.signal_id])}
                          className="rounded bg-red-600 px-2 py-1 text-xs text-white disabled:opacity-40"
                        >執行修復</button>
                      </div>
                      {pv && (
                        <div className="mt-2 rounded bg-muted/40 p-2 text-xs">
                          <div>保留：<code className="font-mono">{pv.kept_id}</code></div>
                          <div>將刪除 {pv.would_remove_count} 筆：</div>
                          <ul className="ml-3 list-disc font-mono">
                            {(pv.removed_ids || []).map((id) => <li key={id}>{id}</li>)}
                          </ul>
                        </div>
                      )}
                      {expanded[r.signal_id] && (
                        <div className="mt-2 rounded bg-muted/30 p-2 font-mono text-[11px]">
                          {r.trade_ids.map((id, i) => (
                            <div key={id}>{i === 0 ? '★ ' : '  '}{id}</div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-6 rounded-md border-l-4 border-amber-400 bg-amber-50 p-3 text-xs text-amber-900">
        <AlertTriangle className="mr-1 inline h-3 w-3" />
        修復規則：每個 signal_id 只保留 <b>created_at 最舊</b> 那筆，其餘刪除。若偵測到不同筆的 entry_price/quantity/quantity_unit/entry_date 不一致，或已有 exit_date，會標記為「疑似手動編輯」並要求手動確認強制刪除。所有刪除都會寫入 <code>audit_logs</code>。
      </div>
    </div>
  );
}

function SumCard({ label, value, tone }: { label: string; value: number; tone: 'orange' | 'red' | 'amber' }) {
  const cls = tone === 'red' ? 'border-red-200 bg-red-50 text-red-900'
    : tone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-orange-200 bg-orange-50 text-orange-900';
  return (
    <div className={`rounded-md border p-4 ${cls}`}>
      <div className="text-xs">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
