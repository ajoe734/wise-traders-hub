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
import { Loader2, Check, RefreshCw, Download } from 'lucide-react';
import { toast } from 'sonner';
import { isAdoptedClassification, INDUSTRIES, chainTierOf } from '@/checkup/lib/industryTaxonomy';
import { validateReview, reviewCsv } from '@/lib/stockIndustryReview';

type Row = {
  symbol: string;
  name: string | null;
  market: string | null;
  official_industry: string | null;
  industries: string[] | null;
  themes: string[] | null;
  market_groups: string[] | null;
  confidence: number | null;
  rationale: string | null;
  evidence: string | null;
  business_desc: string | null;
  chain_tier: string | null;
  reviewed: boolean | null;
  source: string | null;
  updated_at: string | null;
};

type Mode = 'pending' | 'low' | 'unreviewed' | 'all';

const MODE_LABEL: Record<Mode, string> = {
  pending: '待審（未上線）',
  low: '低信心（< 0.7）',
  unreviewed: '尚未人工確認',
  all: '全部',
};

export default function StockIndustryReview() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>('pending');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [groupDraft, setGroupDraft] = useState<Record<string, string>>({});

  const { data: rows = [], isLoading, refetch } = useQuery<Row[]>({
    queryKey: ['company', 'stock-industry-map', mode],
    staleTime: 30_000,
    queryFn: async () => {
      const all: Row[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('stock_industry_map')
          .select('symbol, name, market, official_industry, industries, themes, market_groups, confidence, rationale, evidence, business_desc, chain_tier, reviewed, source, updated_at')
          .order('symbol').range(from, from + 999);
        if (error) { toast.error(error.message); throw error; }
        all.push(...((data as Row[]) || []));
        if (!data || data.length < 1000) break;
      }
      return all.filter((r) => mode === 'all' ||
        (mode === 'pending' && !isAdoptedClassification(r)) ||
        (mode === 'low' && r.confidence != null && r.confidence < 0.7) ||
        (mode === 'unreviewed' && r.reviewed !== true));
    },
  });

  const { data: counts } = useQuery({
    queryKey: ['company', 'stock-industry-map', 'counts'],
    staleTime: 60_000,
    queryFn: async () => {
      const total = await supabase.from('stock_industry_map').select('symbol', { count: 'exact', head: true });
      const low = await supabase.from('stock_industry_map').select('symbol', { count: 'exact', head: true }).lt('confidence', 0.7);
      const reviewed = await supabase.from('stock_industry_map').select('symbol', { count: 'exact', head: true }).eq('reviewed', true);
      const pendingRows: Array<{ reviewed: boolean | null; confidence: number | null; evidence: string | null }> = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('stock_industry_map').select('reviewed, confidence, evidence').order('symbol').range(from, from + 999);
        if (error) throw error;
        pendingRows.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      return { total: total.count ?? 0, low: low.count ?? 0, reviewed: reviewed.count ?? 0, pending: pendingRows.filter((r) => !isAdoptedClassification(r)).length };
    },
  });

  const visible = useMemo(() => {
    const kw = filter.trim().toLowerCase();
    if (!kw) return rows;
    return rows.filter((r) =>
      [r.symbol, r.name, r.official_industry, ...(r.industries || []), ...(r.themes || []), ...(r.market_groups || [])]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(kw)),
    );
  }, [rows, filter]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['company', 'stock-industry-map'] });

  const save = async (
    row: Row,
    opts: { industries?: string[] | null; marketGroups?: string[] | null } = {},
  ) => {
    const invalid = validateReview(opts.industries ?? row.industries ?? [], opts.marketGroups ?? row.market_groups ?? []);
    if (invalid) { toast.error(invalid); return; }
    setBusy(row.symbol);
    const { error } = await (supabase as any).rpc('admin_update_stock_industry', {
      _symbol: row.symbol,
      _industries: opts.industries ?? null,
      _themes: null,
      _market_groups: opts.marketGroups ?? null,
      _reviewed: true,
    });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`${row.symbol} 已確認生效`);
    window.dispatchEvent(new Event('stock-classification-updated'));
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('stock-classification');
      channel.postMessage({ symbol: row.symbol });
      channel.close();
    }
    setDraft((d) => { const n = { ...d }; delete n[row.symbol]; return n; });
    setGroupDraft((d) => { const n = { ...d }; delete n[row.symbol]; return n; });
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
                依公司申報的主要經營業務分類。待審的分類不會上線（前台改用官方大類），確認或修正後才會生效，之後重跑不會覆蓋。
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" />重新整理
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm text-muted-foreground">
              已分類 {counts?.total ?? '—'} 檔 · 待審未上線 {counts?.pending ?? '—'} 檔 · 低信心 {counts?.low ?? '—'} 檔 · 已人工確認 {counts?.reviewed ?? '—'} 檔
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={isLoading} onClick={() => {
                const url = URL.createObjectURL(new Blob([reviewCsv(rows)], { type: 'text/csv;charset=utf-8;' }));
                const a = document.createElement('a'); a.href = url; a.download = `分類覆核-${mode}-${rows.length}檔.csv`; a.click(); URL.revokeObjectURL(url);
              }}><Download className="h-4 w-4 mr-1" />匯出全部 {rows.length} 檔</Button>
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
            <div className="text-sm">目前列出 {visible.length}／{rows.length} 檔</div>
            <datalist id="review-industries">{INDUSTRIES.map((i) => <option key={i} value={i} />)}</datalist>

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
                      <TableHead>主要經營業務／依據</TableHead>
                      <TableHead>細分產業</TableHead>
                      <TableHead>市場族群</TableHead>
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
                      const currentGroups = (r.market_groups || []).join('、');
                      const groupValue = groupDraft[r.symbol] ?? currentGroups;
                      const groupDirty = groupValue.trim() !== currentGroups;
                      const anyDirty = dirty || groupDirty;
                      return (
                        <TableRow key={r.symbol}>
                          <TableCell className="font-mono font-bold">{r.symbol}</TableCell>
                          <TableCell className="font-bold">{r.name || '—'}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">{r.official_industry || '—'}</TableCell>
                          <TableCell className="min-w-[240px] max-w-[320px] text-xs">
                            <div>{r.business_desc || '—'}</div>
                            {r.evidence && <div className="text-muted-foreground mt-1">{r.evidence}</div>}
                          </TableCell>
                          <TableCell className="min-w-[220px]">
                            <div className="text-xs text-muted-foreground mb-1">{value.split(/[、,，]/).map((i) => chainTierOf(i.trim())).filter(Boolean).join('／') || '—'}</div>
                            <Input
                              aria-label={`${r.symbol} 細分產業`}
                              list="review-industries"
                              value={value}
                              onChange={(e) => setDraft((d) => ({ ...d, [r.symbol]: e.target.value }))}
                              placeholder="以、分隔"
                            />
                          </TableCell>
                          <TableCell className="min-w-[180px]">
                            <Input
                              aria-label={`${r.symbol} 市場族群`}
                              value={groupValue}
                              onChange={(e) => setGroupDraft((d) => ({ ...d, [r.symbol]: e.target.value }))}
                              placeholder="以、分隔，如 散熱三雄"
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
                              variant={anyDirty ? 'default' : 'outline'}
                              disabled={busy !== null}
                              onClick={() =>
                                save(r, {
                                  industries: dirty
                                    ? value.split(/[、,，]/).map((s) => s.trim()).filter(Boolean)
                                    : null,
                                  marketGroups: groupDirty
                                    ? groupValue.split(/[、,，]/).map((s) => s.trim()).filter(Boolean)
                                    : null,
                                })
                              }
                            >
                              {busy === r.symbol ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                              {anyDirty ? '儲存並確認' : '標記已確認'}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {visible.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
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
