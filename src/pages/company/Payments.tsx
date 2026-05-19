import { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import {
  CreditCard, ExternalLink, Landmark, AlertTriangle, Wallet, Dialog as _,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { logAdminAction } from '@/lib/auditLog';
import {
  ProviderType, ProviderRow, CredsStatus, ChannelRow, EcpayCredsRow,
  providerLabels, REMIT_FIELDS,
} from '@/pages/_companyPayments/types';
import { PaymentGroupSection } from '@/pages/_companyPayments/PaymentGroupSection';
import { EcpayCredentialsDialog } from '@/pages/_companyPayments/EcpayCredentialsDialog';
import { AddProviderDialog } from '@/pages/_companyPayments/AddProviderDialog';
import { RemittanceCard } from '@/pages/_companyPayments/RemittanceCard';

const CompanyPayments = () => {
  const queryClient = useQueryClient();
  const [providers, setProviders] = useState<ProviderRow[]>([]);

  const [addGroup, setAddGroup] = useState<'credit' | 'ewallet' | null>(null);
  const [newProviderType, setNewProviderType] = useState<ProviderType | ''>('');
  const [newDisplayName, setNewDisplayName] = useState('');

  const [remit, setRemit] = useState<Record<string, string>>({});
  const [remitOriginal, setRemitOriginal] = useState<Record<string, string>>({});
  const [remitOpen, setRemitOpen] = useState(false);

  const [ecpay, setEcpay] = useState<EcpayCredsRow>({});
  const [ecpayOriginal, setEcpayOriginal] = useState<EcpayCredsRow>({});
  const [ecpayHasKey, setEcpayHasKey] = useState(false);
  const [ecpayHasIV, setEcpayHasIV] = useState(false);
  const [ecpayOpen, setEcpayOpen] = useState(false);
  const [ecpayHashKeyInput, setEcpayHashKeyInput] = useState('');
  const [ecpayHashIVInput, setEcpayHashIVInput] = useState('');

  const [infoOpen, setInfoOpen] = useState<ProviderType | null>(null);

  const { data: snapshot } = useQuery({
    queryKey: ['company', 'payments'],
    queryFn: async () => {
      const [providersRes, remitRes, ecpayRes] = await Promise.all([
        supabase.from('payment_providers').select('*').order('created_at'),
        (supabase.from as any)('payment_settings_safe').select('value').eq('key', 'remittance_account').maybeSingle(),
        (supabase.from as any)('payment_settings_safe')
          .select('value, updated_at').eq('key', 'ecpay_credentials').maybeSingle(),
      ]);

      const filtered = ((providersRes.data || []) as ProviderRow[])
        .filter((p) => p.provider_type !== ('stripe' as ProviderType));
      const order: Record<string, number> = { ecpay: 0, acpay: 1, newebpay: 2, line_pay: 3 };
      filtered.sort((a, b) => (order[a.provider_type] ?? 99) - (order[b.provider_type] ?? 99));

      const remitValue = (remitRes.data?.value as Record<string, string>) || {};

      const ecpayRaw = (ecpayRes.data?.value as EcpayCredsRow & { has_hash_key?: boolean; has_hash_iv?: boolean }) || {};
      const ecpayWithTs: EcpayCredsRow = { ...ecpayRaw, updated_at: ecpayRes.data?.updated_at };
      delete (ecpayWithTs as any).hash_key;
      delete (ecpayWithTs as any).hash_iv;

      return {
        providers: filtered,
        remit: remitValue,
        ecpay: ecpayWithTs,
        ecpayHasKey: !!ecpayRaw.has_hash_key,
        ecpayHasIV: !!ecpayRaw.has_hash_iv,
      };
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!snapshot) return;
    setProviders(snapshot.providers);
    setRemit(snapshot.remit);
    setRemitOriginal(snapshot.remit);
    setEcpay(snapshot.ecpay);
    setEcpayOriginal(snapshot.ecpay);
    setEcpayHasKey(snapshot.ecpayHasKey);
    setEcpayHasIV(snapshot.ecpayHasIV);
    setEcpayHashKeyInput('');
    setEcpayHashIVInput('');
  }, [snapshot]);

  const invalidatePayments = () =>
    queryClient.invalidateQueries({ queryKey: ['company', 'payments'] });

  const channels: ChannelRow[] = useMemo(() => {
    return providers.map((p) => {
      if (p.provider_type === 'ecpay') {
        const missing: string[] = [];
        if (!ecpayOriginal.merchant_id) missing.push('MerchantID');
        if (!ecpayHasKey) missing.push('HashKey');
        if (!ecpayHasIV) missing.push('HashIV');
        return {
          provider: p,
          credsStatus: missing.length === 0 ? 'complete' : 'missing',
          missingFields: missing,
          env: ecpayOriginal.env === 'production' ? 'production' : 'stage',
        };
      }
      return {
        provider: p,
        credsStatus: 'unsupported' as CredsStatus,
        missingFields: [],
      };
    });
  }, [providers, ecpayOriginal, ecpayHasKey, ecpayHasIV]);

  const remitConfigured = REMIT_FIELDS.every((f) => (remit[f.key] || '').trim().length > 0);

  const creditChannels = useMemo(
    () => channels.filter((c) => c.provider.provider_type === 'ecpay' || c.provider.provider_type === 'acpay'),
    [channels],
  );
  const ewalletChannels = useMemo(
    () => channels.filter((c) => c.provider.provider_type === 'newebpay' || c.provider.provider_type === 'line_pay'),
    [channels],
  );

  const liveCreditCount = creditChannels.filter((c) => c.provider.is_active && c.credsStatus === 'complete').length;
  const liveEwalletCount = ewalletChannels.filter((c) => c.provider.is_active && c.credsStatus === 'complete').length;
  const creditWarnCount = creditChannels.filter((c) => c.provider.is_active && c.credsStatus !== 'complete').length;
  const ewalletWarnCount = ewalletChannels.filter((c) => c.provider.is_active && c.credsStatus !== 'complete').length;

  const saveEcpay = async () => {
    const userId = (await supabase.auth.getUser()).data.user?.id;

    let rawHashKey = '';
    let rawHashIV = '';
    if (!ecpayHashKeyInput.trim() || !ecpayHashIVInput.trim()) {
      const { data: rawRow } = await supabase
        .from('payment_settings')
        .select('value')
        .eq('key', 'ecpay_credentials')
        .maybeSingle();
      const rv = (rawRow?.value as { hash_key?: string; hash_iv?: string }) || {};
      rawHashKey = rv.hash_key ?? '';
      rawHashIV = rv.hash_iv ?? '';
    }

    const next: EcpayCredsRow = {
      merchant_id: (ecpay.merchant_id ?? '').trim(),
      hash_key: ecpayHashKeyInput.trim() ? ecpayHashKeyInput.trim() : rawHashKey,
      hash_iv: ecpayHashIVInput.trim() ? ecpayHashIVInput.trim() : rawHashIV,
      credit_action_url: (ecpayOriginal.credit_action_url ?? '').trim() || undefined,
      api_url: (ecpayOriginal.api_url ?? '').trim() || undefined,
      env: ecpay.env === 'production' ? 'production' : 'stage',
    };

    if (!next.merchant_id) { toast.error('請輸入商店代號'); return; }
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
    invalidatePayments();
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
    setAddGroup(null);
    setNewProviderType(''); setNewDisplayName('');
    invalidatePayments();
  };

  const toggleProvider = async (id: string, isActive: boolean) => {
    const provider = providers.find((p) => p.id === id);
    const willBeActive = !isActive;
    const clearDefault = !willBeActive && provider?.is_default;
    setProviders((prev) => prev.map((p) =>
      p.id === id
        ? { ...p, is_active: willBeActive, is_default: clearDefault ? false : p.is_default }
        : p,
    ));
    await supabase
      .from('payment_providers')
      .update(clearDefault ? { is_active: willBeActive, is_default: false } : { is_active: willBeActive })
      .eq('id', id);
    await logAdminAction({
      action: 'setting.payment_provider_toggle',
      targetType: 'payment_providers',
      targetId: id,
      detail: {
        before: { is_active: isActive, is_default: provider?.is_default },
        after: { is_active: willBeActive, is_default: clearDefault ? false : provider?.is_default },
        context: { provider_type: provider?.provider_type, display_name: provider?.display_name },
      },
    });
    if (clearDefault) {
      toast.warning(`已停用 ${provider?.display_name}，並自動取消其預設通道狀態`);
    }
    invalidatePayments();
  };

  const setAsDefault = async (id: string) => {
    const target = providers.find((p) => p.id === id);
    if (!target) return;
    if (!target.is_active) {
      toast.error('此通道尚未啟用，請先啟用後再設為預設');
      return;
    }
    const ch = channels.find((c) => c.provider.id === id);
    if (ch && ch.credsStatus !== 'complete') {
      toast.error('此通道金鑰尚未完整，無法設為預設');
      return;
    }
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
    invalidatePayments();
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
    invalidatePayments();
  };

  return (
    <CompanyLayout>
      <TooltipProvider delayDuration={150}>
        <div className="space-y-6">
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

          <Card>
            <CardContent className="p-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="flex items-start gap-2">
                  <CreditCard className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground">信用卡</div>
                    <div className="text-sm font-medium mt-0.5">
                      {liveCreditCount > 0 ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          {liveCreditCount} 條可用
                        </span>
                      ) : (
                        <span className="text-muted-foreground">未啟用</span>
                      )}
                      {creditWarnCount > 0 && (
                        <span className="ml-2 text-amber-600 text-xs inline-flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />{creditWarnCount} 條缺金鑰
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-2">
                  <Wallet className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground">電子支付</div>
                    <div className="text-sm font-medium mt-0.5">
                      {liveEwalletCount > 0 ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          {liveEwalletCount} 條可用
                        </span>
                      ) : (
                        <span className="text-muted-foreground">未啟用</span>
                      )}
                      {ewalletWarnCount > 0 && (
                        <span className="ml-2 text-amber-600 text-xs inline-flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />{ewalletWarnCount} 條缺金鑰
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-2">
                  <Landmark className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground">匯款</div>
                    <div className="text-sm font-medium mt-0.5">
                      {remitConfigured ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          已設定
                        </span>
                      ) : (
                        <span className="text-muted-foreground">未設定</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <PaymentGroupSection
            icon={<CreditCard className="h-4 w-4 text-muted-foreground" />}
            title="信用卡"
            description="一次性付款與定期定額信用卡通道"
            rows={creditChannels}
            providerLabels={providerLabels}
            emptyText="尚未新增任何信用卡通道"
            onAdd={() => setAddGroup('credit')}
            addLabel="新增信用卡通道"
            onEcpayKeys={() => {
              setEcpay(ecpayOriginal);
              setEcpayHashKeyInput('');
              setEcpayHashIVInput('');
              setEcpayOpen(true);
            }}
            onUnsupportedKeys={(t) => setInfoOpen(t)}
            onToggle={toggleProvider}
            onSetDefault={setAsDefault}
          />

          <PaymentGroupSection
            icon={<Wallet className="h-4 w-4 text-muted-foreground" />}
            title="電子支付"
            description="第三方電子支付服務商通道"
            rows={ewalletChannels}
            providerLabels={providerLabels}
            emptyText="尚未新增任何電子支付通道"
            onAdd={() => setAddGroup('ewallet')}
            addLabel="新增電子支付通道"
            onEcpayKeys={() => {}}
            onUnsupportedKeys={(t) => setInfoOpen(t)}
            onToggle={toggleProvider}
            onSetDefault={setAsDefault}
          />

          <RemittanceCard
            remit={remit}
            setRemit={setRemit}
            remitOriginal={remitOriginal}
            remitConfigured={remitConfigured}
            remitOpen={remitOpen}
            setRemitOpen={setRemitOpen}
            onSave={saveRemit}
          />

          <p className="text-[11px] text-muted-foreground px-1">
            提示：通道顯示「啟用但不可用」表示已開啟但金鑰未設好，前台仍會略過此通道。
          </p>
        </div>

        <AddProviderDialog
          addGroup={addGroup}
          onClose={() => { setAddGroup(null); setNewProviderType(''); setNewDisplayName(''); }}
          newProviderType={newProviderType}
          setNewProviderType={setNewProviderType}
          newDisplayName={newDisplayName}
          setNewDisplayName={setNewDisplayName}
          onAdd={handleAddProvider}
        />

        <EcpayCredentialsDialog
          open={ecpayOpen}
          onOpenChange={setEcpayOpen}
          ecpay={ecpay}
          setEcpay={setEcpay}
          ecpayHasKey={ecpayHasKey}
          ecpayHasIV={ecpayHasIV}
          ecpayHashKeyInput={ecpayHashKeyInput}
          setEcpayHashKeyInput={setEcpayHashKeyInput}
          ecpayHashIVInput={ecpayHashIVInput}
          setEcpayHashIVInput={setEcpayHashIVInput}
          ecpayOriginal={ecpayOriginal}
          onSave={saveEcpay}
        />

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
