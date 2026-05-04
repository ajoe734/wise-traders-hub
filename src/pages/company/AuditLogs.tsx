import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { ChevronLeft, ChevronRight, FileClock, Eye, Download, ExternalLink } from 'lucide-react';
import { formatActionLabel, formatTargetType } from '@/lib/auditLog';

interface AuditLog {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: any;
  created_at: string;
}

const PAGE_SIZE = 50;

const fmtDateTime = (s: string) => {
  const d = new Date(s);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// 把 plan.* / setting.* 對應到管理頁
const TARGET_LINK: Record<string, (id: string) => string> = {
  expert_plan: () => '/company/plans',
  plan_split_overrides: () => '/company/plans',
  payment_settings: () => '/company/payments',
  payment_providers: () => '/company/payments',
  remittance_orders: () => '/company/remittance',
  member_subscriptions: () => '/company/subscribers',
  experts: () => '/company/analysts',
  announcements: () => '/company/announcements',
  expert_signals: () => '/company/subscribers',
  checkup_plans: () => '/company/plans',
  checkup_subscriptions: () => '/company/subscribers',
};

// 描述生成器：把 action + detail.context 拼成一句人話
function describe(log: AuditLog): string {
  const base = formatActionLabel(log.action);
  const ctx = log.detail?.context || {};
  const bits: string[] = [];
  if (ctx.plan_name) bits.push(`方案《${ctx.plan_name}》`);
  if (ctx.expert_name) bits.push(`分析師：${ctx.expert_name}`);
  if (ctx.display_name && !ctx.plan_name) bits.push(ctx.display_name);
  if (ctx.reason) bits.push(`原因：${ctx.reason}`);
  return bits.length > 0 ? `${base}　${bits.join('・')}` : base;
}

// Diff: 算 before/after 的 key 差異
function diffKeys(before: any, after: any): string[] {
  const keys = new Set<string>([
    ...Object.keys(before || {}),
    ...Object.keys(after || {}),
  ]);
  return Array.from(keys).filter(k => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]));
}

const fmtVal = (v: any): string => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? '是' : '否';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

