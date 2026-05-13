import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, RefreshCw, Archive, RotateCcw } from 'lucide-react';
import { logAdminAction } from '@/lib/auditLog';

interface Candidate {
  id: string;
  item_id: string;
  category: string;
  title: string;
  reason: string;
  recent_hits?: number;
  win_rate?: number;
  sample_size?: number;
}

interface PruneResult {
  thresholds: {
    stale_days: number;
    min_age_days: number;
    min_sample_size: number;
    low_win_rate: number;
  };
  counts: {
    total_active_items: number;
    candidates_stale: number;
    candidates_low_win: number;
    candidates_total: number;
  };
  candidates_stale: Candidate[];
  candidates_low_win: Candidate[];
}

interface ArchivedRow {
  id: string;
  item_id: string;
  category: string;
  title: string;
  archived_at: string | null;
  archived_reason: string | null;
}

const CAT_LABEL: Record<string, string> = {
  industry_trends: '產業趨勢',
  chip_analysis: '籌碼分析',
  technical_analysis: '技術分析',
  strategy_cases: '策略案例',
  news_correlation: '新聞事件',
};

export function CleanupCandidatesPanel({ onChanged }: { onChanged?: () => void }) {
  const [loading, setLoading] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [report, setReport] = useState<PruneResult | null>(null);
  const [archived, setArchived] = useState<ArchivedRow[]>([]);
  const [restoring, setRestoring] = useState<string | null>(null);

  async function loadCandidates() {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('prune-knowledge-base', {
        body: { dryRun: true },
      });
      if (error) throw error;
      setReport(data);
    } catch (e: any) {
      toast.error(`載入候選失敗：${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadArchived() {
    const { data, error } = await supabase
      .from('checkup_knowledge_items')
      .select('id, item_id, category, title, archived_at, archived_reason')
      .eq('lifecycle_status', 'archived')
      .order('archived_at', { ascending: false })
      .limit(100);
    if (error) { toast.error(error.message); return; }
    setArchived((data ?? []) as ArchivedRow[]);
  }

  useEffect(() => {
    loadCandidates();
    loadArchived();
  }, []);

  async function archiveOne(c: Candidate) {
    if (!confirm(`確定將「${c.title}」歸檔？歸檔後不會出現在 AI prompt。`)) return;
    const { error } = await supabase
      .from('checkup_knowledge_items')
      .update({
        lifecycle_status: 'archived',
        archived_at: new Date().toISOString(),
        archived_reason: `manual:${c.reason}`,
      })
      .eq('id', c.id);
    if (error) { toast.error(error.message); return; }
    await logAdminAction({
      action: 'knowledge.archive',
      targetType: 'checkup_knowledge_items',
      targetId: c.id,
      detail: { reason: c.reason },
    });
    toast.success('已歸檔');
    loadCandidates();
    loadArchived();
    onChanged?.();
  }

  async function archiveAll() {
    if (!report) return;
    const all = [...report.candidates_stale, ...report.candidates_low_win];
    if (all.length === 0) return;
    if (!confirm(`確定一鍵歸檔全部 ${all.length} 條候選？`)) return;
    setPruning(true);
    try {
      const { data, error } = await supabase.functions.invoke('prune-knowledge-base', {
        body: { dryRun: false },
      });
      if (error) throw error;
      toast.success(`已歸檔 ${data?.archived ?? 0} 條${data?.errors?.length ? `（失敗 ${data.errors.length}）` : ''}`);
      loadCandidates();
      loadArchived();
      onChanged?.();
    } catch (e: any) {
      toast.error(`歸檔失敗：${e?.message ?? e}`);
    } finally {
      setPruning(false);
    }
  }

  async function restore(row: ArchivedRow) {
    if (!confirm(`確定將「${row.title}」復活回 active？`)) return;
    setRestoring(row.id);
    const { error } = await supabase
      .from('checkup_knowledge_items')
      .update({
        lifecycle_status: 'active',
        archived_at: null,
        archived_reason: null,
      })
      .eq('id', row.id);
    setRestoring(null);
    if (error) { toast.error(error.message); return; }
    await logAdminAction({
      action: 'knowledge.restore',
      targetType: 'checkup_knowledge_items',
      targetId: row.id,
    });
    toast.success('已復活');
    loadArchived();
    loadCandidates();
    onChanged?.();
  }

  return (
    <div className="space-y-6">
      <div className="border rounded-lg p-4 bg-muted/30">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div>
            <h3 className="font-medium">自動清理規則</h3>
            <p className="text-xs text-muted-foreground mt-1">
              規則 1：建立 &gt; {report?.thresholds.min_age_days ?? 30} 天 且過去 {report?.thresholds.stale_days ?? 90} 天 0 命中 → 死庫存<br />
              規則 2：sample_size ≥ {report?.thresholds.min_sample_size ?? 20} 且 win_rate &lt; {((report?.thresholds.low_win_rate ?? 0.4) * 100).toFixed(0)}% → 實戰打臉<br />
              cron：每週日 03:00 (UTC+8) 自動執行歸檔。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={loadCandidates} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              重新計算
            </Button>
            <Button onClick={archiveAll} disabled={pruning || !report || report.counts.candidates_total === 0}>
              {pruning ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Archive className="h-4 w-4 mr-1" />}
              一鍵歸檔全部 {report ? `(${report.counts.candidates_total})` : ''}
            </Button>
          </div>
        </div>

        {report && (
          <div className="grid grid-cols-3 gap-3 text-sm">
            <Stat label="目前 active 條目" n={report.counts.total_active_items} />
            <Stat label="死庫存候選" n={report.counts.candidates_stale} cls="bg-orange-100 text-orange-800" />
            <Stat label="實戰打臉候選" n={report.counts.candidates_low_win} cls="bg-red-100 text-red-800" />
          </div>
        )}
      </div>

      {report && report.candidates_stale.length > 0 && (
        <Section title={`死庫存（${report.candidates_stale.length}）`}>
          {report.candidates_stale.map(c => (
            <CandidateRow key={c.id} c={c} onArchive={() => archiveOne(c)} extra={`近 ${report.thresholds.stale_days} 天命中：${c.recent_hits}`} />
          ))}
        </Section>
      )}

      {report && report.candidates_low_win.length > 0 && (
        <Section title={`實戰打臉（${report.candidates_low_win.length}）`}>
          {report.candidates_low_win.map(c => (
            <CandidateRow key={c.id} c={c} onArchive={() => archiveOne(c)} extra={`勝率 ${((c.win_rate ?? 0) * 100).toFixed(0)}% / n=${c.sample_size}`} />
          ))}
        </Section>
      )}

      {report && report.counts.candidates_total === 0 && !loading && (
        <p className="text-center text-sm text-muted-foreground py-8">目前沒有符合清理規則的條目 🎉</p>
      )}

      <Section title={`已歸檔（最近 ${archived.length} 條，可復活）`}>
        {archived.length === 0 && <p className="text-sm text-muted-foreground">尚未有歸檔條目。</p>}
        {archived.map(row => (
          <div key={row.id} className="border rounded p-3 flex items-center gap-2 flex-wrap text-sm">
            <Badge variant="outline">{CAT_LABEL[row.category] ?? row.category}</Badge>
            <code className="text-xs text-muted-foreground">{row.item_id}</code>
            <span className="font-medium">{row.title}</span>
            <Badge variant="secondary" className="text-xs">{row.archived_reason ?? '—'}</Badge>
            <span className="text-xs text-muted-foreground ml-auto">
              {row.archived_at ? new Date(row.archived_at).toLocaleDateString('zh-TW') : '—'}
            </span>
            <Button size="sm" variant="ghost" onClick={() => restore(row)} disabled={restoring === row.id}>
              {restoring === row.id ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RotateCcw className="h-3 w-3 mr-1" />}
              復活
            </Button>
          </div>
        ))}
      </Section>
    </div>
  );
}

function Stat({ label, n, cls = 'bg-muted' }: { label: string; n: number; cls?: string }) {
  return (
    <div className={`rounded border p-3 ${cls}`}>
      <div className="text-xs">{label}</div>
      <div className="text-2xl font-medium tabular-nums">{n}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </div>
  );
}

function CandidateRow({ c, onArchive, extra }: { c: Candidate; onArchive: () => void; extra: string }) {
  return (
    <div className="border rounded p-3 flex items-center gap-2 flex-wrap text-sm">
      <Badge variant="outline">{CAT_LABEL[c.category] ?? c.category}</Badge>
      <code className="text-xs text-muted-foreground">{c.item_id}</code>
      <span className="font-medium">{c.title}</span>
      <span className="text-xs text-muted-foreground">· {extra}</span>
      <Button size="sm" variant="outline" onClick={onArchive} className="ml-auto">
        <Archive className="h-3 w-3 mr-1" /> 歸檔
      </Button>
    </div>
  );
}
