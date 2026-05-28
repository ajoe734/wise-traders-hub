import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const fmtMoney = (n: number) => `NT$${(n || 0).toLocaleString()}`;
const fmtNum = (n: number) => (n || 0).toLocaleString();

function getRange(preset: string): { from: Date; to: Date } {
  const now = new Date();
  if (preset === 'this_month') return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
  if (preset === 'last_month') return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59) };
  if (preset === 'last_3m') return { from: new Date(now.getFullYear(), now.getMonth() - 2, 1), to: now };
  if (preset === 'last_30d') return { from: new Date(now.getTime() - 30 * 86400000), to: now };
  return { from: new Date(now.getTime() - 7 * 86400000), to: now };
}

interface Overview {
  kpi: { visitors: number; returning_visitors: number; page_views: number; signups: number; orders: number; gross: number; platform: number };
  daily: Array<{ day: string; visitors: number; page_views: number; orders: number; gross: number }>;
  channels: Array<{ channel: string; visitors: number; orders: number; gross: number }>;
  campaigns: Array<{ campaign: string; source: string; medium: string; visitors: number; signups: number; orders: number; gross: number }>;
  referrers: Array<{ host: string; visitors: number }>;
  landings: Array<{ path: string; visitors: number }>;
}

interface AdSpendRow { id: string; utm_campaign: string; yyyymm: string; spend_amount: number; utm_source: string | null; utm_medium: string | null; note: string | null }

