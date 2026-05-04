import { useEffect, useState } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { Link } from 'react-router-dom';
import { logAdminAction } from '@/lib/auditLog';

type EcpayStatus = {
  source: string;
  env: string;
  apiUrl: string;
  isStageUrl: boolean;
  merchantId_masked: string;
  merchantId_length: number;
  isOfficialTestStore: boolean;
  hasHashKey: boolean;
  hasHashIV: boolean;
  verdict: string;
};

export default function CompanyPaymentSettings() {
  const [standard, setStandard] = useState<{ pct_platform: number; pct_expert: number }>({ pct_platform: 55, pct_expert: 45 });
  const [original, setOriginal] = useState<{ pct_platform: number; pct_expert: number }>({ pct_platform: 55, pct_expert: 45 });
  const [loading, setLoading] = useState(true);
  const [ecpayStatus, setEcpayStatus] = useState<EcpayStatus | null>(null);
  const [ecpayChecking, setEcpayChecking] = useState(false);

  const checkEcpay = async () => {
    setEcpayChecking(true);
    const { data, error } = await supabase.functions.invoke('admin-ecpay-status');
    setEcpayChecking(false);
    if (error) {
      toast({ title: '檢查失敗', description: error.message, variant: 'destructive' });
      return;
    }
    setEcpayStatus(data as EcpayStatus);
  };


  const load = async () => {
    setLoading(true);
    const { data } = await (supabase.from as any)('payment_settings_safe').select('key, value').eq('key', 'split_standard').maybeSingle();
    const s = (data?.value as any) || { pct_platform: 55, pct_expert: 45 };
    const v = { pct_platform: s.pct_platform ?? 55, pct_expert: s.pct_expert ?? 45 };
    setStandard(v);
    setOriginal(v);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const saveStandard = async () => {
    const total = (standard.pct_platform || 0) + (standard.pct_expert || 0);
    if (total !== 100) {
      toast({ title: '比例錯誤', description: `平台 + 專家需為 100%（目前 ${total}%）`, variant: 'destructive' });
      return;
    }
    const userId = (await supabase.auth.getUser()).data.user?.id;
    const { error } = await supabase.from('payment_settings')
      .upsert({ key: 'split_standard', value: standard, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) {
      toast({ title: '儲存失敗', description: error.message, variant: 'destructive' });
      return;
    }
    await logAdminAction({
      action: 'setting.split_default_update',
      targetType: 'payment_settings',
      detail: { before: original, after: standard },
    });
    setOriginal(standard);
    toast({ title: '已儲存標準分潤' });
  };

  if (loading) return <CompanyLayout><div className="p-6">載入中…</div></CompanyLayout>;

  return (
    <CompanyLayout>
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">分潤設定</h1>
          <p className="text-sm text-muted-foreground mt-1">
            設定平台與分析師的全站預設拆帳比例。個別方案的分潤覆寫請至{' '}
            <Link to="/company/plans" className="underline text-primary">方案管理</Link>。
          </p>
        </div>

        <Card className="p-5 space-y-4">
          <div>
            <h3 className="font-semibold">標準分潤預設</h3>
            <p className="text-xs text-muted-foreground mt-1">
              所有「訂閱方案」的全站預設值；個別方案若有覆寫，以覆寫為準。
              健檢商品由平台獨享 100%，不開放覆寫。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 max-w-md">
            <div>
              <Label className="text-xs">平台（%）</Label>
              <Input type="number" min={0} max={100} value={standard.pct_platform}
                onChange={e => {
                  const v = Number(e.target.value);
                  setStandard({ pct_platform: v, pct_expert: 100 - v });
                }} />
            </div>
            <div>
              <Label className="text-xs">分析師（%）</Label>
              <Input type="number" min={0} max={100} value={standard.pct_expert}
                onChange={e => {
                  const v = Number(e.target.value);
                  setStandard({ pct_expert: v, pct_platform: 100 - v });
                }} />
            </div>
          </div>
          <Button size="sm" onClick={saveStandard}>儲存標準分潤</Button>
        </Card>

        <Card className="p-5 space-y-3">
          <div>
            <h3 className="font-semibold">綠界金流環境檢查</h3>
            <p className="text-xs text-muted-foreground mt-1">
              不會顯示完整 MerchantID / HashKey / HashIV。只回傳末四碼與環境判斷。
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={checkEcpay} disabled={ecpayChecking}>
            {ecpayChecking ? '檢查中…' : '檢查目前綠界設定'}
          </Button>
          {ecpayStatus && (
            <div className="text-xs space-y-1 border rounded-md p-3 bg-muted/30 font-mono">
              <div>
                <span className="text-muted-foreground">結論：</span>
                <span className={ecpayStatus.isOfficialTestStore || ecpayStatus.isStageUrl ? 'text-orange-600' : 'text-green-700'}>
                  {ecpayStatus.verdict}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">商店編號：</span>
                {ecpayStatus.merchantId_masked}{' '}
                <span className="text-muted-foreground">（共 {ecpayStatus.merchantId_length} 碼）</span>
              </div>
              <div><span className="text-muted-foreground">API URL：</span>{ecpayStatus.apiUrl}</div>
              <div>
                <span className="text-muted-foreground">設定來源：</span>
                {ecpayStatus.source === 'db' ? '資料庫 payment_settings' : '環境變數 Secrets'}
              </div>
              <div>
                <span className="text-muted-foreground">HashKey：</span>{ecpayStatus.hasHashKey ? '✓ 已設定' : '✗ 未設定'}
                {' ・ '}
                <span className="text-muted-foreground">HashIV：</span>{ecpayStatus.hasHashIV ? '✓ 已設定' : '✗ 未設定'}
              </div>
              {ecpayStatus.isOfficialTestStore && (
                <div className="text-orange-600 mt-2">⚠ MerchantID 為 2000132，是綠界官方測試店，金流不會真的進帳。</div>
              )}
            </div>
          )}
        </Card>

        <Card className="p-5 space-y-2 bg-muted/30">
          <h3 className="text-sm font-semibold">相關設定</h3>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>• <Link to="/company/plans" className="underline">方案管理</Link>：個別方案的分潤覆寫、跨產品折扣</li>
            <li>• <Link to="/company/payments" className="underline">金流工具</Link>：金流通道啟用、匯款帳戶資訊</li>
          </ul>
        </Card>
      </div>
    </CompanyLayout>
  );
}
