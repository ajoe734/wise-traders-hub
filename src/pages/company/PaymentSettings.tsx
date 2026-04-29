import { useEffect, useState } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { Link } from 'react-router-dom';

interface Setting { key: string; value: any; }

const REMIT_FIELDS: { key: string; label: string }[] = [
  { key: 'bank_name', label: '銀行名稱' },
  { key: 'bank_code', label: '銀行代碼' },
  { key: 'account_number', label: '帳號' },
  { key: 'account_name', label: '戶名' },
];

const CROSS_FIELDS: { key: string; label: string }[] = [
  { key: 'has_checkup_basic_discount_on_expert', label: '已訂健檢 Basic → 訂閱方案折扣' },
  { key: 'has_checkup_pro_discount_on_expert', label: '已訂健檢 Pro → 訂閱方案折扣' },
  { key: 'has_expert_discount_on_checkup_basic', label: '已訂方案 → 健檢 Basic 折扣' },
  { key: 'has_expert_discount_on_checkup_pro', label: '已訂方案 → 健檢 Pro 折扣' },
];

export default function CompanyPaymentSettings() {
  const [standard, setStandard] = useState<{ pct_platform: number; pct_expert: number }>({ pct_platform: 55, pct_expert: 45 });
  const [remit, setRemit] = useState<Record<string, string>>({});
  const [cross, setCross] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('payment_settings').select('key, value');
    const map: Record<string, any> = {};
    (data || []).forEach((r: Setting) => { map[r.key] = r.value; });
    const s = map['split_standard'] || { pct_platform: 55, pct_expert: 45 };
    setStandard({ pct_platform: s.pct_platform ?? 55, pct_expert: s.pct_expert ?? 45 });
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

  const saveStandard = async () => {
    const total = (standard.pct_platform || 0) + (standard.pct_expert || 0);
    if (total !== 100) {
      toast({ title: '比例錯誤', description: `平台 + 專家需為 100%（目前 ${total}%）`, variant: 'destructive' });
      return;
    }
    if (await upsert('split_standard', standard)) toast({ title: '已儲存標準分潤' });
  };

  const saveRemit = async () => { if (await upsert('remittance_account', remit)) toast({ title: '已儲存匯款帳戶' }); };
  const saveCross = async () => { if (await upsert('cross_discounts', cross)) toast({ title: '已儲存跨產品折扣' }); };

  if (loading) return <CompanyLayout><div className="p-6">載入中…</div></CompanyLayout>;

  return (
    <CompanyLayout>
      <div className="p-6 max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-semibold">收款設定</h1>
          <p className="text-sm text-muted-foreground mt-1">
            管理平台的收款規則：分潤比例、結帳頁公開資訊。
          </p>
        </div>

        {/* Section 1: 分潤規則 */}
        <section className="space-y-3">
          <div className="flex items-baseline justify-between border-b pb-2">
            <h2 className="text-lg font-semibold">一、分潤規則</h2>
            <span className="text-xs text-muted-foreground">平台與專家的拆帳設定</span>
          </div>

          <Card className="p-5 space-y-4">
            <div>
              <h3 className="font-semibold">標準分潤預設</h3>
              <p className="text-xs text-muted-foreground mt-1">
                所有「訂閱方案」的全站預設值；個別方案若有覆寫，以覆寫為準（請至{' '}
                <Link to="/company/plans" className="underline text-primary">方案管理</Link> 設定）。
                健檢商品由平台獨享 100%，不開放覆寫。
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 max-w-md">
              <div>
                <Label className="text-xs">平台（%）</Label>
                <Input type="number" min={0} max={100} value={standard.pct_platform}
                  onChange={e => setStandard(p => ({ ...p, pct_platform: Number(e.target.value), pct_expert: 100 - Number(e.target.value) }))} />
              </div>
              <div>
                <Label className="text-xs">專家（%）</Label>
                <Input type="number" min={0} max={100} value={standard.pct_expert}
                  onChange={e => setStandard(p => ({ ...p, pct_expert: Number(e.target.value), pct_platform: 100 - Number(e.target.value) }))} />
              </div>
            </div>
            <Button size="sm" onClick={saveStandard}>儲存標準分潤</Button>
          </Card>
        </section>

        {/* Section 2: 結帳頁公開資訊 */}
        <section className="space-y-3">
          <div className="flex items-baseline justify-between border-b pb-2">
            <h2 className="text-lg font-semibold">二、結帳頁公開資訊</h2>
            <span className="text-xs text-muted-foreground">會顯示給訂閱者看的內容</span>
          </div>

          <Card className="p-5 space-y-4">
            <div>
              <h3 className="font-semibold">匯款帳戶</h3>
              <p className="text-xs text-muted-foreground mt-1">
                結帳頁會公開顯示這組帳戶資訊，供買方手動匯款。
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {REMIT_FIELDS.map(f => (
                <div key={f.key}>
                  <Label className="text-xs">{f.label}</Label>
                  <Input value={remit[f.key] || ''} onChange={e => setRemit(p => ({ ...p, [f.key]: e.target.value }))} />
                </div>
              ))}
            </div>
            <Button size="sm" onClick={saveRemit}>儲存匯款帳戶</Button>
          </Card>

          <Card className="p-5 space-y-4">
            <div>
              <h3 className="font-semibold">跨產品折扣（NT$）</h3>
              <p className="text-xs text-muted-foreground mt-1">
                已訂閱某類商品的會員，購買另一類商品時自動套用的折抵金額。
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {CROSS_FIELDS.map(f => (
                <div key={f.key}>
                  <Label className="text-xs">{f.label}</Label>
                  <Input type="number" min={0} value={cross[f.key] ?? 0}
                    onChange={e => setCross(p => ({ ...p, [f.key]: Number(e.target.value) }))} />
                </div>
              ))}
            </div>
            <Button size="sm" onClick={saveCross}>儲存折扣設定</Button>
          </Card>
        </section>
      </div>
    </CompanyLayout>
  );
}