export default function CompanyTraffic() {
  const [preset, setPreset] = useState('this_month');
  const range = useMemo(() => getRange(preset), [preset]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['traffic-overview', preset],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_traffic_overview', {
        _from: range.from.toISOString(),
        _to: range.to.toISOString(),
      });
      if (error) throw error;
      return data as unknown as Overview;
    },
  });

  const { data: adSpend, refetch: refetchSpend } = useQuery({
    queryKey: ['ad-spend'],
    queryFn: async () => {
      const { data, error } = await supabase.from('ad_spend').select('*').order('yyyymm', { ascending: false });
      if (error) throw error;
      return (data || []) as AdSpendRow[];
    },
  });

  const [newSpend, setNewSpend] = useState({ utm_campaign: '', yyyymm: new Date().toISOString().slice(0, 7), spend_amount: 0, utm_source: '', utm_medium: '' });

  async function saveSpend() {
    if (!newSpend.utm_campaign || !newSpend.yyyymm) { toast.error('campaign 與月份必填'); return; }
    const { error } = await supabase.from('ad_spend').upsert(
      { ...newSpend, utm_source: newSpend.utm_source || null, utm_medium: newSpend.utm_medium || null, spend_amount: Number(newSpend.spend_amount) || 0 },
      { onConflict: 'utm_campaign,yyyymm' }
    );
    if (error) { toast.error(error.message); return; }
    toast.success('已儲存');
    refetchSpend();
  }

  async function deleteSpend(id: string) {
    if (!confirm('刪除這筆廣告花費？')) return;
    const { error } = await supabase.from('ad_spend').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    refetchSpend();
  }

  const kpi = data?.kpi;

  return (
    <CompanyLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold">流量監控</h1>
            <p className="text-sm text-muted-foreground">流量來源、廣告活動、轉換營收一次看</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={preset} onValueChange={setPreset}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="last_7d">近 7 天</SelectItem>
                <SelectItem value="last_30d">近 30 天</SelectItem>
                <SelectItem value="this_month">本月</SelectItem>
                <SelectItem value="last_month">上月</SelectItem>
                <SelectItem value="last_3m">近 3 月</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => refetch()}>重新整理</Button>
          </div>
        </div>

        {isLoading && <Card><CardContent className="p-6 text-sm text-muted-foreground">載入中…</CardContent></Card>}

        {kpi && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="獨立訪客" value={fmtNum(kpi.visitors)} />
            <Kpi label="瀏覽數" value={fmtNum(kpi.page_views)} />
            <Kpi label="註冊數" value={fmtNum(kpi.signups)} />
            <Kpi label="訂單數" value={fmtNum(kpi.orders)} />
            <Kpi label="毛收" value={fmtMoney(kpi.gross)} />
            <Kpi label="平台分潤" value={fmtMoney(kpi.platform)} />
            <Kpi label="CVR" value={kpi.visitors > 0 ? `${((kpi.orders / kpi.visitors) * 100).toFixed(2)}%` : '—'} />
            <Kpi label="ARPU" value={kpi.orders > 0 ? fmtMoney(Math.round(kpi.gross / kpi.orders)) : '—'} />
          </div>
        )}

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">總覽</TabsTrigger>
            <TabsTrigger value="sources">流量來源</TabsTrigger>
            <TabsTrigger value="campaigns">廣告與轉換營收</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <Card>
              <CardHeader><CardTitle className="text-base">每日流量與營收</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>日期</TableHead>
                      <TableHead className="text-right">訪客</TableHead>
                      <TableHead className="text-right">瀏覽</TableHead>
                      <TableHead className="text-right">訂單</TableHead>
                      <TableHead className="text-right">毛收</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.daily || []).map((d) => (
                      <TableRow key={d.day}>
                        <TableCell>{d.day}</TableCell>
                        <TableCell className="text-right">{fmtNum(d.visitors)}</TableCell>
                        <TableCell className="text-right">{fmtNum(d.page_views)}</TableCell>
                        <TableCell className="text-right">{fmtNum(d.orders)}</TableCell>
                        <TableCell className="text-right">{fmtMoney(d.gross)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sources" className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Channel 分布</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>Channel</TableHead><TableHead className="text-right">訪客</TableHead><TableHead className="text-right">訂單</TableHead><TableHead className="text-right">毛收</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(data?.channels || []).map((c) => (
                      <TableRow key={c.channel}>
                        <TableCell className="font-medium">{c.channel}</TableCell>
                        <TableCell className="text-right">{fmtNum(c.visitors)}</TableCell>
                        <TableCell className="text-right">{fmtNum(c.orders)}</TableCell>
                        <TableCell className="text-right">{fmtMoney(c.gross)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-base">Top Referrers</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader><TableRow><TableHead>Host</TableHead><TableHead className="text-right">訪客</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {(data?.referrers || []).map((r) => (
                        <TableRow key={r.host}><TableCell className="font-mono text-xs">{r.host}</TableCell><TableCell className="text-right">{fmtNum(r.visitors)}</TableCell></TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Top Landing Pages</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader><TableRow><TableHead>路徑</TableHead><TableHead className="text-right">訪客</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {(data?.landings || []).map((l) => (
                        <TableRow key={l.path}><TableCell className="font-mono text-xs">{l.path}</TableCell><TableCell className="text-right">{fmtNum(l.visitors)}</TableCell></TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="campaigns" className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Campaign 轉換營收</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campaign</TableHead>
                      <TableHead>Source / Medium</TableHead>
                      <TableHead className="text-right">訪客</TableHead>
                      <TableHead className="text-right">註冊</TableHead>
                      <TableHead className="text-right">訂單</TableHead>
                      <TableHead className="text-right">毛收</TableHead>
                      <TableHead className="text-right">CVR</TableHead>
                      <TableHead className="text-right">ROAS</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.campaigns || []).map((c) => {
                      const spend = (adSpend || []).filter(s => s.utm_campaign === c.campaign).reduce((a, b) => a + (b.spend_amount || 0), 0);
                      const cvr = c.visitors > 0 ? ((c.orders / c.visitors) * 100).toFixed(2) + '%' : '—';
                      const roas = spend > 0 ? (c.gross / spend).toFixed(2) + 'x' : '—';
                      return (
                        <TableRow key={`${c.campaign}-${c.source}-${c.medium}`}>
                          <TableCell className="font-medium">{c.campaign}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{c.source} / {c.medium}</TableCell>
                          <TableCell className="text-right">{fmtNum(c.visitors)}</TableCell>
                          <TableCell className="text-right">{fmtNum(c.signups)}</TableCell>
                          <TableCell className="text-right">{fmtNum(c.orders)}</TableCell>
                          <TableCell className="text-right">{fmtMoney(c.gross)}</TableCell>
                          <TableCell className="text-right">{cvr}</TableCell>
                          <TableCell className="text-right">{roas}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">廣告花費（手動輸入，計算 ROAS / CAC）</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                  <Input placeholder="utm_campaign" value={newSpend.utm_campaign} onChange={(e) => setNewSpend(s => ({ ...s, utm_campaign: e.target.value }))} />
                  <Input placeholder="月份 YYYY-MM" value={newSpend.yyyymm} onChange={(e) => setNewSpend(s => ({ ...s, yyyymm: e.target.value }))} />
                  <Input placeholder="utm_source" value={newSpend.utm_source} onChange={(e) => setNewSpend(s => ({ ...s, utm_source: e.target.value }))} />
                  <Input placeholder="utm_medium" value={newSpend.utm_medium} onChange={(e) => setNewSpend(s => ({ ...s, utm_medium: e.target.value }))} />
                  <Input type="number" placeholder="花費 NT$" value={newSpend.spend_amount} onChange={(e) => setNewSpend(s => ({ ...s, spend_amount: Number(e.target.value) }))} />
                  <Button onClick={saveSpend}>儲存 / 覆蓋</Button>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>月份</TableHead><TableHead>Campaign</TableHead><TableHead>Source/Medium</TableHead>
                      <TableHead className="text-right">花費</TableHead><TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(adSpend || []).map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>{s.yyyymm}</TableCell>
                        <TableCell>{s.utm_campaign}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{s.utm_source || '—'} / {s.utm_medium || '—'}</TableCell>
                        <TableCell className="text-right">{fmtMoney(s.spend_amount)}</TableCell>
                        <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => deleteSpend(s.id)}>刪除</Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </CompanyLayout>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card><CardContent className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </CardContent></Card>
  );
}
