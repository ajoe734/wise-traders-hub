import { useEffect, useState } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { Switch } from '@/components/ui/switch';

interface Channel {
  id: string;
  source: string;
  display_name: string;
  pct_platform: number | null;
  pct_expert: number | null;
  pct_channel: number | null;
  is_active: boolean;
  notes: string | null;
}

const blank = (): Partial<Channel> => ({
  source: '', display_name: '',
  pct_platform: 35, pct_expert: 45, pct_channel: 20,
  is_active: true, notes: '',
});

export default function CompanyReferralChannels() {
  const [list, setList] = useState<Channel[]>([]);
  const [draft, setDraft] = useState<Partial<Channel>>(blank());
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('referral_channels').select('*').order('created_at', { ascending: false });
    setList((data || []) as Channel[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const validate = (c: Partial<Channel>) => {
    if (!c.source?.trim() || !c.display_name?.trim()) return '請填 source 與顯示名稱';
    const t = (c.pct_platform || 0) + (c.pct_expert || 0) + (c.pct_channel || 0);
    if (t !== 100) return `分潤總和需為 100%（目前 ${t}%）`;
    return null;
  };

  const create = async () => {
    const err = validate(draft);
    if (err) { toast({ title: err, variant: 'destructive' }); return; }
    const { error } = await supabase.from('referral_channels').insert(draft as any);
    if (error) toast({ title: '新增失敗', description: error.message, variant: 'destructive' });
    else { setDraft(blank()); load(); toast({ title: '已新增' }); }
  };

  const save = async (c: Channel) => {
    const err = validate(c);
    if (err) { toast({ title: err, variant: 'destructive' }); return; }
    const { error } = await supabase.from('referral_channels').update({
      display_name: c.display_name, pct_platform: c.pct_platform,
      pct_expert: c.pct_expert, pct_channel: c.pct_channel,
      is_active: c.is_active, notes: c.notes,
      updated_at: new Date().toISOString(),
    }).eq('id', c.id);
    if (error) toast({ title: '儲存失敗', description: error.message, variant: 'destructive' });
    else { load(); toast({ title: '已儲存' }); }
  };

  const remove = async (id: string) => {
    if (!confirm('確認刪除？')) return;
    const { error } = await supabase.from('referral_channels').delete().eq('id', id);
    if (error) toast({ title: '刪除失敗', description: error.message, variant: 'destructive' });
    else load();
  };

  return (
    <CompanyLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-5">
        <h1 className="text-2xl font-semibold">通路分潤管理</h1>

        <Card className="p-5 space-y-3">
          <h2 className="font-semibold">新增通路</h2>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>utm_source（鍵）</Label>
              <Input value={draft.source || ''} onChange={e => setDraft(p => ({ ...p, source: e.target.value }))} placeholder="例：facebook_ads" /></div>
            <div><Label>顯示名稱</Label>
              <Input value={draft.display_name || ''} onChange={e => setDraft(p => ({ ...p, display_name: e.target.value }))} /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label className="text-xs">平台 %</Label><Input type="number" value={draft.pct_platform ?? 0} onChange={e => setDraft(p => ({ ...p, pct_platform: Number(e.target.value) }))} /></div>
            <div><Label className="text-xs">專家 %</Label><Input type="number" value={draft.pct_expert ?? 0} onChange={e => setDraft(p => ({ ...p, pct_expert: Number(e.target.value) }))} /></div>
            <div><Label className="text-xs">通路 %</Label><Input type="number" value={draft.pct_channel ?? 0} onChange={e => setDraft(p => ({ ...p, pct_channel: Number(e.target.value) }))} /></div>
          </div>
          <div><Label>備註</Label><Input value={draft.notes || ''} onChange={e => setDraft(p => ({ ...p, notes: e.target.value }))} /></div>
          <Button onClick={create}>新增通路</Button>
        </Card>

        <div className="space-y-3">
          <h2 className="font-semibold">已設定通路</h2>
          {loading ? '載入中…' : list.length === 0 ? <Card className="p-6 text-muted-foreground text-center">尚無通路</Card> :
            list.map((c) => (
              <Card key={c.id} className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono">{c.source}</Badge>
                    <Input className="w-48" value={c.display_name} onChange={e => setList(l => l.map(x => x.id === c.id ? { ...x, display_name: e.target.value } : x))} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">啟用</Label>
                    <Switch checked={c.is_active} onCheckedChange={v => setList(l => l.map(x => x.id === c.id ? { ...x, is_active: v } : x))} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div><Label className="text-xs">平台 %</Label><Input type="number" value={c.pct_platform ?? 0}
                    onChange={e => setList(l => l.map(x => x.id === c.id ? { ...x, pct_platform: Number(e.target.value) } : x))} /></div>
                  <div><Label className="text-xs">專家 %</Label><Input type="number" value={c.pct_expert ?? 0}
                    onChange={e => setList(l => l.map(x => x.id === c.id ? { ...x, pct_expert: Number(e.target.value) } : x))} /></div>
                  <div><Label className="text-xs">通路 %</Label><Input type="number" value={c.pct_channel ?? 0}
                    onChange={e => setList(l => l.map(x => x.id === c.id ? { ...x, pct_channel: Number(e.target.value) } : x))} /></div>
                </div>
                <div><Label className="text-xs">備註</Label><Input value={c.notes || ''}
                  onChange={e => setList(l => l.map(x => x.id === c.id ? { ...x, notes: e.target.value } : x))} /></div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => save(c)}>儲存</Button>
                  <Button size="sm" variant="destructive" onClick={() => remove(c.id)}>刪除</Button>
                </div>
              </Card>
            ))}
        </div>
      </div>
    </CompanyLayout>
  );
}
