import { useEffect, useMemo, useState } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { AlertTriangle, RefreshCw, Search } from 'lucide-react';

interface UsageRow {
  user_id: string;
  display_name: string | null;
  email: string | null;
  tier: string;
  period: string;
  used: number;
  quota_limit: number;
  remaining: number;
  usage_pct: number;
  resets_at: string | null;
  is_near_limit: boolean;
  is_exhausted: boolean;
  last_used_at: string | null;
}

const formatDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
};

const tierLabel: Record<string, string> = {
  free: 'Free',
  basic: 'Basic',
  pro: 'Pro',
};

const periodLabel: Record<string, string> = {
  month: '本月',
  week: '本週',
};

export default function CheckupUsagePage() {
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [filter, setFilter] = useState<'all' | 'near' | 'exhausted'>('all');

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error: rpcErr } = await supabase.rpc('admin_checkup_usage_overview');
    if (rpcErr) {
      setError(rpcErr.message);
      setRows([]);
    } else {
      setRows((data || []) as UsageRow[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'near' && !r.is_near_limit) return false;
      if (filter === 'exhausted' && !r.is_exhausted) return false;
      if (!kw) return true;
      return (
        (r.display_name || '').toLowerCase().includes(kw) ||
        (r.email || '').toLowerCase().includes(kw) ||
        r.user_id.toLowerCase().includes(kw)
      );
    });
  }, [rows, keyword, filter]);

  const stats = useMemo(() => {
    const total = rows.length;
    const near = rows.filter((r) => r.is_near_limit && !r.is_exhausted).length;
    const exhausted = rows.filter((r) => r.is_exhausted).length;
    const paid = rows.filter((r) => r.tier === 'basic' || r.tier === 'pro').length;
    return { total, near, exhausted, paid };
  }, [rows]);

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">持倉看板配額總覽</h1>
            <p className="text-sm text-muted-foreground mt-1">
              掌握誰快用完免費配額，主動勸升或關懷
            </p>
          </div>
          <Button onClick={load} variant="outline" size="sm" disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            重新整理
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground font-normal">活躍用戶</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-semibold">{stats.total}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground font-normal">付費方案</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-semibold">{stats.paid}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground font-normal">配額快滿（≥80%）</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-semibold text-amber-600">{stats.near}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground font-normal">已用完</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-semibold text-destructive">{stats.exhausted}</div></CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <CardTitle className="text-base">用戶配額明細</CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="搜尋姓名 / Email"
                    className="pl-8 w-56"
                  />
                </div>
                <div className="flex gap-1">
                  {(['all', 'near', 'exhausted'] as const).map((f) => (
                    <Button
                      key={f}
                      size="sm"
                      variant={filter === f ? 'default' : 'outline'}
                      onClick={() => setFilter(f)}
                    >
                      {f === 'all' ? '全部' : f === 'near' ? '快滿' : '已用完'}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="text-sm text-destructive flex items-center gap-2 mb-4">
                <AlertTriangle className="w-4 h-4" /> {error}
              </div>
            )}
            {loading ? (
              <div className="text-sm text-muted-foreground py-12 text-center">載入中…</div>
            ) : filtered.length === 0 ? (
              <div className="text-sm text-muted-foreground py-12 text-center">沒有符合條件的用戶</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-4 font-normal">用戶</th>
                      <th className="py-2 pr-4 font-normal">方案</th>
                      <th className="py-2 pr-4 font-normal">本期使用</th>
                      <th className="py-2 pr-4 font-normal">使用率</th>
                      <th className="py-2 pr-4 font-normal">重置時間</th>
                      <th className="py-2 pr-4 font-normal">最後使用</th>
                      <th className="py-2 pr-4 font-normal">狀態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr key={r.user_id} className="border-b hover:bg-muted/30">
                        <td className="py-3 pr-4">
                          <div className="font-medium">{r.display_name || '—'}</div>
                          <div className="text-xs text-muted-foreground">{r.email || r.user_id.slice(0, 8)}</div>
                        </td>
                        <td className="py-3 pr-4">
                          <Badge variant={r.tier === 'pro' ? 'default' : r.tier === 'basic' ? 'secondary' : 'outline'}>
                            {tierLabel[r.tier] || r.tier}
                          </Badge>
                        </td>
                        <td className="py-3 pr-4 font-mono">
                          {r.used} / {r.quota_limit} {periodLabel[r.period] || ''}
                        </td>
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-2">
                            <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div
                                className={`h-full ${r.is_exhausted ? 'bg-destructive' : r.is_near_limit ? 'bg-amber-500' : 'bg-primary'}`}
                                style={{ width: `${Math.min(r.usage_pct, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground tabular-nums">{r.usage_pct}%</span>
                          </div>
                        </td>
                        <td className="py-3 pr-4 text-xs text-muted-foreground">{formatDate(r.resets_at)}</td>
                        <td className="py-3 pr-4 text-xs text-muted-foreground">{formatDate(r.last_used_at)}</td>
                        <td className="py-3 pr-4">
                          {r.is_exhausted ? (
                            <Badge variant="destructive">已用完</Badge>
                          ) : r.is_near_limit ? (
                            <Badge className="bg-amber-500 hover:bg-amber-600">快滿</Badge>
                          ) : (
                            <Badge variant="outline">正常</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </CompanyLayout>
  );
}
