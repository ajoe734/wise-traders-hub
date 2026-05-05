import { useEffect, useMemo, useState } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, FileClock, Eye, Search } from 'lucide-react';
import { formatActionLabel } from '@/lib/auditLog';

interface AuditRow {
  id: string;
  action: string;
  target_id: string | null;
  detail: any;
  created_at: string;
}

interface ItemRow {
  id: string;
  item_id: string;
  title: string;
  category: string;
  lifecycle_status: string;
  win_rate: number | null;
  sample_size: number;
  rescue_started_at: string | null;
  rescue_attempts: number;
  candidate_observed_since: string | null;
  archived_reason: string | null;
  parent_item_id: string | null;
  version: number;
}

const KNOWLEDGE_ACTIONS = [
  'knowledge.auto_promote_active',
  'knowledge.auto_demote_rescue',
  'knowledge.auto_grid_search',
  'knowledge.candidate_created',
  'knowledge.auto_promote_candidate',
  'knowledge.auto_archive_candidate',
  'knowledge.auto_archive_rescue',
  'knowledge.activate',
  'knowledge.deactivate',
  'knowledge.update',
  'knowledge.create',
  'knowledge.delete',
];

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  active: { label: '使用中', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  candidate: { label: '備選', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  rescue: { label: '救援中', cls: 'bg-orange-100 text-orange-800 border-orange-200' },
  archived: { label: '已歸檔', cls: 'bg-muted text-muted-foreground' },
};

const fmt = (s: string) => {
  const d = new Date(s);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function describe(row: AuditRow): string {
  const ctx = row.detail?.context ?? {};
  const wr = ctx.win_rate != null ? ` 勝率 ${(Number(ctx.win_rate) * 100).toFixed(0)}%` : '';
  const n = ctx.sample_size != null ? `（n=${ctx.sample_size}）` : '';
  switch (row.action) {
    case 'knowledge.auto_promote_active':
      return `勝率達標自動升回使用中${wr}${n}`;
    case 'knowledge.auto_demote_rescue':
      return `勝率低於 ${ctx.threshold ? (Number(ctx.threshold) * 100).toFixed(0) + '%' : '門檻'} → 進救援${wr}${n}`;
    case 'knowledge.auto_grid_search': {
      const imp = ctx.improvement_pct != null ? ` 改善 ${Number(ctx.improvement_pct).toFixed(1)}%` : '';
      const best = ctx.best_win_rate != null ? `（最佳勝率 ${(Number(ctx.best_win_rate) * 100).toFixed(0)}%）` : '';
      return `第 ${ctx.attempts ?? '?'} 次網格搜尋${imp}${best}`;
    }
    case 'knowledge.candidate_created':
      return `建立備選版本（來自父條目 ${ctx.parent_item_id ?? ''}）`;
    case 'knowledge.auto_promote_candidate':
      return `備選通過觀察期 → 升使用中（新勝率 ${(Number(ctx.win_rate ?? 0) * 100).toFixed(0)}% vs 原 ${(Number(ctx.parent_win_rate ?? 0) * 100).toFixed(0)}%）`;
    case 'knowledge.auto_archive_candidate':
      return `備選表現不如原版 → 歸檔（${(Number(ctx.win_rate ?? 0) * 100).toFixed(0)}% < 原 ${(Number(ctx.parent_win_rate ?? 0) * 100).toFixed(0)}%）`;
    case 'knowledge.auto_archive_rescue':
      return `救援超過 ${ctx.max_weeks ?? '?'} 週仍無解 → 歸檔`;
    default:
      return formatActionLabel(row.action);
  }
}

export default function KnowledgeAudit() {
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [items, setItems] = useState<Record<string, ItemRow>>({});
  const [loading, setLoading] = useState(true);
  const [filterAction, setFilterAction] = useState<string>('all');
  const [filterItem, setFilterItem] = useState<string>('');
  const [detailOpen, setDetailOpen] = useState<AuditRow | null>(null);

  async function load() {
    setLoading(true);
    const [logsRes, itemsRes] = await Promise.all([
      supabase.from('audit_logs')
        .select('id,action,target_id,detail,created_at')
        .like('action', 'knowledge.%')
        .order('created_at', { ascending: false })
        .limit(500),
      supabase.from('checkup_knowledge_items')
        .select('id,item_id,title,category,lifecycle_status,win_rate,sample_size,rescue_started_at,rescue_attempts,candidate_observed_since,archived_reason,parent_item_id,version'),
    ]);
    if (logsRes.data) setLogs(logsRes.data as any);
    const map: Record<string, ItemRow> = {};
    for (const r of (itemsRes.data ?? []) as any[]) map[r.id] = r;
    setItems(map);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return logs.filter(l => {
      if (filterAction !== 'all' && l.action !== filterAction) return false;
      if (filterItem) {
        const it = l.target_id ? items[l.target_id] : null;
        const idStr = (l.detail?.context?.item_id ?? it?.item_id ?? '').toLowerCase();
        const titleStr = (it?.title ?? '').toLowerCase();
        const q = filterItem.toLowerCase();
        if (!idStr.includes(q) && !titleStr.includes(q)) return false;
      }
      return true;
    });
  }, [logs, items, filterAction, filterItem]);

  // 條目時間軸：以 target_id 分組，顯示前 10 個最活躍條目
  const timeline = useMemo(() => {
    const grouped: Record<string, AuditRow[]> = {};
    for (const l of logs) {
      if (!l.target_id) continue;
      (grouped[l.target_id] ??= []).push(l);
    }
    return Object.entries(grouped)
      .map(([id, rows]) => ({ id, rows, item: items[id] }))
      .filter(g => g.item)
      .sort((a, b) => b.rows.length - a.rows.length)
      .slice(0, 10);
  }, [logs, items]);

  return (
    <CompanyLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <FileClock className="h-6 w-6" /> 知識庫自動化審計
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              追蹤每個條目從使用中 → 備選 / 救援 / 歸檔的完整原因與參數變更
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            {loading && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}重新整理
          </Button>
        </div>

        {/* 條目生命週期時間軸 */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <h2 className="text-base font-medium">最活躍條目時間軸（Top 10）</h2>
            {timeline.length === 0 && (
              <p className="text-sm text-muted-foreground">尚無自動化動作紀錄。請先在「自動排程控制台」啟用排程。</p>
            )}
            {timeline.map(g => {
              const cur = STATUS_BADGE[g.item.lifecycle_status] ?? STATUS_BADGE.active;
              return (
                <div key={g.id} className="border rounded-lg p-3">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <code className="text-xs text-muted-foreground">{g.item.item_id}</code>
                    <span className="font-medium text-sm">{g.item.title}</span>
                    <Badge variant="outline">v{g.item.version}</Badge>
                    <Badge variant="outline" className={cur.cls}>目前：{cur.label}</Badge>
                    {typeof g.item.win_rate === 'number' && (
                      <Badge variant="outline">
                        勝率 {(Number(g.item.win_rate) * 100).toFixed(0)}% (n={g.item.sample_size})
                      </Badge>
                    )}
                    {g.item.archived_reason && (
                      <Badge variant="outline" className="bg-muted">歸檔原因：{g.item.archived_reason}</Badge>
                    )}
                  </div>
                  <div className="space-y-1">
                    {g.rows.slice(0, 6).map(r => (
                      <div key={r.id} className="flex items-start gap-2 text-xs">
                        <span className="text-muted-foreground tabular-nums shrink-0">{fmt(r.created_at)}</span>
                        <span className="text-foreground">{describe(r)}</span>
                      </div>
                    ))}
                    {g.rows.length > 6 && (
                      <div className="text-xs text-muted-foreground">… 還有 {g.rows.length - 6} 筆</div>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* 全量審計 list */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <h2 className="text-base font-medium">完整審計記錄</h2>
            <div className="flex gap-2 flex-wrap">
              <Select value={filterAction} onValueChange={setFilterAction}>
                <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">所有動作</SelectItem>
                  {KNOWLEDGE_ACTIONS.map(a => (
                    <SelectItem key={a} value={a}>{formatActionLabel(a)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative flex-1 min-w-[200px]">
                <Search className="h-3 w-3 absolute left-2 top-3 text-muted-foreground" />
                <Input
                  className="pl-7"
                  placeholder="搜尋 item_id 或標題"
                  value={filterItem}
                  onChange={e => setFilterItem(e.target.value)}
                />
              </div>
            </div>
            <div className="border rounded-lg divide-y">
              {filtered.slice(0, 200).map(l => {
                const it = l.target_id ? items[l.target_id] : null;
                return (
                  <div key={l.id} className="p-3 flex items-center justify-between gap-3 hover:bg-muted/30">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-xs">{formatActionLabel(l.action)}</Badge>
                        {it && <code className="text-xs text-muted-foreground">{it.item_id}</code>}
                        {it && <span className="text-sm truncate">{it.title}</span>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{describe(l)}</p>
                    </div>
                    <div className="text-xs text-muted-foreground tabular-nums shrink-0">{fmt(l.created_at)}</div>
                    <Button size="sm" variant="ghost" onClick={() => setDetailOpen(l)}>
                      <Eye className="h-3 w-3" />
                    </Button>
                  </div>
                );
              })}
              {filtered.length === 0 && !loading && (
                <p className="p-6 text-center text-sm text-muted-foreground">沒有符合條件的紀錄</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Dialog open={!!detailOpen} onOpenChange={(o) => !o && setDetailOpen(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>{detailOpen ? formatActionLabel(detailOpen.action) : ''}</DialogTitle></DialogHeader>
            {detailOpen && (
              <div className="space-y-2 text-sm">
                <div><span className="text-muted-foreground">時間：</span>{fmt(detailOpen.created_at)}</div>
                <div><span className="text-muted-foreground">說明：</span>{describe(detailOpen)}</div>
                <pre className="bg-muted p-3 rounded text-xs overflow-auto">{JSON.stringify(detailOpen.detail, null, 2)}</pre>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </CompanyLayout>
  );
}
