import { useEffect, useState } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { Activity, ChevronLeft, ChevronRight } from 'lucide-react';

interface JobLog {
  id: string;
  job_name: string;
  status: string;
  detail: any;
  duration_ms: number | null;
  ran_at: string;
}

const PAGE_SIZE = 50;

const JOB_LABELS: Record<string, string> = {
  'stock-price-sync': '股價同步（每30分）',
  'expire-stale-remittance': '匯款訂單過期清理',
  'checkup-price-refresh': '持倉看板股價刷新（13:30）',
  'mentor-journal-publish': '導師交易日誌自動發布（週五20:00）',
  'announcement-cleanup': '系統公告 7 天清理',
  'cleanup_old_announcements': '系統公告 7 天清理',
  'delete_expired_binding_codes': 'Line 綁定碼過期清理',
  'delete_old_prices': '股價快取清理',
  'mentor-journal-cron': '導師交易日誌自動發布（週五20:00）',
};
const fmtJobName = (n: string) => JOB_LABELS[n] || n;

const fmtDateTime = (s: string) => {
  const d = new Date(s);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function SystemJobsPage() {
  const [logs, setLogs] = useState<JobLog[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [jobNames, setJobNames] = useState<string[]>([]);
  const [jobFilter, setJobFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any)
        .from('system_jobs_log')
        .select('job_name')
        .order('ran_at', { ascending: false })
        .limit(500);
      const set = new Set<string>();
      (data || []).forEach((r: any) => set.add(r.job_name));
      setJobNames(Array.from(set).sort());
    })();
  }, []);

  useEffect(() => { fetchLogs(); /* eslint-disable-next-line */ }, [page, jobFilter, statusFilter]);

  const fetchLogs = async () => {
    setLoading(true);
    let q = (supabase as any)
      .from('system_jobs_log')
      .select('id, job_name, status, detail, duration_ms, ran_at', { count: 'exact' })
      .order('ran_at', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (jobFilter !== 'all') q = q.eq('job_name', jobFilter);
    if (statusFilter !== 'all') q = q.eq('status', statusFilter);
    const { data, count } = await q;
    setLogs((data as JobLog[]) || []);
    setTotal(count || 0);
    setLoading(false);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6" /> 系統任務
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            排程任務（股價同步、每日績效、公告清理等）的執行紀錄。
          </p>
        </div>

        <Card>
          <CardContent className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">任務</label>
              <Select value={jobFilter} onValueChange={(v) => { setJobFilter(v); setPage(0); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部任務</SelectItem>
                  {jobNames.map(j => <SelectItem key={j} value={j}>{j}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">狀態</label>
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="success">成功</SelectItem>
                  <SelectItem value="error">失敗</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground whitespace-nowrap">執行時間</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">任務</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">狀態</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground">耗時</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">詳情</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={5} className="p-8 text-center text-muted-foreground text-sm">載入中...</td></tr>
                  ) : logs.length === 0 ? (
                    <tr><td colSpan={5} className="p-8 text-center text-muted-foreground text-sm">尚無系統任務紀錄</td></tr>
                  ) : (
                    logs.map(l => (
                      <tr key={l.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDateTime(l.ran_at)}</td>
                        <td className="p-3 text-sm font-mono text-xs">{l.job_name}</td>
                        <td className="p-3">
                          <Badge variant={l.status === 'success' ? 'outline' : 'destructive'} className="text-[10px]">
                            {l.status}
                          </Badge>
                        </td>
                        <td className="p-3 text-right text-xs text-muted-foreground tabular-nums">
                          {l.duration_ms != null ? `${l.duration_ms} ms` : '—'}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground max-w-md truncate">
                          {l.detail && Object.keys(l.detail).length > 0 ? JSON.stringify(l.detail) : '—'}
                        </td>
                      </tr>
                    ))
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
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>
                <ChevronLeft className="h-4 w-4" /> 上一頁
              </Button>
              <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}>
                下一頁 <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </CompanyLayout>
  );
}
