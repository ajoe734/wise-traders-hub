import { SEO } from '@/components/SEO';
import { useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { GitMerge, Eye, Copy, Download } from 'lucide-react';
import { toast } from 'sonner';

/**
 * 帳號合併管理頁。列出 account_merges，並可依 primary/secondary user id、
 * action（account_link_consume / admin_account_force_merge）、時間範圍過濾。
 * 點擊「詳細」查看對應 audit_logs.detail（含 moved_counts / sub_conflicts）。
 */

interface MergeRow {
  id: string;
  primary_user_id: string;
  secondary_user_id: string;
  primary_identity: string | null;
  secondary_identity: string | null;
  primary_email: string | null;
  secondary_email: string | null;
  moved_counts: any;
  performed_by: string | null;
  created_at: string;
}

interface AuditRow {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: any;
  created_at: string;
}

const PAGE_SIZE = 50;

const ACTIONS = [
  { value: 'all', label: '全部動作' },
  { value: 'account_link_consume', label: '會員自助綁定 (account_link_consume)' },
  { value: 'admin_account_force_merge', label: '管理員代客綁定 (admin_account_force_merge)' },
];

const fmt = (s: string) => {
  const d = new Date(s);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const shortId = (v: string | null | undefined) => (v ? `${v.slice(0, 8)}…` : '—');

const copy = async (v: string) => {
  try {
    await navigator.clipboard.writeText(v);
    toast.success('已複製');
  } catch {
    toast.error('複製失敗');
  }
};

const AccountMergesPage = () => {
  const [page, setPage] = useState(0);
  const [action, setAction] = useState<string>('all');
  const [primary, setPrimary] = useState('');
  const [secondary, setSecondary] = useState('');
  const [range, setRange] = useState<'7d' | '30d' | '90d' | 'all' | 'custom'>('30d');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [detail, setDetail] = useState<MergeRow | null>(null);

  const { data, isFetching } = useQuery({
    queryKey: ['company', 'account-merges', { page, action, primary, secondary, range, startDate, endDate }],
    queryFn: async () => {
      let q = supabase
        .from('account_merges')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      if (primary.trim()) q = q.eq('primary_user_id', primary.trim());
      if (secondary.trim()) q = q.eq('secondary_user_id', secondary.trim());

      if (range === 'custom') {
        if (startDate) q = q.gte('created_at', new Date(startDate).toISOString());
        if (endDate) {
          const ed = new Date(endDate); ed.setHours(23, 59, 59, 999);
          q = q.lte('created_at', ed.toISOString());
        }
      } else if (range !== 'all') {
        const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
        q = q.gte('created_at', new Date(Date.now() - days * 86400_000).toISOString());
      }

      const { data: rows, count } = await q;
      let list = (rows as MergeRow[]) || [];

      // account_merges 沒有 action 欄位，改用 audit_logs 對齊：以 secondary_user_id 找對應 audit row
      const secIds = list.map((r) => r.secondary_user_id);
      let auditMap: Record<string, AuditRow> = {};
      if (secIds.length) {
        const { data: audits } = await supabase
          .from('audit_logs')
          .select('id, actor_id, action, target_type, target_id, detail, created_at')
          .in('action', ['account_link_consume', 'admin_account_force_merge'])
          .in('target_id', secIds);
        (audits || []).forEach((a: any) => { auditMap[a.target_id] = a; });
      }

      if (action !== 'all') {
        list = list.filter((r) => auditMap[r.secondary_user_id]?.action === action);
      }

      return { rows: list, total: count || 0, auditMap };
    },
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const rows = data?.rows ?? [];
  const auditMap = data?.auditMap ?? {};
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  const detailAudit = detail ? auditMap[detail.secondary_user_id] : null;

  const exportCsv = () => {
    const header = ['時間', '動作', '主帳號', '主 email', '副帳號', '副 email', '執行者', 'sub_conflicts 數', 'moved_counts 表數'];
    const csvRows = rows.map((r) => {
      const a = auditMap[r.secondary_user_id];
      const conflicts = ((r.moved_counts as any)?._sub_conflicts ?? []).length;
      const tableCount = Object.keys(r.moved_counts || {}).filter((k) => !k.startsWith('_')).length;
      return [fmt(r.created_at), a?.action || '—', r.primary_user_id, r.primary_email || '', r.secondary_user_id, r.secondary_email || '', r.performed_by || '', conflicts, tableCount];
    });
    const csv = [header, ...csvRows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `account_merges_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const conflicts = useMemo(() => {
    if (!detail) return [] as any[];
    return ((detail.moved_counts as any)?._sub_conflicts ?? []) as any[];
  }, [detail]);

  return (
    <CompanyLayout>
      <SEO title="帳號合併管理 | legendflow" description="平台帳號合併紀錄與稽核。" path="/company/account-merges" noindex />
      <div className="space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <GitMerge className="h-6 w-6" /> 帳號合併管理
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              查看 <code>account_merges</code> 全部紀錄，支援 primary / secondary、動作類型、時間篩選；點擊詳細可看 audit_logs 完整內容（含 moved_counts 與 sub_conflicts）。
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="h-4 w-4 mr-2" />匯出 CSV
          </Button>
        </div>

        <Card>
          <CardContent className="p-4 grid gap-3 md:grid-cols-5">
            <div>
              <label className="text-xs text-muted-foreground">動作</label>
              <Select value={action} onValueChange={(v) => { setPage(0); setAction(v); }}>
                <SelectTrigger data-testid="merge-action-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTIONS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Primary user id</label>
              <Input value={primary} onChange={(e) => { setPage(0); setPrimary(e.target.value); }} placeholder="uuid" data-testid="merge-primary-filter" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Secondary user id</label>
              <Input value={secondary} onChange={(e) => { setPage(0); setSecondary(e.target.value); }} placeholder="uuid" data-testid="merge-secondary-filter" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">時間範圍</label>
              <Select value={range} onValueChange={(v) => { setPage(0); setRange(v as any); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">近 7 天</SelectItem>
                  <SelectItem value="30d">近 30 天</SelectItem>
                  <SelectItem value="90d">近 90 天</SelectItem>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="custom">自訂</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {range === 'custom' && (
              <div className="flex gap-2">
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="merge-table">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-3 py-2">時間</th>
                    <th className="px-3 py-2">動作</th>
                    <th className="px-3 py-2">Primary</th>
                    <th className="px-3 py-2">Secondary</th>
                    <th className="px-3 py-2">衝突</th>
                    <th className="px-3 py-2">搬移表</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const a = auditMap[r.secondary_user_id];
                    const conflictN = ((r.moved_counts as any)?._sub_conflicts ?? []).length;
                    const tables = Object.keys(r.moved_counts || {}).filter((k) => !k.startsWith('_')).length;
                    return (
                      <tr key={r.id} className="border-t hover:bg-muted/20">
                        <td className="px-3 py-2 whitespace-nowrap">{fmt(r.created_at)}</td>
                        <td className="px-3 py-2">
                          <Badge variant={a?.action === 'admin_account_force_merge' ? 'default' : 'secondary'}>
                            {a?.action === 'admin_account_force_merge' ? '管理員代客' : a?.action === 'account_link_consume' ? '會員自助' : '—'}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">
                          <div>{r.primary_email || '（無 email）'}</div>
                          <button className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1" onClick={() => copy(r.primary_user_id)}>
                            {shortId(r.primary_user_id)} <Copy className="h-3 w-3" />
                          </button>
                        </td>
                        <td className="px-3 py-2">
                          <div>{r.secondary_email || '（無 email）'}</div>
                          <button className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1" onClick={() => copy(r.secondary_user_id)}>
                            {shortId(r.secondary_user_id)} <Copy className="h-3 w-3" />
                          </button>
                        </td>
                        <td className="px-3 py-2">{conflictN}</td>
                        <td className="px-3 py-2">{tables}</td>
                        <td className="px-3 py-2">
                          <Button size="sm" variant="ghost" onClick={() => setDetail(r)}>
                            <Eye className="h-4 w-4 mr-1" />詳細
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {!rows.length && !isFetching && (
                    <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">沒有符合條件的紀錄</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">共 {data?.total ?? 0} 筆 · 第 {page + 1} / {totalPages} 頁</div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>上一頁</Button>
            <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>下一頁</Button>
          </div>
        </div>

        <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>合併紀錄詳細</DialogTitle>
            </DialogHeader>
            {detail && (
              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div><span className="text-muted-foreground">時間：</span>{fmt(detail.created_at)}</div>
                  <div><span className="text-muted-foreground">動作：</span>{detailAudit?.action || '—'}</div>
                  <div><span className="text-muted-foreground">Primary：</span>{detail.primary_email || detail.primary_user_id}</div>
                  <div><span className="text-muted-foreground">Secondary：</span>{detail.secondary_email || detail.secondary_user_id}</div>
                  <div><span className="text-muted-foreground">Primary identity：</span>{detail.primary_identity || '—'}</div>
                  <div><span className="text-muted-foreground">Secondary identity：</span>{detail.secondary_identity || '—'}</div>
                  <div><span className="text-muted-foreground">執行者：</span>{detail.performed_by || '—'}</div>
                </div>

                <section>
                  <h3 className="font-semibold mb-1">訂閱衝突 (_sub_conflicts)</h3>
                  {conflicts.length === 0 && <p className="text-muted-foreground">無</p>}
                  {conflicts.map((g: any, i: number) => (
                    <div key={i} className="border rounded p-2 mb-2">
                      <div className="text-xs text-muted-foreground">plan_id: {g.plan_id}</div>
                      <div className="text-emerald-700 dark:text-emerald-400">
                        保留：id {shortId(g.kept?.id)} · 到期 {g.kept?.expires_at ? new Date(g.kept.expires_at).toLocaleDateString() : '—'}
                      </div>
                      {(g.canceled || []).map((c: any) => (
                        <div key={c.id} className="text-muted-foreground">
                          已取消：id {shortId(c.id)} · 到期 {c.expires_at ? new Date(c.expires_at).toLocaleDateString() : '—'}
                        </div>
                      ))}
                    </div>
                  ))}
                </section>

                <section>
                  <h3 className="font-semibold mb-1">moved_counts</h3>
                  <pre className="bg-muted/40 rounded p-2 text-xs overflow-auto max-h-64">
                    {JSON.stringify(detail.moved_counts, null, 2)}
                  </pre>
                </section>

                <section>
                  <h3 className="font-semibold mb-1">audit_logs.detail</h3>
                  {detailAudit ? (
                    <pre className="bg-muted/40 rounded p-2 text-xs overflow-auto max-h-64">
                      {JSON.stringify(detailAudit.detail, null, 2)}
                    </pre>
                  ) : (
                    <p className="text-muted-foreground">找不到對應 audit_logs 紀錄（可能較舊、或建立時失敗）。</p>
                  )}
                </section>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </CompanyLayout>
  );
};

export default AccountMergesPage;
