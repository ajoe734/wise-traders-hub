import { useEffect, useMemo, useState } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { ChevronLeft, ChevronRight, FileClock, Eye } from 'lucide-react';

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

const ACTION_LABELS: Record<string, { label: string; className: string }> = {
  refund_executed: { label: '退款執行', className: 'bg-destructive/10 text-destructive border-destructive/30' },
  analyst_created: { label: '建立分析師', className: 'bg-blue-500/10 text-blue-600 border-blue-500/30' },
  signal_repush: { label: '訊號重推', className: 'bg-amber-500/10 text-amber-600 border-amber-500/30' },
};

const fmtDateTime = (s: string) => {
  const d = new Date(s);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const AuditLogsPage = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [actorMap, setActorMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  // Filters
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [actorQuery, setActorQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, actionFilter, startDate, endDate]);

  const fetchLogs = async () => {
    setLoading(true);
    let q = supabase
      .from('audit_logs')
      .select('id, actor_id, action, target_type, target_id, detail, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    if (actionFilter !== 'all') {
      if (actionFilter === 'other') {
        q = q.not('action', 'in', `(${Object.keys(ACTION_LABELS).join(',')})`);
      } else {
        q = q.eq('action', actionFilter);
      }
    }
    if (startDate) q = q.gte('created_at', new Date(startDate).toISOString());
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      q = q.lte('created_at', end.toISOString());
    }

    const { data, count } = await q;
    const rows = (data as AuditLog[]) || [];
    setLogs(rows);
    setTotal(count || 0);

    // Resolve actor display names
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

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileClock className="h-6 w-6" /> 審計日誌
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            追蹤平台後台關鍵操作紀錄（退款、建立分析師、訊號重推等）
          </p>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">動作類型</label>
              <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(0); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="refund_executed">退款執行</SelectItem>
                  <SelectItem value="analyst_created">建立分析師</SelectItem>
                  <SelectItem value="signal_repush">訊號重推</SelectItem>
                  <SelectItem value="other">其他</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">開始日期</label>
              <Input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setPage(0); }} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">結束日期</label>
              <Input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setPage(0); }} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">操作者搜尋</label>
              <Input placeholder="姓名或 ID" value={actorQuery} onChange={(e) => setActorQuery(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        {/* Logs Table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">時間</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">操作者</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">動作</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">目標類型</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">目標 ID</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">詳情</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={6} className="p-8 text-center text-muted-foreground text-sm">載入中...</td></tr>
                  ) : filteredLogs.length === 0 ? (
                    <tr><td colSpan={6} className="p-8 text-center text-muted-foreground text-sm">無符合條件的紀錄</td></tr>
                  ) : (
                    filteredLogs.map((log) => {
                      const actionInfo = ACTION_LABELS[log.action];
                      const actorName = log.actor_id ? (actorMap[log.actor_id] || log.actor_id.slice(0, 8)) : '系統';
                      return (
                        <tr key={log.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="p-3 text-sm text-muted-foreground whitespace-nowrap">{fmtDateTime(log.created_at)}</td>
                          <td className="p-3 text-sm">{actorName}</td>
                          <td className="p-3">
                            {actionInfo ? (
                              <Badge className={`text-xs ${actionInfo.className}`} variant="outline">{actionInfo.label}</Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs">{log.action}</Badge>
                            )}
                          </td>
                          <td className="p-3 text-sm text-muted-foreground">{log.target_type || '-'}</td>
                          <td className="p-3 text-xs text-muted-foreground font-mono">{log.target_id ? log.target_id.slice(0, 8) : '-'}</td>
                          <td className="p-3">
                            {log.detail && Object.keys(log.detail).length > 0 ? (
                              <Dialog>
                                <DialogTrigger asChild>
                                  <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                                    <Eye className="h-3 w-3" /> 檢視
                                  </Button>
                                </DialogTrigger>
                                <DialogContent className="max-w-2xl">
                                  <DialogHeader>
                                    <DialogTitle>詳情 — {actionInfo?.label || log.action}</DialogTitle>
                                  </DialogHeader>
                                  <pre className="bg-muted p-4 rounded text-xs overflow-auto max-h-[60vh]">
                                    {JSON.stringify(log.detail, null, 2)}
                                  </pre>
                                </DialogContent>
                              </Dialog>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
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

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              共 {total} 筆，第 {page + 1} / {totalPages} 頁
            </p>
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
    </CompanyLayout>
  );
};

export default AuditLogsPage;
