import { useState, useEffect, useMemo } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import {
  CreditCard, Plus, ExternalLink, Landmark, Pencil, KeyRound,
  CheckCircle2, AlertTriangle, Circle, Star, Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { logAdminAction } from '@/lib/auditLog';

// ---------- Types ----------
type ProviderType = 'acpay' | 'ecpay' | 'newebpay' | 'line_pay';

interface ProviderRow {
  id: string;
  provider_type: ProviderType;
  display_name: string;
  is_active: boolean;
  is_default: boolean;
  config?: Record<string, unknown>;
  created_at?: string;
}

type CredsStatus = 'complete' | 'missing' | 'unsupported';

interface ChannelRow {
  provider: ProviderRow;
  credsStatus: CredsStatus;
  missingFields: string[];
  env?: 'stage' | 'production';
}

type EcpayCredsRow = {
  merchant_id?: string;
  hash_key?: string;
  hash_iv?: string;
  credit_action_url?: string;
  api_url?: string;
  env?: 'stage' | 'production';
  updated_at?: string;
};

const providerLabels: Record<ProviderType, string> = {
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
  const [providers, setProviders] = useState<ProviderRow[]>([]);

  // Add provider dialog
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newProviderType, setNewProviderType] = useState<ProviderType | ''>('');
  const [newDisplayName, setNewDisplayName] = useState('');

  // Remittance
  const [remit, setRemit] = useState<Record<string, string>>({});
  const [remitOriginal, setRemitOriginal] = useState<Record<string, string>>({});
  const [remitOpen, setRemitOpen] = useState(false);

  // ECPay credentials
  const [ecpay, setEcpay] = useState<EcpayCredsRow>({});
  const [ecpayOriginal, setEcpayOriginal] = useState<EcpayCredsRow>({});
  const [ecpayHasKey, setEcpayHasKey] = useState(false);
  const [ecpayHasIV, setEcpayHasIV] = useState(false);
  const [ecpayOpen, setEcpayOpen] = useState(false);
  const [ecpayHashKeyInput, setEcpayHashKeyInput] = useState('');
  const [ecpayHashIVInput, setEcpayHashIVInput] = useState('');

  // Unsupported channel info dialog (acpay / newebpay / line_pay)
  const [infoOpen, setInfoOpen] = useState<ProviderType | null>(null);

  useEffect(() => {
    fetchProviders();
    fetchRemit();
    fetchEcpay();
  }, []);

  // ---------- Fetchers ----------
  const fetchProviders = async () => {
    const { data } = await supabase.from('payment_providers').select('*').order('created_at');
    const filtered = ((data || []) as ProviderRow[]).filter((p) => p.provider_type !== ('stripe' as ProviderType));
    const order: Record<string, number> = { ecpay: 0, acpay: 1, newebpay: 2, line_pay: 3 };
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

  // ---------- Derived: channel matrix ----------
  const channels: ChannelRow[] = useMemo(() => {
    return providers.map((p) => {
      if (p.provider_type === 'ecpay') {
        const missing: string[] = [];
        if (!ecpayOriginal.merchant_id) missing.push('MerchantID');
        if (!ecpayHasKey) missing.push('HashKey');
        if (!ecpayHasIV) missing.push('HashIV');
        if (!ecpayOriginal.credit_action_url) missing.push('信用卡 Action URL');
        return {
          provider: p,
          credsStatus: missing.length === 0 ? 'complete' : 'missing',
          missingFields: missing,
          env: ecpayOriginal.env === 'production' ? 'production' : 'stage',
        };
      }
      // acpay / newebpay / line_pay：UI 尚未開放金鑰設定
      return {
        provider: p,
        credsStatus: 'unsupported' as CredsStatus,
        missingFields: [],
      };
    });
  }, [providers, ecpayOriginal, ecpayHasKey, ecpayHasIV]);

  const remitConfigured = REMIT_FIELDS.every((f) => (remit[f.key] || '').trim().length > 0);

  const liveChannels = useMemo(
    () => channels.filter((c) => c.provider.is_active && c.credsStatus === 'complete'),
    [channels],
  );

  // ---------- Handlers ----------
  const saveEcpay = async () => {
    const userId = (await supabase.auth.getUser()).data.user?.id;
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

    if (!next.merchant_id) { toast.error('請輸入商店代號'); return; }
    if (!next.credit_action_url) { toast.error('請輸入信用卡專用 Action URL'); return; }
    if (!next.hash_key || !next.hash_iv) { toast.error('HashKey 與 HashIV 不可為空'); return; }

    const { error } = await supabase
      .from('payment_settings')
      .upsert(
        { key: 'ecpay_credentials', value: next, updated_by: userId, updated_at: new Date().toISOString() },
        { onConflict: 'key' },
      );
    if (error) { toast.error(error.message); return; }

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
      provider_type: newProviderType,
      display_name: newDisplayName,
      is_active: false,
    } as never).select('id').maybeSingle();
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
    const provider = providers.find((p) => p.id === id);
    setProviders((prev) => prev.map((p) => (p.id === id ? { ...p, is_active: !isActive } : p)));
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

  const setAsDefault = async (id: string) => {
    const target = providers.find((p) => p.id === id);
    if (!target) return;
    // Unset others, set this one
    setProviders((prev) => prev.map((p) => ({ ...p, is_default: p.id === id })));
    await supabase.from('payment_providers').update({ is_default: false }).neq('id', id);
    await supabase.from('payment_providers').update({ is_default: true }).eq('id', id);
    await logAdminAction({
      action: 'setting.payment_provider_set_default',
      targetType: 'payment_providers',
      targetId: id,
      detail: { context: { provider_type: target.provider_type, display_name: target.display_name } },
    });
    toast.success(`已設定 ${target.display_name} 為預設通道`);
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

  // ---------- Render helpers ----------
  const StatusCell = ({ row }: { row: ChannelRow }) => {
    if (row.provider.is_active && row.credsStatus === 'complete') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="text-foreground">已啟用</span>
        </span>
      );
    }
    if (row.provider.is_active && row.credsStatus !== 'complete') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
          <span className="text-amber-600">啟用但不可用</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Circle className="h-2.5 w-2.5" />
        停用
      </span>
    );
  };

  const CredsCell = ({ row }: { row: ChannelRow }) => {
    if (row.credsStatus === 'complete') {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
          <CheckCircle2 className="h-3.5 w-3.5" />完整
        </span>
      );
    }
    if (row.credsStatus === 'missing') {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1 text-xs text-amber-600 cursor-help">
              <AlertTriangle className="h-3.5 w-3.5" />缺 {row.missingFields.length} 項
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <div className="text-xs">
              <div className="font-medium mb-1">缺少欄位</div>
              <ul className="space-y-0.5">
                {row.missingFields.map((f) => <li key={f}>• {f}</li>)}
              </ul>
            </div>
          </TooltipContent>
        </Tooltip>
      );
    }
    return <span className="text-xs text-muted-foreground">— 待開放</span>;
  };

  return (
    <CompanyLayout>
      <TooltipProvider delayDuration={150}>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">金流工具</h1>
              <p className="text-muted-foreground text-sm mt-1">
                管理對外開放的收款方式（線上金流通道、金鑰、匯款帳戶）
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/company/revenue">
                <ExternalLink className="h-4 w-4 mr-2" />前往對帳中心
              </Link>
            </Button>
          </div>

          {/* Health banner */}
          <Card className="border-l-4" style={{ borderLeftColor: liveChannels.length > 0 || remitConfigured ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))' }}>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  {liveChannels.length > 0 || remitConfigured ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">前台目前可收款</div>
                  <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    {liveChannels.length === 0 && !remitConfigured && (
                      <span>尚未設定任何可用的收款方式 — 前台無法完成付款</span>
                    )}
                    {liveChannels.map((c) => (
                      <span key={c.provider.id} className="inline-flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        {providerLabels[c.provider.provider_type]}
                        {c.env && <span className="text-[10px] uppercase opacity-60">· {c.env === 'production' ? '正式' : '測試'}</span>}
                      </span>
                    ))}
                    {remitConfigured && (
                      <span className="inline-flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        ATM／臨櫃匯款
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Main grid: matrix + side panel */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Channel matrix */}
            <div className="lg:col-span-2 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">線上金流通道</h2>
                <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline">
                      <Plus className="h-4 w-4 mr-1.5" />新增通道
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>新增金流通道</DialogTitle></DialogHeader>
                    <div className="space-y-4 mt-2">
                      <div className="space-y-2">
                        <Label>金流類型</Label>
                        <Select value={newProviderType} onValueChange={(v) => setNewProviderType(v as ProviderType)}>
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
                        <Input value={newDisplayName} onChange={(e) => setNewDisplayName(e.target.value)} placeholder="例：主要金流" />
                      </div>
                      <div className="flex justify-end gap-3">
                        <Button variant="outline" onClick={() => setIsAddOpen(false)}>取消</Button>
                        <Button onClick={handleAddProvider}>新增</Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              <Card>
                <CardContent className="p-0">
                  {channels.length === 0 ? (
                    <div className="py-12 text-center text-muted-foreground">
                      <CreditCard className="h-8 w-8 mx-auto mb-3 opacity-50" />
                      <p className="text-sm">尚未設定任何金流通道</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[180px]">通道</TableHead>
                          <TableHead className="w-[120px]">狀態</TableHead>
                          <TableHead className="w-[110px]">金鑰</TableHead>
                          <TableHead className="w-[80px]">環境</TableHead>
                          <TableHead className="w-[60px] text-center">預設</TableHead>
                          <TableHead className="text-right">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {channels.map((row) => {
                          const p = row.provider;
                          const isEcpay = p.provider_type === 'ecpay';
                          return (
                            <TableRow key={p.id}>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <CreditCard className="h-4 w-4 text-muted-foreground" />
                                  <div className="flex flex-col">
                                    <span className="text-sm font-medium leading-tight">{p.display_name}</span>
                                    <span className="text-[11px] text-muted-foreground leading-tight">
                                      {providerLabels[p.provider_type]}
                                    </span>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell><StatusCell row={row} /></TableCell>
                              <TableCell><CredsCell row={row} /></TableCell>
                              <TableCell>
                                {row.env ? (
                                  <Badge variant="outline" className="text-[10px] uppercase">
                                    {row.env === 'production' ? '正式' : '測試'}
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              <TableCell className="text-center">
                                {p.is_default ? (
                                  <Star className="h-4 w-4 text-amber-500 fill-amber-500 inline" />
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setAsDefault(p.id)}
                                    className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                                    disabled={!p.is_active || row.credsStatus !== 'complete'}
                                    title={!p.is_active || row.credsStatus !== 'complete' ? '需先啟用且金鑰完整' : ''}
                                  >
                                    設為預設
                                  </button>
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center justify-end gap-2">
                                  {isEcpay ? (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-8 px-2 text-xs"
                                      onClick={() => {
                                        setEcpay(ecpayOriginal);
                                        setEcpayHashKeyInput('');
                                        setEcpayHashIVInput('');
                                        setEcpayOpen(true);
                                      }}
                                    >
                                      <KeyRound className="h-3.5 w-3.5 mr-1" />金鑰
                                    </Button>
                                  ) : (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-8 px-2 text-xs"
                                      onClick={() => setInfoOpen(p.provider_type)}
                                    >
                                      <KeyRound className="h-3.5 w-3.5 mr-1" />金鑰
                                    </Button>
                                  )}
                                  <Switch
                                    checked={p.is_active}
                                    onCheckedChange={() => toggleProvider(p.id, p.is_active)}
                                    className="data-[state=checked]:bg-company"
                                  />
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              <p className="text-[11px] text-muted-foreground px-1">
                提示：通道顯示「啟用但不可用」表示已開啟但金鑰未設好，前台仍會略過此通道。
              </p>
            </div>

            {/* Right: side panel */}
            <div className="space-y-4">
              {/* Remittance card */}
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Landmark className="h-4 w-4 text-muted-foreground" />
                      <h3 className="text-sm font-semibold">匯款帳戶</h3>
                    </div>
                    <Badge variant="outline" className="text-[10px]">
                      {remitConfigured ? '已啟用' : '未設定'}
                    </Badge>
                  </div>
                  {remitConfigured ? (
                    <div className="text-xs space-y-0.5">
                      <div className="text-foreground">{remit.bank_name} <span className="text-muted-foreground">({remit.bank_code})</span></div>
                      <div className="text-muted-foreground">
                        ••••{(remit.account_number || '').slice(-4)} · {remit.account_name}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">尚未設定匯款帳戶資訊</p>
                  )}
                  <Dialog open={remitOpen} onOpenChange={setRemitOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline" className="w-full h-8 text-xs">
                        <Pencil className="h-3.5 w-3.5 mr-1.5" />{remitConfigured ? '編輯' : '設定'}
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>匯款帳戶資訊</DialogTitle></DialogHeader>
                      <p className="text-xs text-muted-foreground">
                        此資訊會顯示於結帳頁，供買方手動匯款使用。匯款訂單的審核請至「匯款審核」。
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                        {REMIT_FIELDS.map((f) => (
                          <div key={f.key}>
                            <Label className="text-xs">{f.label}</Label>
                            <Input
                              value={remit[f.key] || ''}
                              placeholder={f.placeholder}
                              onChange={(e) => setRemit((p) => ({ ...p, [f.key]: e.target.value }))}
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
                </CardContent>
              </Card>

              {/* Quick links */}
              <Card>
                <CardContent className="p-2">
                  {[
                    { to: '/company/revenue', label: '對帳中心', desc: '營收、退款、分潤' },
                    { to: '/company/remittance', label: '匯款審核', desc: '逐筆比對匯款訂單' },
                    { to: '/company/payment-settings', label: '分潤設定', desc: '平台／分析師預設比例' },
                  ].map((l) => (
                    <Link
                      key={l.to}
                      to={l.to}
                      className="flex items-center justify-between px-2 py-2.5 rounded-md hover:bg-muted/60 transition-colors group"
                    >
                      <div>
                        <div className="text-sm font-medium">{l.label}</div>
                        <div className="text-[11px] text-muted-foreground">{l.desc}</div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
                    </Link>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>

        {/* ECPay credentials dialog */}
        <Dialog open={ecpayOpen} onOpenChange={(open) => {
          setEcpayOpen(open);
          if (open) {
            setEcpay(ecpayOriginal);
            setEcpayHashKeyInput('');
            setEcpayHashIVInput('');
          }
        }}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>綠界 ECPay 金鑰</DialogTitle></DialogHeader>
            <p className="text-xs text-muted-foreground">
              金鑰只儲存於後台資料庫，前端不會讀取；HashKey 與 HashIV 留空表示「不變更」既有值。
            </p>
            <div className="grid grid-cols-1 gap-3 mt-2">
              <div>
                <Label className="text-xs">商店代號 MerchantID</Label>
                <Input
                  value={ecpay.merchant_id || ''}
                  placeholder="例：3268740"
                  onChange={(e) => setEcpay((p) => ({ ...p, merchant_id: e.target.value }))}
                />
              </div>
              <div>
                <Label className="text-xs">
                  HashKey {ecpayHasKey && <span className="text-muted-foreground">（目前已設定 ••••••••，留空＝不變更）</span>}
                </Label>
                <Input
                  type="password"
                  value={ecpayHashKeyInput}
                  placeholder={ecpayHasKey ? '••••••••（留空表示不變更）' : '請輸入 HashKey'}
                  onChange={(e) => setEcpayHashKeyInput(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div>
                <Label className="text-xs">
                  HashIV {ecpayHasIV && <span className="text-muted-foreground">（目前已設定 ••••••••，留空＝不變更）</span>}
                </Label>
                <Input
                  type="password"
                  value={ecpayHashIVInput}
                  placeholder={ecpayHasIV ? '••••••••（留空表示不變更）' : '請輸入 HashIV'}
                  onChange={(e) => setEcpayHashIVInput(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div>
                <Label className="text-xs">信用卡專用 Action URL</Label>
                <Input
                  value={ecpay.credit_action_url || ''}
                  placeholder="例：https://payment.ecpay.com.tw/SP/CreditCheckOut"
                  onChange={(e) => setEcpay((p) => ({ ...p, credit_action_url: e.target.value }))}
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  綠界提供給你的信用卡專用收單網址；此網址會用於所有信用卡訂單的提交。
                </p>
              </div>
              <div>
                <Label className="text-xs">主 AIO Action URL（選填）</Label>
                <Input
                  value={ecpay.api_url || ''}
                  placeholder="例：https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5"
                  onChange={(e) => setEcpay((p) => ({ ...p, api_url: e.target.value }))}
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  若日後要再開放 ATM／超商再填；目前前台僅啟用信用卡通道。
                </p>
              </div>
              <div>
                <Label className="text-xs">環境</Label>
                <Select
                  value={ecpay.env || 'stage'}
                  onValueChange={(v) => setEcpay((p) => ({ ...p, env: v as 'stage' | 'production' }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stage">測試環境（Stage）</SelectItem>
                    <SelectItem value="production">正式環境（Production）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setEcpay(ecpayOriginal); setEcpayHashKeyInput(''); setEcpayHashIVInput(''); setEcpayOpen(false); }}>取消</Button>
              <Button onClick={saveEcpay}>儲存</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Unsupported channel info dialog */}
        <Dialog open={!!infoOpen} onOpenChange={(o) => !o && setInfoOpen(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{infoOpen ? providerLabels[infoOpen] : ''} 金鑰設定</DialogTitle>
            </DialogHeader>
            <div className="text-sm text-muted-foreground space-y-2">
              <p>此通道的金鑰 UI 尚未開放，目前仍以後端環境變數（Lovable Cloud secrets）作為金鑰來源。</p>
              <p>如需切換金鑰，請聯絡工程團隊；後續會把此頁的 UI 開放出來。</p>
            </div>
            <DialogFooter>
              <Button onClick={() => setInfoOpen(null)}>了解</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TooltipProvider>
    </CompanyLayout>
  );
};

export default CompanyPayments;
