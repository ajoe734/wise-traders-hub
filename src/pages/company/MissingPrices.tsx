import { useEffect, useMemo, useState } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { RefreshCw, Search, AlertTriangle, Download } from 'lucide-react';
import { toast } from 'sonner';

interface MissRow {
  id: string;
  user_id: string | null;
  symbol: string;
  reason: string;
  attempts: number;
  last_error: string | null;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  user_email?: string | null;
}

const reasonLabel: Record<string, string> = {
  invalid_format: '格式不符（非台股代號）',
  not_found: 'TWSE/TPEx 查無代碼',
  no_price: '無有效報價',
};

const fmt = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};

export default function MissingPricesPage() {
  const [rows, setRows] = useState<MissRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [filter, setFilter] = useState<'unresolved' | 'resolved' | 'all'>('unresolved');
  const [reasonFilter, setReasonFilter] = useState<string>('all');
  const [retrying, setRetrying] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('checkup_price_misses')
      .select('*')
      .order('last_seen_at', { ascending: false })
      .limit(1000);
    if (err) {
      setError(err.message);
      setRows([]);
      setLoading(false);
      return;
    }
    // Look up emails via profiles + auth (best-effort: profiles has display_name only;
    // we read auth.users via admin RPC if available). Fall back to user_id.
    const userIds = Array.from(new Set((data || []).map((r: any) => r.user_id).filter(Boolean)));
    const emailMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('user_id, display_name')
        .in('user_id', userIds);
      (profs || []).forEach((p: any) => { emailMap[p.user_id] = p.display_name || ''; });
    }
    setRows((data || []).map((r: any) => ({ ...r, user_email: emailMap[r.user_id] || null })));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (filter === 'unresolved' && r.resolved_at) return false;
      if (filter === 'resolved' && !r.resolved_at) return false;
      if (reasonFilter !== 'all' && r.reason !== reasonFilter) return false;
      if (keyword) {
        const k = keyword.toLowerCase();
        const hay = `${r.symbol} ${r.user_email || ''} ${r.user_id || ''}`.toLowerCase();
        if (!hay.includes(k)) return false;
      }
      return true;
    });
  }, [rows, filter, reasonFilter, keyword]);

  const retry = async (row: MissRow) => {
    setRetrying(row.id);
    try {
      const { data, error: err } = await supabase.functions.invoke('stock-price-sync', {
        body: { symbols: [row.symbol], force: true },
      });
      if (err) throw err;
      const stillMissing = (data?.missing || []).includes(row.symbol);
      toast(stillMissing ? `${row.symbol} 仍無法補抓：${data?.reasons?.[row.symbol] || 'unknown'}` : `${row.symbol} 補抓成功`);
      await load();
    } catch (e: any) {
      toast(`重試失敗：${e?.message || '未知錯誤'}`);
    } finally {
      setRetrying(null);
    }
  };

  const exportCsv = () => {
    const header = '用戶,代碼,原因,嘗試次數,首次發生,最近發生,解決時間,最後錯誤';
    const lines = filtered.map(r => [
      r.user_email || r.user_id || '—',
      r.symbol,
      reasonLabel[r.reason] || r.reason,
      r.attempts,
      fmt(r.first_seen_at),
      fmt(r.last_seen_at),
      r.resolved_at ? fmt(r.resolved_at) : '',
      r.last_error || '',
    ].map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(','));
    const csv = '\uFEFF' + [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `missing-prices-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <CompanyLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">缺價總覽</h1>
            <p className="text-sm text-muted-foreground">用戶觸發補抓但仍失敗的代碼清單，協助客服處理。</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={exportCsv}><Download className="h-4 w-4 mr-1" />匯出 CSV</Button>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />重新整理
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative">
                <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="搜尋代碼 / Email"
                  value={keyword}
                  onChange={e => setKeyword(e.target.value)}
                  className="pl-8 w-64"
                />
              </div>
              <select
                className="h-9 px-3 rounded-md border bg-background text-sm"
                value={filter}
                onChange={e => setFilter(e.target.value as any)}
              >
                <option value="unresolved">未解決</option>
                <option value="resolved">已解決</option>
                <option value="all">全部</option>
              </select>
              <select
                className="h-9 px-3 rounded-md border bg-background text-sm"
                value={reasonFilter}
                onChange={e => setReasonFilter(e.target.value)}
              >
                <option value="all">所有原因</option>
                <option value="invalid_format">格式不符</option>
                <option value="not_found">查無代碼</option>
                <option value="no_price">無有效報價</option>
              </select>
              <span className="text-sm text-muted-foreground ml-auto">{filtered.length} 筆</span>
            </div>
          </CardContent>
        </Card>

        {error && (
          <Card className="border-destructive">
            <CardContent className="pt-6 flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" /> {error}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">失敗紀錄</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 px-2">用戶</th>
                    <th className="text-left py-2 px-2">代碼</th>
                    <th className="text-left py-2 px-2">原因</th>
                    <th className="text-left py-2 px-2">次數</th>
                    <th className="text-left py-2 px-2">首次</th>
                    <th className="text-left py-2 px-2">最近</th>
                    <th className="text-left py-2 px-2">狀態</th>
                    <th className="text-left py-2 px-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => (
                    <tr key={r.id} className="border-b hover:bg-muted/30">
                      <td className="py-2 px-2 text-xs text-muted-foreground">{r.user_email || (r.user_id ? r.user_id.slice(0,8) : '—')}</td>
                      <td className="py-2 px-2 font-mono">{r.symbol}</td>
                      <td className="py-2 px-2">{reasonLabel[r.reason] || r.reason}</td>
                      <td className="py-2 px-2">{r.attempts}</td>
                      <td className="py-2 px-2 text-xs text-muted-foreground">{fmt(r.first_seen_at)}</td>
                      <td className="py-2 px-2 text-xs text-muted-foreground">{fmt(r.last_seen_at)}</td>
                      <td className="py-2 px-2">
                        {r.resolved_at
                          ? <Badge variant="secondary">已解決</Badge>
                          : <Badge variant="destructive">未解決</Badge>}
                      </td>
                      <td className="py-2 px-2">
                        <Button size="sm" variant="outline" disabled={retrying === r.id} onClick={() => retry(r)}>
                          {retrying === r.id ? '重試中…' : '重試補抓'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && !loading && (
                    <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">無資料</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </CompanyLayout>
  );
}
