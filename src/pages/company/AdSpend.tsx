import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { SEO } from '@/components/SEO';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Trash2, Upload, Plus } from 'lucide-react';

// P3: 廣告花費自助匯入與管理（餵 ROAS/LTV）

type Row = {
  id: string;
  yyyymm: string;
  utm_campaign: string;
  utm_source: string | null;
  utm_medium: string | null;
  spend_amount: number;
  note: string | null;
};

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
};

function parseCsv(text: string): Array<Partial<Row>> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const header = lines[0].split(',').map((s) => s.trim().toLowerCase());
  const idx = (k: string) => header.indexOf(k);
  const i = {
    yyyymm: idx('yyyymm'),
    campaign: idx('utm_campaign'),
    source: idx('utm_source'),
    medium: idx('utm_medium'),
    amount: idx('spend_amount'),
    note: idx('note'),
  };
  return lines.slice(1).map((ln) => {
    const cols = ln.split(',').map((s) => s.trim());
    return {
      yyyymm: cols[i.yyyymm] || thisMonth(),
      utm_campaign: cols[i.campaign] || '',
      utm_source: cols[i.source] || null,
      utm_medium: cols[i.medium] || null,
      spend_amount: Number(cols[i.amount] || 0),
      note: cols[i.note] || null,
    };
  }).filter((r) => r.utm_campaign && r.spend_amount > 0);
}

export default function AdSpend() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<Partial<Row>>({ yyyymm: thisMonth(), spend_amount: 0 });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['ad-spend'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ad_spend')
        .select('*')
        .order('yyyymm', { ascending: false })
        .order('utm_campaign');
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const addOne = useMutation({
    mutationFn: async (r: Partial<Row>) => {
      const { error } = await supabase.from('ad_spend').insert({
        yyyymm: r.yyyymm!,
        utm_campaign: r.utm_campaign!,
        utm_source: r.utm_source || null,
        utm_medium: r.utm_medium || null,
        spend_amount: Number(r.spend_amount || 0),
        note: r.note || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ad-spend'] });
      setForm({ yyyymm: thisMonth(), spend_amount: 0 });
      toast({ title: '已新增' });
    },
    onError: (e: unknown) => toast({ title: '新增失敗', description: (e as Error).message, variant: 'destructive' }),
  });

  const bulkImport = useMutation({
    mutationFn: async (rs: Array<Partial<Row>>) => {
      if (!rs.length) throw new Error('CSV 沒有有效資料');
      const payload = rs.map((r) => ({
        yyyymm: r.yyyymm!,
        utm_campaign: r.utm_campaign!,
        utm_source: r.utm_source || null,
        utm_medium: r.utm_medium || null,
        spend_amount: Number(r.spend_amount || 0),
        note: r.note || null,
      }));
      const { error } = await supabase.from('ad_spend').insert(payload);
      if (error) throw error;
      return payload.length;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ['ad-spend'] });
      toast({ title: `已匯入 ${n} 筆` });
    },
    onError: (e: unknown) => toast({ title: '匯入失敗', description: (e as Error).message, variant: 'destructive' }),
  });

  const removeOne = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('ad_spend').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ad-spend'] }),
  });

  const onCsv = async (file: File) => {
    const text = await file.text();
    bulkImport.mutate(parseCsv(text));
  };

  return (
    <CompanyLayout>
      <SEO title="廣告花費｜後台" description="廣告花費自助匯入與管理。" />
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">廣告花費</h1>
          <p className="text-sm text-foreground/60 mt-1">餵入 ROAS / LTV 報表。可逐筆新增或上傳 CSV。</p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">新增單筆</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">月份 (YYYYMM)</Label>
                <Input value={form.yyyymm || ''} onChange={(e) => setForm({ ...form, yyyymm: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">utm_campaign *</Label>
                <Input value={form.utm_campaign || ''} onChange={(e) => setForm({ ...form, utm_campaign: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">utm_source</Label>
                <Input value={form.utm_source || ''} onChange={(e) => setForm({ ...form, utm_source: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">utm_medium</Label>
                <Input value={form.utm_medium || ''} onChange={(e) => setForm({ ...form, utm_medium: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">花費 (TWD)</Label>
                <Input type="number" value={form.spend_amount ?? 0} onChange={(e) => setForm({ ...form, spend_amount: Number(e.target.value) })} />
              </div>
              <div className="space-y-1 col-span-2 md:col-span-6">
                <Label className="text-xs">備註</Label>
                <Textarea rows={2} value={form.note || ''} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" onClick={() => addOne.mutate(form)} disabled={!form.utm_campaign || !form.spend_amount}>
                <Plus className="w-3.5 h-3.5 mr-1" /> 新增
              </Button>
              <label className="inline-flex">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onCsv(f);
                    e.currentTarget.value = '';
                  }}
                />
                <span className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm cursor-pointer hover:bg-muted">
                  <Upload className="w-3.5 h-3.5" /> 上傳 CSV
                </span>
              </label>
              <span className="text-xs text-foreground/55">
                CSV 欄位：yyyymm, utm_campaign, utm_source, utm_medium, spend_amount, note
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">已記錄（{rows.length}）</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {isLoading ? (
              <p className="text-sm text-foreground/50">載入中…</p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-foreground/50">尚無紀錄。</p>
            ) : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead className="text-left text-xs text-foreground/55 border-b">
                  <tr>
                    <th className="py-2 pr-3">月份</th>
                    <th className="py-2 pr-3">Campaign</th>
                    <th className="py-2 pr-3">Source</th>
                    <th className="py-2 pr-3">Medium</th>
                    <th className="py-2 pr-3 text-right">花費 (TWD)</th>
                    <th className="py-2 pr-3">備註</th>
                    <th className="py-2 pr-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-2 pr-3 tabular-nums">{r.yyyymm}</td>
                      <td className="py-2 pr-3">{r.utm_campaign}</td>
                      <td className="py-2 pr-3">{r.utm_source ?? '—'}</td>
                      <td className="py-2 pr-3">{r.utm_medium ?? '—'}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{Math.round(r.spend_amount).toLocaleString()}</td>
                      <td className="py-2 pr-3 text-xs text-foreground/60 truncate max-w-[280px]">{r.note ?? '—'}</td>
                      <td className="py-2 pr-3 text-right">
                        <Button variant="ghost" size="sm" onClick={() => removeOne.mutate(r.id)} aria-label="刪除">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </CardContent>
        </Card>
      </div>
    </CompanyLayout>
  );
}
