import { useEffect, useState } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';

interface Setting { key: string; value: any; }

const KEYS = [
  { key: 'split_standard', label: '標準分潤（無導流）', fields: ['pct_platform', 'pct_expert', 'pct_channel'] },
  { key: 'split_attributed', label: '被導流分潤（有 utm_source）', fields: ['pct_platform', 'pct_expert', 'pct_channel'] },
  { key: 'split_checkup', label: '健檢分潤（平台獨享）', fields: ['pct_platform', 'pct_expert', 'pct_channel'] },
];

const REMIT_FIELDS = ['bank_name', 'bank_code', 'account_number', 'account_name'];
const CROSS_FIELDS = [
  'has_checkup_basic_discount_on_expert',
  'has_checkup_pro_discount_on_expert',
  'has_expert_discount_on_checkup_basic',
  'has_expert_discount_on_checkup_pro',
];

export default function CompanyPaymentSettings() {
  const [splits, setSplits] = useState<Record<string, any>>({});
  const [remit, setRemit] = useState<Record<string, string>>({});
  const [cross, setCross] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('payment_settings').select('key, value');
    const map: Record<string, any> = {};
    (data || []).forEach((r: Setting) => { map[r.key] = r.value; });
    const s: Record<string, any> = {};
    KEYS.forEach(k => { s[k.key] = map[k.key] || { pct_platform: 0, pct_expert: 0, pct_channel: 0 }; });
    setSplits(s);
    setRemit(map['remittance_account'] || {});
    setCross(map['cross_discounts'] || {});
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const upsert = async (key: string, value: any) => {
    const userId = (await supabase.auth.getUser()).data.user?.id;
    const { error } = await supabase.from('payment_settings')
      .upsert({ key, value, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) { toast({ title: '儲存失敗', description: error.message, variant: 'destructive' }); return false; }
    return true;
  };

  const saveSplit = async (key: string) => {
    const v = splits[key];
    const total = (v.pct_platform || 0) + (v.pct_expert || 0) + (v.pct_channel || 0);
    if (total !== 100) {
      toast({ title: '比例錯誤', description: `總和需為 100%（目前 ${total}%）`, variant: 'destructive' });
      return;
    }
    if (await upsert(key, v)) toast({ title: '已儲存' });
  };

  const saveRemit = async () => { if (await upsert('remittance_account', remit)) toast({ title: '已儲存匯款帳戶' }); };
  const saveCross = async () => { if (await upsert('cross_discounts', cross)) toast({ title: '已儲存跨產品折扣' }); };

  if (loading) return <CompanyLayout><div className="p-6">載入中…</div></CompanyLayout>;

  return (
    <CompanyLayout>
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <h1 className="text-2xl font-semibold">金流設定</h1>

        <Card className="p-5 space-y-4">
          <h2 className="font-semibold">分潤規則</h2>
          {KEYS.map(({ key, label, fields }) => (
            <div key={key} className="border rounded-lg p-4 space-y-3">
              <div className="font-medium text-sm">{label}</div>
              <div className="grid grid-cols-3 gap-3">
                {fields.map(f => (
                  <div key={f}>
                    <Label className="text-xs">{f === 'pct_platform' ? '平台' : f === 'pct_expert' ? '專家' : '通路'}（%）</Label>
                    <Input type="number" min={0} max={100} value={splits[key]?.[f] ?? 0}
                      onChange={e => setSplits(p => ({ ...p, [key]: { ...p[key], [f]: Number(e.target.value) } }))} />
                  </div>
                ))}
              </div>
              <Button size="sm" onClick={() => saveSplit(key)}>儲存</Button>
            </div>
          ))}
        </Card>

        <Card className="p-5 space-y-4">
          <h2 className="font-semibold">跨產品折扣（NT$）</h2>
          <div className="grid grid-cols-2 gap-3">
            {CROSS_FIELDS.map(f => (
              <div key={f}>
                <Label className="text-xs">{f}</Label>
                <Input type="number" min={0} value={cross[f] ?? 0}
                  onChange={e => setCross(p => ({ ...p, [f]: Number(e.target.value) }))} />
              </div>
            ))}
          </div>
          <Button size="sm" onClick={saveCross}>儲存折扣設定</Button>
        </Card>

        <Card className="p-5 space-y-4">
          <h2 className="font-semibold">匯款帳戶（公開）</h2>
          <div className="grid grid-cols-2 gap-3">
            {REMIT_FIELDS.map(f => (
              <div key={f}>
                <Label className="text-xs">{f}</Label>
                <Input value={remit[f] || ''} onChange={e => setRemit(p => ({ ...p, [f]: e.target.value }))} />
              </div>
            ))}
          </div>
          <Button size="sm" onClick={saveRemit}>儲存匯款帳戶</Button>
        </Card>
      </div>
    </CompanyLayout>
  );
}
