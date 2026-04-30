import { useState, useEffect } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { CreditCard, Plus, ExternalLink, Landmark, Pencil, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { logAdminAction } from '@/lib/auditLog';

const providerLabels: Record<string, string> = {
  acpay: 'ACpay',
  ecpay: '綠界 ECPay',
  newebpay: '藍新 NewebPay',
  line_pay: 'LINE Pay',
};

const REMIT_FIELDS: { key: string; label: string; placeholder?: string }[] = [
  { key: 'bank_name', label: '銀行名稱', placeholder: '例：玉山銀行' },
  { key: 'bank_code', label: '銀行代碼', placeholder: '例：808' },
  { key: 'account_number', label: '帳號' },
  { key: 'account_name', label: '戶名' },
];

const CompanyPayments = () => {
  const [providers, setProviders] = useState<any[]>([]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newProviderType, setNewProviderType] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');

  // Remittance account (公開於結帳頁的匯款資訊)
  const [remit, setRemit] = useState<Record<string, string>>({});
  const [remitOriginal, setRemitOriginal] = useState<Record<string, string>>({});
  const [remitOpen, setRemitOpen] = useState(false);

  // ECPay credentials (高敏感金鑰，前端只顯示遮罩)
  type EcpayCredsRow = {
    merchant_id?: string;
    hash_key?: string;
    hash_iv?: string;
    credit_action_url?: string;
    api_url?: string;
    env?: 'stage' | 'production';
    updated_at?: string;
  };
  const [ecpay, setEcpay] = useState<EcpayCredsRow>({});
  const [ecpayOriginal, setEcpayOriginal] = useState<EcpayCredsRow>({});
  const [ecpayHasKey, setEcpayHasKey] = useState(false);
  const [ecpayHasIV, setEcpayHasIV] = useState(false);
  const [ecpayOpen, setEcpayOpen] = useState(false);
  // 暫存使用者輸入的明碼新值；空字串代表「不變更」
  const [ecpayHashKeyInput, setEcpayHashKeyInput] = useState('');
  const [ecpayHashIVInput, setEcpayHashIVInput] = useState('');

  useEffect(() => {
    fetchProviders();
    fetchRemit();
    fetchEcpay();
  }, []);

  const fetchProviders = async () => {
    const { data } = await supabase.from('payment_providers').select('*').order('created_at');
    const filtered = (data || []).filter((p) => p.provider_type !== 'stripe');
    const order: Record<string, number> = { acpay: 0, ecpay: 1, newebpay: 2, line_pay: 3 };
    filtered.sort((a, b) => (order[a.provider_type] ?? 99) - (order[b.provider_type] ?? 99));
    setProviders(filtered);
  };

  const fetchRemit = async () => {
    const { data } = await supabase.from('payment_settings').select('value').eq('key', 'remittance_account').maybeSingle();
    const v = (data?.value as Record<string, string>) || {};
    setRemit(v);
    setRemitOriginal(v);
  };

  const fetchEcpay = async () => {
    const { data } = await supabase
      .from('payment_settings')
      .select('value, updated_at')
      .eq('key', 'ecpay_credentials')
      .maybeSingle();
    const v = (data?.value as EcpayCredsRow) || {};
    const withTs: EcpayCredsRow = { ...v, updated_at: data?.updated_at };
    setEcpay(withTs);
    setEcpayOriginal(withTs);
    setEcpayHasKey(!!(v.hash_key && v.hash_key.length > 0));
    setEcpayHasIV(!!(v.hash_iv && v.hash_iv.length > 0));
    setEcpayHashKeyInput('');
    setEcpayHashIVInput('');
  };

  const saveEcpay = async () => {
    const userId = (await supabase.auth.getUser()).data.user?.id;
    // Compose final value: 留空＝不變更，沿用 original
    const next: EcpayCredsRow = {
      merchant_id: (ecpay.merchant_id ?? '').trim(),
      hash_key: ecpayHashKeyInput.trim()
        ? ecpayHashKeyInput.trim()
        : (ecpayOriginal.hash_key ?? ''),
      hash_iv: ecpayHashIVInput.trim()
        ? ecpayHashIVInput.trim()
        : (ecpayOriginal.hash_iv ?? ''),
      credit_action_url: (ecpay.credit_action_url ?? '').trim(),
      api_url: (ecpay.api_url ?? '').trim(),
      env: ecpay.env === 'production' ? 'production' : 'stage',
    };

    if (!next.merchant_id) {
      toast.error('請輸入商店代號');
      return;
    }
    if (!next.credit_action_url) {
      toast.error('請輸入信用卡專用 Action URL');
      return;
    }
    if (!next.hash_key || !next.hash_iv) {
      toast.error('HashKey 與 HashIV 不可為空');
      return;
    }

    const { error } = await supabase
      .from('payment_settings')
      .upsert(
        { key: 'ecpay_credentials', value: next, updated_by: userId, updated_at: new Date().toISOString() },
        { onConflict: 'key' },
      );
    if (error) { toast.error(error.message); return; }

    // Audit log：絕不寫入金鑰原始值
    const changedFields: string[] = [];
    if ((ecpayOriginal.merchant_id ?? '') !== next.merchant_id) changedFields.push('merchant_id');
    if (ecpayHashKeyInput.trim()) changedFields.push('hash_key');
    if (ecpayHashIVInput.trim()) changedFields.push('hash_iv');
    if ((ecpayOriginal.credit_action_url ?? '') !== next.credit_action_url) changedFields.push('credit_action_url');
    if ((ecpayOriginal.api_url ?? '') !== next.api_url) changedFields.push('api_url');
    if ((ecpayOriginal.env ?? 'stage') !== next.env) changedFields.push('env');

    await logAdminAction({
      action: 'setting.ecpay_credentials_update',
      targetType: 'payment_settings',
      detail: {
        merchant_id: next.merchant_id,
        env: next.env,
        changed_fields: changedFields,
      },
    });

    toast.success('綠界金流設定已更新');
    setEcpayOpen(false);
    fetchEcpay();
  };

  const handleAddProvider = async () => {
    if (!newProviderType || !newDisplayName) return;
    const { data: inserted, error } = await supabase.from('payment_providers').insert({
      provider_type: newProviderType as any,
      display_name: newDisplayName,
      is_active: false,
    }).select('id').maybeSingle();
    if (error) { toast.error(error.message); return; }
    await logAdminAction({
      action: 'setting.payment_provider_create',
      targetType: 'payment_providers',
      targetId: inserted?.id ?? null,
      detail: { after: { provider_type: newProviderType, display_name: newDisplayName } },
    });
    toast.success('金流工具已新增');
    setIsAddOpen(false);
    setNewProviderType(''); setNewDisplayName('');
    fetchProviders();
  };

  const toggleProvider = async (id: string, isActive: boolean) => {
    const provider = providers.find(p => p.id === id);
    setProviders(prev => prev.map(p => p.id === id ? { ...p, is_active: !isActive } : p));
    await supabase.from('payment_providers').update({ is_active: !isActive }).eq('id', id);
    await logAdminAction({
      action: 'setting.payment_provider_toggle',
      targetType: 'payment_providers',
      targetId: id,
      detail: {
        before: { is_active: isActive },
        after: { is_active: !isActive },
        context: { provider_type: provider?.provider_type, display_name: provider?.display_name },
      },
    });
  };

  const saveRemit = async () => {
    const userId = (await supabase.auth.getUser()).data.user?.id;
    const { error } = await supabase.from('payment_settings')
      .upsert({ key: 'remittance_account', value: remit, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) { toast.error(error.message); return; }
    await logAdminAction({
      action: 'setting.remittance_account_update',
      targetType: 'payment_settings',
      detail: { before: remitOriginal, after: remit },
    });
    setRemitOriginal(remit);
    toast.success('匯款帳戶已更新');
    setRemitOpen(false);
  };

  const remitConfigured = REMIT_FIELDS.every(f => (remit[f.key] || '').trim().length > 0);

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">金流工具</h1>
            <p className="text-muted-foreground text-sm mt-1">管理對外開放的收款方式（線上金流、匯款帳戶）</p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/company/revenue">
              <ExternalLink className="h-4 w-4 mr-2" />前往對帳中心
            </Link>
          </Button>
        </div>

        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            交易紀錄、退款、營收與分潤對帳已整合到 <Link to="/company/revenue" className="text-company underline">對帳中心</Link>。
            匯款訂單的逐筆審核請至 <Link to="/company/remittance" className="text-company underline">匯款審核</Link>。
          </CardContent>
        </Card>

        {/* === Section 1: 線上金流 === */}
        <section className="space-y-3">
          <div className="flex items-center justify-between border-b pb-2">
            <h2 className="text-lg font-semibold">線上金流</h2>
            <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-company hover:bg-company/90 text-white"><Plus className="h-4 w-4 mr-2" />新增金流工具</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>新增金流工具</DialogTitle></DialogHeader>
                <div className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label>金流類型</Label>
                    <Select value={newProviderType} onValueChange={setNewProviderType}>
                      <SelectTrigger><SelectValue placeholder="選擇金流" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="acpay">ACpay</SelectItem>
                        <SelectItem value="ecpay">綠界 ECPay</SelectItem>
                        <SelectItem value="newebpay">藍新 NewebPay</SelectItem>
                        <SelectItem value="line_pay">LINE Pay</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>顯示名稱</Label>
                    <Input value={newDisplayName} onChange={e => setNewDisplayName(e.target.value)} placeholder="例：主要金流" />
                  </div>
                  <div className="flex justify-end gap-3">
                    <Button variant="outline" onClick={() => setIsAddOpen(false)}>取消</Button>
                    <Button onClick={handleAddProvider}>新增</Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {providers.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <CreditCard className="h-8 w-8 mx-auto mb-3 opacity-50" />
                <p>尚未設定任何金流工具</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {providers.map(p => (
                <Card key={p.id}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <CreditCard className="h-5 w-5 text-muted-foreground" />
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{p.display_name}</span>
                        <Badge variant="outline" className="text-xs">{providerLabels[p.provider_type] || p.provider_type}</Badge>
                        {p.is_default && <Badge className="text-xs">預設</Badge>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{p.is_active ? '啟用' : '停用'}</span>
                      <Switch checked={p.is_active} onCheckedChange={() => toggleProvider(p.id, p.is_active)} className="data-[state=checked]:bg-company" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* === Section 2: 匯款帳戶（結帳頁公開資訊） === */}
        <section className="space-y-3">
          <div className="flex items-center justify-between border-b pb-2">
            <h2 className="text-lg font-semibold">匯款帳戶（ATM／臨櫃）</h2>
            <Dialog open={remitOpen} onOpenChange={setRemitOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  <Pencil className="h-4 w-4 mr-2" />{remitConfigured ? '編輯' : '設定'}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>匯款帳戶資訊</DialogTitle></DialogHeader>
                <p className="text-xs text-muted-foreground">
                  此資訊會顯示於結帳頁，供買方手動匯款使用。匯款訂單的審核請至「匯款審核」。
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                  {REMIT_FIELDS.map(f => (
                    <div key={f.key}>
                      <Label className="text-xs">{f.label}</Label>
                      <Input
                        value={remit[f.key] || ''}
                        placeholder={f.placeholder}
                        onChange={e => setRemit(p => ({ ...p, [f.key]: e.target.value }))}
                      />
                    </div>
                  ))}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => { setRemit(remitOriginal); setRemitOpen(false); }}>取消</Button>
                  <Button onClick={saveRemit}>儲存</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Landmark className="h-5 w-5 text-muted-foreground" />
                {remitConfigured ? (
                  <div className="text-sm">
                    <div className="font-medium">{remit.bank_name} ({remit.bank_code})</div>
                    <div className="text-xs text-muted-foreground">
                      {remit.account_number} · 戶名：{remit.account_name}
                    </div>
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">尚未設定匯款帳戶</span>
                )}
              </div>
              <Badge variant="outline" className="text-xs">
                {remitConfigured ? '已啟用' : '未設定'}
              </Badge>
            </CardContent>
          </Card>
        </section>
      </div>
    </CompanyLayout>
  );
};

export default CompanyPayments;