const AuditLogsPage = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [actorMap, setActorMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [allActions, setAllActions] = useState<string[]>([]);
  const [detailLog, setDetailLog] = useState<AuditLog | null>(null);

  // Filters
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [namespaceFilter, setNamespaceFilter] = useState<string>('all');
  const [actorQuery, setActorQuery] = useState('');
  const [range, setRange] = useState<'7d' | '30d' | '90d' | 'all' | 'custom'>('30d');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // 動態 actions 列表
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('audit_logs')
        .select('action')
        .order('created_at', { ascending: false })
        .limit(500);
      const set = new Set<string>();
      (data || []).forEach((r: any) => set.add(r.action));
      setAllActions(Array.from(set).sort());
    })();
  }, []);

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, actionFilter, namespaceFilter, range, startDate, endDate]);

  const fetchLogs = async () => {
    setLoading(true);
    let q = supabase
      .from('audit_logs')
      .select('id, actor_id, action, target_type, target_id, detail, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    if (actionFilter !== 'all') q = q.eq('action', actionFilter);
    if (namespaceFilter !== 'all') q = q.like('action', `${namespaceFilter}.%`);

    // 時間範圍
    let s = startDate, e = endDate;
    if (range !== 'custom' && range !== 'all') {
      const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
      const from = new Date(Date.now() - days * 86400_000);
      s = from.toISOString();
      q = q.gte('created_at', s);
    } else if (range === 'custom') {
      if (s) q = q.gte('created_at', new Date(s).toISOString());
      if (e) {
        const ed = new Date(e); ed.setHours(23, 59, 59, 999);
        q = q.lte('created_at', ed.toISOString());
      }
    }

    const { data, count } = await q;
    const rows = (data as AuditLog[]) || [];
    setLogs(rows);
    setTotal(count || 0);

    const ids = [...new Set(rows.map((l) => l.actor_id).filter(Boolean))] as string[];
    if (ids.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name')
        .in('user_id', ids);
      const map: Record<string, string> = {};
      (profiles || []).forEach((p: any) => { map[p.user_id] = p.display_name || ''; });
      setActorMap(map);
    } else {
      setActorMap({});
    }
    setLoading(false);
  };

  const filteredLogs = useMemo(() => {
    if (!actorQuery.trim()) return logs;
    const q = actorQuery.toLowerCase();
    return logs.filter((l) => {
      const name = (l.actor_id ? actorMap[l.actor_id] || '' : '').toLowerCase();
      return name.includes(q) || (l.actor_id || '').toLowerCase().includes(q);
    });
  }, [logs, actorQuery, actorMap]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const namespaces = useMemo(() => {
    const set = new Set<string>();
    allActions.forEach(a => { const ns = a.split('.')[0]; if (ns) set.add(ns); });
    return Array.from(set).sort();
  }, [allActions]);

  const exportCsv = () => {
    const header = ['時間', '操作者', '動作', '描述', '目標類型', '目標ID'];
    const rows = filteredLogs.map(l => [
      fmtDateTime(l.created_at),
      l.actor_id ? (actorMap[l.actor_id] || l.actor_id) : '系統',
      l.action,
      describe(l).replace(/[\n\r,]/g, ' '),
      l.target_type || '',
      l.target_id || '',
    ]);
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `audit_logs_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FileClock className="h-6 w-6" /> 審計日誌
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              所有後台管理員的關鍵操作紀錄。系統排程任務請見{' '}
              <Link to="/company/system-jobs" className="underline">系統任務</Link>。
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="h-4 w-4 mr-2" />匯出 CSV
          </Button>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4 grid grid-cols-1 md:grid-cols-5 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">類別</label>
              <Select value={namespaceFilter} onValueChange={(v) => { setNamespaceFilter(v); setActionFilter('all'); setPage(0); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部類別</SelectItem>
                  {namespaces.map(ns => <SelectItem key={ns} value={ns}>{ns}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">動作</label>
              <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(0); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部動作</SelectItem>
                  {allActions
                    .filter(a => namespaceFilter === 'all' || a.startsWith(`${namespaceFilter}.`))
                    .map(a => <SelectItem key={a} value={a}>{formatActionLabel(a)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">時間範圍</label>
              <Select value={range} onValueChange={(v) => { setRange(v as any); setPage(0); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">最近 7 天</SelectItem>
                  <SelectItem value="30d">最近 30 天</SelectItem>
                  <SelectItem value="90d">最近 90 天</SelectItem>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="custom">自訂</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {range === 'custom' ? (
              <>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">開始</label>
                  <Input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setPage(0); }} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">結束</label>
                  <Input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setPage(0); }} />
                </div>
              </>
            ) : (
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs text-muted-foreground">操作者搜尋</label>
                <Input placeholder="姓名或 user_id" value={actorQuery} onChange={(e) => setActorQuery(e.target.value)} />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Logs Table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground whitespace-nowrap">時間</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">操作者</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">操作描述</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">目標</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground">動作</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={5} className="p-8 text-center text-muted-foreground text-sm">載入中...</td></tr>
                  ) : filteredLogs.length === 0 ? (
                    <tr><td colSpan={5} className="p-8 text-center text-muted-foreground text-sm">無符合條件的紀錄</td></tr>
                  ) : (
                    filteredLogs.map((log) => {
                      const actorName = log.actor_id ? (actorMap[log.actor_id] || log.actor_id.slice(0, 8)) : '系統';
                      const ns = log.action.split('.')[0];
                      const link = log.target_type && TARGET_LINK[log.target_type] && log.target_id
                        ? TARGET_LINK[log.target_type](log.target_id) : null;
                      return (
                        <tr key={log.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDateTime(log.created_at)}</td>
                          <td className="p-3 text-sm">{actorName}</td>
                          <td className="p-3">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="outline" className="text-[10px] uppercase">{ns}</Badge>
                              <span className="text-sm">{describe(log)}</span>
                            </div>
                          </td>
                          <td className="p-3 text-xs text-muted-foreground">
                            {formatTargetType(log.target_type)}
                          </td>
                          <td className="p-3 text-right whitespace-nowrap">
                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setDetailLog(log)}>
                              <Eye className="h-3 w-3 mr-1" />詳情
                            </Button>
                            {link && (
                              <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                                <Link to={link}><ExternalLink className="h-3 w-3 mr-1" />前往</Link>
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">共 {total} 筆，第 {page + 1} / {totalPages} 頁</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                <ChevronLeft className="h-4 w-4" /> 上一頁
              </Button>
              <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>
                下一頁 <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Dialog with diff */}
      <Dialog open={!!detailLog} onOpenChange={(o) => !o && setDetailLog(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          {detailLog && (
            <>
              <DialogHeader>
                <DialogTitle>{describe(detailLog)}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div className="text-xs text-muted-foreground space-y-1">
                  <div>時間：{fmtDateTime(detailLog.created_at)}</div>
                  <div>動作 key：<code className="bg-muted px-1 rounded">{detailLog.action}</code></div>
                  <div>目標：{formatTargetType(detailLog.target_type)} {detailLog.target_id && <span className="font-mono">{detailLog.target_id.slice(0,8)}</span>}</div>
                </div>

                {(detailLog.detail?.before || detailLog.detail?.after) ? (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-2">變更內容</div>
                    <div className="rounded-lg border overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/50 text-xs">
                            <th className="text-left p-2 w-1/4">欄位</th>
                            <th className="text-left p-2 w-3/8 text-muted-foreground">變更前</th>
                            <th className="text-left p-2 w-3/8">變更後</th>
                          </tr>
                        </thead>
                        <tbody>
                          {diffKeys(detailLog.detail.before, detailLog.detail.after).map(k => (
                            <tr key={k} className="border-t">
                              <td className="p-2 font-mono text-xs text-muted-foreground">{k}</td>
                              <td className="p-2 text-xs bg-muted/30">{fmtVal(detailLog.detail.before?.[k])}</td>
                              <td className="p-2 text-xs bg-amber-500/10">{fmtVal(detailLog.detail.after?.[k])}</td>
                            </tr>
                          ))}
                          {diffKeys(detailLog.detail.before, detailLog.detail.after).length === 0 && (
                            <tr><td colSpan={3} className="p-4 text-center text-xs text-muted-foreground">無欄位差異</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                {detailLog.detail?.context && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-2">補充資訊</div>
                    <pre className="bg-muted p-3 rounded text-xs overflow-auto">{JSON.stringify(detailLog.detail.context, null, 2)}</pre>
                  </div>
                )}

                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">原始 JSON</summary>
                  <pre className="bg-muted p-3 rounded mt-2 overflow-auto max-h-60">{JSON.stringify(detailLog.detail, null, 2)}</pre>
                </details>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </CompanyLayout>
  );
};

export default AuditLogsPage;
