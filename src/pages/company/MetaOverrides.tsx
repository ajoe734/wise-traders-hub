import { useEffect, useState, Fragment } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { STOCK_META } from '@/checkup/seedData';

type Row = {
  id?: string;
  user_id: string;
  code: string;
  industry: string | null;
  strategy: string | null;
  leader: string | null;
  position: string | null;
  source: string | null;
  updated_at?: string;
};

export default function MetaOverrides() {
  const [rows, setRows] = useState<Row[]>([]);
  const [history, setHistory] = useState<Record<string, Row[]>>({}); // key=user_id|code
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('holding_meta_overrides')
      .select('id, user_id, code, industry, strategy, leader, position, source, updated_at')
      .order('updated_at', { ascending: false })
      .limit(500);
    if (error) toast.error(error.message);
    setRows((data as Row[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const loadHistory = async (userId: string, code: string) => {
    const key = `${userId}|${code}`;
    if (history[key]) return;
    const { data } = await supabase
      .from('holding_meta_override_history')
      .select('*')
      .eq('user_id', userId)
      .eq('code', code)
      .order('recorded_at', { ascending: false })
      .limit(10);
    setHistory((h) => ({ ...h, [key]: (data as any) || [] }));
  };

  const rollbackToHistory = async (cur: Row, hist: any) => {
    if (!confirm(`確定回滾 ${cur.code} 到此版本？`)) return;
    setBusy(cur.code + cur.user_id);
    const { error } = await supabase
      .from('holding_meta_overrides')
      .update({
        industry: hist.industry,
        strategy: hist.strategy,
        leader: hist.leader,
        position: hist.position,
        source: 'rollback',
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', cur.user_id)
      .eq('code', cur.code);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success('已回滾');
    setHistory((h) => { const n = { ...h }; delete n[`${cur.user_id}|${cur.code}`]; return n; });
    load();
  };

  const restoreToStockMeta = async (cur: Row) => {
    if (!confirm(`刪除覆蓋並還原 ${cur.code} 至 STOCK_META 預設？`)) return;
    setBusy(cur.code + cur.user_id);
    // 觸發器會自動 snapshot 一份到 history（action=delete）
    const { error } = await supabase
      .from('holding_meta_overrides')
      .delete()
      .eq('user_id', cur.user_id)
      .eq('code', cur.code);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success('已還原為 STOCK_META');
    load();
  };

  const filtered = rows.filter((r) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return r.code.toLowerCase().includes(q) || r.user_id.toLowerCase().includes(q);
  });

  return (
    <CompanyLayout>
    <div className="container mx-auto py-6 px-4 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-medium mb-1">持倉覆蓋管理</h1>
        <p className="text-sm text-muted-foreground">查看 AI / 手動產業策略覆蓋並回滾到歷史版本或 STOCK_META 預設。</p>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">當前覆蓋（最多 500 筆）</CardTitle>
            <CardDescription>共 {rows.length} 筆</CardDescription>
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="搜尋 code / user_id"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-64"
            />
            <Button variant="outline" size="sm" onClick={load}>重新整理</Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">代碼</TableHead>
                  <TableHead>使用者</TableHead>
                  <TableHead>產業</TableHead>
                  <TableHead>策略</TableHead>
                  <TableHead>領頭</TableHead>
                  <TableHead>定位</TableHead>
                  <TableHead>來源</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => {
                  const key = `${r.user_id}|${r.code}`;
                  const hist = history[key];
                  const seed = STOCK_META[r.code];
                  return (
                    <Fragment key={key}>
                      <TableRow>
                        <TableCell className="font-mono text-xs">{r.code}</TableCell>
                        <TableCell className="font-mono text-[10px] text-muted-foreground">{r.user_id.slice(0, 8)}…</TableCell>
                        <TableCell className="text-xs">{r.industry || '—'}</TableCell>
                        <TableCell className="text-xs">{r.strategy || '—'}</TableCell>
                        <TableCell className="text-xs">{r.leader || '—'}</TableCell>
                        <TableCell className="text-xs">{r.position || '—'}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{r.source || '—'}</Badge></TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button size="sm" variant="ghost" onClick={() => loadHistory(r.user_id, r.code)}>
                            歷史
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!seed || busy === r.code + r.user_id}
                            onClick={() => restoreToStockMeta(r)}
                            title={seed ? '刪除覆蓋並還原為 STOCK_META 預設' : '無 STOCK_META 預設'}
                          >
                            <Trash2 className="h-3 w-3 mr-1" />還原預設
                          </Button>
                        </TableCell>
                      </TableRow>
                      {hist && (
                        <TableRow>
                          <TableCell colSpan={8} className="bg-muted/30">
                            <div className="space-y-1">
                              <div className="text-xs font-medium mb-2">歷史版本（{hist.length}）</div>
                              {hist.length === 0 && <div className="text-xs text-muted-foreground">無歷史紀錄</div>}
                              {hist.map((h: any) => (
                                <div key={h.id} className="flex items-center justify-between text-xs gap-2 py-1">
                                  <div className="flex gap-2 flex-wrap">
                                    <Badge variant="secondary" className="text-[10px]">{h.action}</Badge>
                                    <span>產業 {h.industry || '—'} · 策略 {h.strategy || '—'} · 領頭 {h.leader || '—'} · 定位 {h.position || '—'}</span>
                                    <span className="text-muted-foreground">{new Date(h.recorded_at).toLocaleString('zh-TW')}</span>
                                  </div>
                                  <Button size="sm" variant="ghost" onClick={() => rollbackToHistory(r, h)}>
                                    <RotateCcw className="h-3 w-3 mr-1" />回滾
                                  </Button>
                                </div>
                              ))}
                              {seed && (
                                <div className="flex items-center justify-between text-xs gap-2 py-1 border-t pt-2 mt-1">
                                  <div className="flex gap-2 flex-wrap">
                                    <Badge variant="outline" className="text-[10px]">STOCK_META</Badge>
                                    <span>產業 {seed.industry || '—'} · 策略 {seed.strategy || '—'} · 領頭 {seed.leader || '—'} · 定位 {seed.position || '—'}</span>
                                  </div>
                                  <Button size="sm" variant="ghost" onClick={() => restoreToStockMeta(r)}>
                                    <RotateCcw className="h-3 w-3 mr-1" />還原預設
                                  </Button>
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-sm">無資料</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
    </CompanyLayout>
  );
}
