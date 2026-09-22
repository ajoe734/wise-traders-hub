import { SEO } from '@/components/SEO';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Check, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

type Row = {
  symbol: string;
  name: string | null;
  market: string | null;
  official_industry: string | null;
  industries: string[] | null;
  themes: string[] | null;
  confidence: number | null;
  rationale: string | null;
  reviewed: boolean | null;
  source: string | null;
  updated_at: string | null;
};

type Mode = 'low' | 'unreviewed' | 'all';

const MODE_LABEL: Record<Mode, string> = {
  low: '低信心（< 0.7）',
  unreviewed: '尚未人工確認',
  all: '全部',
};

export default function StockIndustryReview() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>('low');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const { data: rows = [], isLoading, refetch } = useQuery<Row[]>({
    queryKey: ['company', 'stock-industry-map', mode],
    staleTime: 30_000,
    queryFn: async () => {
      let q = supabase
        .from('stock_industry_map')
        .select('symbol, name, market, official_industry, industries, themes, confidence, rationale, reviewed, source, updated_at')
        .order('confidence', { ascending: true })
        .limit(500);
      if (mode === 'low') q = q.lt('confidence', 0.7);
      if (mode === 'unreviewed') q = q.eq('reviewed', false);
      const { data, error } = await q;
      if (error) { toast.error(error.message); throw error; }
      return (data as Row[]) || [];
    },
  });

  const { data: counts } = useQuery({
    queryKey: ['company', 'stock-industry-map', 'counts'],
    staleTime: 60_000,
    queryFn: async () => {
      const total = await supabase.from('stock_industry_map').select('symbol', { count: 'exact', head: true });
      const low = await supabase.from('stock_industry_map').select('symbol', { count: 'exact', head: true }).lt('confidence', 0.7);
      const reviewed = await supabase.from('stock_industry_map').select('symbol', { count: 'exact', head: true }).eq('reviewed', true);
      return { total: total.count ?? 0, low: low.count ?? 0, reviewed: reviewed.count ?? 0 };
    },
  });

  const visible = useMemo(() => {
    const kw = filter.trim().toLowerCase();
    if (!kw) return rows;
    return rows.filter((r) =>
      [r.symbol, r.name, r.official_industry, ...(r.industries || []), ...(r.themes || [])]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(kw)),
    );
  }, [rows, filter]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['company', 'stock-industry-map'] });

  const save = async (row: Row, opts: { industries?: string[] | null } = {}) => {
    setBusy(row.symbol);
    const { error } = await supabase.rpc('admin_update_stock_industry', {
      _symbol: row.symbol,
      _industries: opts.industries ?? null,
      _themes: null,
      _reviewed: true,
    });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`${row.symbol} 已確認`);
    setDraft((d) => { const n = { ...d }; delete n[row.symbol]; return n; });
    invalidate();
  };

  return (
    <CompanyLayout>
      <SEO title="個股分類審核 | legendflow" description="全市場個股細分產業與題材的後台審核頁" noindex />
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>個股分類審核</CardTitle>
              <CardDescription>
                全市場細分產業與題材。低信心或明顯判錯的可直接改，改完標記為已確認，之後重跑分類不會覆蓋。
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" />重新整理
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm text-muted-foreground">
              已分類 {counts?.total ?? '—'} 檔 · 低信心 {counts?.low ?? '—'} 檔 · 已人工確認 {counts?.reviewed ?? '—'} 檔
            </div>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
                <Button key={m} size="sm" variant={mode === m ? 'default' : 'outline'} onClick={() => setMode(m)}>
                  {MODE_LABEL[m]}
                </Button>
              ))}
              <Input
                className="w-64"
                placeholder="搜尋代號／名稱／族群／題材"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>

            {isLoading ? (
              <div className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>代號</TableHead>
                      <TableHead>名稱</TableHead>
                      <TableHead>官方大類</TableHead>
                      <TableHead>細分產業</TableHead>
                      <TableHead>題材</TableHead>
                      <TableHead>信心</TableHead>
                      <TableHead>狀態</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((r) => {
                      const current = (r.industries || []).join('、');
                      const value = draft[r.symbol] ?? current;
                      const dirty = value.trim() !== current;
                      return (
                        <TableRow key={r.symbol}>
                          <TableCell className="font-mono">{r.symbol}</TableCell>
                          <TableCell>{r.name || '—'}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">{r.official_industry || '—'}</TableCell>
                          <TableCell className="min-w-[220px]">
                            <Input
                              value={value}
                              onChange={(e) => setDraft((d) => ({ ...d, [r.symbol]: e.target.value }))}
                              placeholder="以、分隔"
                            />
                          </TableCell>
                          <TableCell className="text-sm">{(r.themes || []).join('、') || '—'}</TableCell>
                          <TableCell className="text-sm">{r.confidence == null ? '—' : r.confidence.toFixed(2)}</TableCell>
                          <TableCell>
                            <Badge variant={r.reviewed ? 'default' : 'outline'}>
                              {r.reviewed ? '已確認' : '待確認'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant={dirty ? 'default' : 'outline'}
                              disabled={busy === r.symbol}
                              onClick={() =>
                                save(r, {
                                  industries: dirty
                                    ? value.split(/[、,，]/).map((s) => s.trim()).filter(Boolean)
                                    : null,
                                })
                              }
                            >
                              {busy === r.symbol ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                              {dirty ? '儲存並確認' : '標記已確認'}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {visible.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                          沒有符合條件的個股
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </CompanyLayout>
  );
}
