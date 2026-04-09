import { useState, useEffect } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { CreditCard, Plus, Search, Download, Undo2 } from 'lucide-react';
import { toast } from 'sonner';

const providerLabels: Record<string, string> = {
  acpay: 'ACpay',
  ecpay: '綠界 ECPay',
  newebpay: '藍新 NewebPay',
  line_pay: 'LINE Pay',
};

const paymentStatusLabels: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  pending: { label: '處理中', variant: 'secondary' },
  paid: { label: '已付款', variant: 'default' },
  failed: { label: '失敗', variant: 'destructive' },
  refunded: { label: '已退款', variant: 'outline' },
};

const CompanyPayments = () => {
  const { user } = useAuth();
  const [providers, setProviders] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newProviderType, setNewProviderType] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [refundingTx, setRefundingTx] = useState<any>(null);
  const [refundReason, setRefundReason] = useState('');

  useEffect(() => {
    fetchProviders();
    fetchTransactions();
  }, []);

  const fetchProviders = async () => {
    const { data } = await supabase.from('payment_providers').select('*').order('created_at');
    const filtered = (data || []).filter((p) => p.provider_type !== 'stripe');
    const order: Record<string, number> = { acpay: 0, ecpay: 1, newebpay: 2, line_pay: 3 };
    filtered.sort((a, b) => (order[a.provider_type] ?? 99) - (order[b.provider_type] ?? 99));
    setProviders(filtered);
  };

  const fetchTransactions = async () => {
    const { data } = await supabase.from('payment_transactions').select('*').order('created_at', { ascending: false }).limit(50);
    setTransactions(data || []);
  };

  const handleAddProvider = async () => {
    if (!newProviderType || !newDisplayName) return;
    const { error } = await supabase.from('payment_providers').insert({
      provider_type: newProviderType as any,
      display_name: newDisplayName,
      is_active: false,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('金流工具已新增');
    setIsAddOpen(false);
    setNewProviderType(''); setNewDisplayName('');
    fetchProviders();
  };

  const toggleProvider = async (id: string, isActive: boolean) => {
    setProviders(prev => prev.map(p => p.id === id ? { ...p, is_active: !isActive } : p));
    await supabase.from('payment_providers').update({ is_active: !isActive }).eq('id', id);
  };

  const setDefault = async (id: string) => {
    await supabase.from('payment_providers').update({ is_default: false }).neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('payment_providers').update({ is_default: true }).eq('id', id);
    toast.success('已設為預設金流');
    fetchProviders();
  };

  const handleRefund = async () => {
    if (!refundingTx) return;
    const { error } = await supabase.from('payment_transactions').update({ status: 'refunded' as any }).eq('id', refundingTx.id);
    if (error) { toast.error(error.message); return; }

    // Log to audit
    await supabase.from('audit_logs').insert({
      action: 'refund',
      actor_id: user?.id,
      target_type: 'payment_transaction',
      target_id: refundingTx.id,
      detail: { reason: refundReason, amount: refundingTx.amount, tx_id: refundingTx.provider_tx_id },
    });

    toast.success('退款完成');
    setRefundingTx(null);
    setRefundReason('');
    fetchTransactions();
  };

  // Refund stats for current month
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const refundTxs = transactions.filter(tx => tx.status === 'refunded' && tx.created_at >= monthStart);
  const refundTotal = refundTxs.reduce((sum, tx) => sum + Math.abs(tx.amount || 0), 0);
  const refundCount = refundTxs.length;

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">金流管理</h1>
            <p className="text-muted-foreground text-sm mt-1">管理金流工具與交易紀錄</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => {
            const headers = ['交易編號', '金額', '狀態', '時間'];
            const rows = transactions.map(tx => [
              tx.provider_tx_id || tx.id.slice(0, 8),
              tx.amount,
              tx.status,
              tx.created_at ? new Date(tx.created_at).toLocaleString('zh-TW') : '',
            ]);
            const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
            const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `payments-${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
          }}>
            <Download className="h-4 w-4 mr-2" />匯出對帳報表
          </Button>
        </div>

        {/* Refund Stats Panel */}
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">當月退款總額</p>
              <p className="text-2xl font-bold text-destructive">NT$ {refundTotal.toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">當月退款筆數</p>
              <p className="text-2xl font-bold">{refundCount} 筆</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="providers">
          <TabsList>
            <TabsTrigger value="providers">金流工具</TabsTrigger>
            <TabsTrigger value="transactions">交易紀錄</TabsTrigger>
          </TabsList>

          <TabsContent value="providers" className="space-y-4 mt-4">
            <div className="flex justify-end">
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
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{p.display_name}</span>
                            <Badge variant="outline" className="text-xs">{providerLabels[p.provider_type] || p.provider_type}</Badge>
                            {p.is_default && <Badge className="text-xs">預設</Badge>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{p.is_active ? '啟用' : '停用'}</span>
                          <Switch checked={p.is_active} onCheckedChange={() => toggleProvider(p.id, p.is_active)} className="data-[state=checked]:bg-company" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="transactions" className="space-y-4 mt-4">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="搜尋交易編號..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>

            <Card>
              <CardContent className="p-0">
                <table className="w-full">
                  <thead>
                    <tr className="border-b text-left text-sm text-muted-foreground">
                      <th className="p-4">交易編號</th>
                      <th className="p-4">金額</th>
                      <th className="p-4">狀態</th>
                      <th className="p-4">金流工具</th>
                      <th className="p-4">時間</th>
                      <th className="p-4">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.filter(tx => {
                      if (!search.trim()) return true;
                      const q = search.trim().toLowerCase();
                      return (tx.provider_tx_id || '').toLowerCase().includes(q) ||
                             tx.id.toLowerCase().includes(q) ||
                             String(tx.amount).includes(q) ||
                             (tx.status || '').toLowerCase().includes(q);
                    }).length === 0 ? (
                      <tr><td colSpan={6} className="p-8 text-center text-muted-foreground text-sm">暫無交易紀錄</td></tr>
                    ) : (
                      transactions.filter(tx => {
                        if (!search.trim()) return true;
                        const q = search.trim().toLowerCase();
                        return (tx.provider_tx_id || '').toLowerCase().includes(q) ||
                               tx.id.toLowerCase().includes(q) ||
                               String(tx.amount).includes(q) ||
                               (tx.status || '').toLowerCase().includes(q);
                      }).map(tx => {
                        const si = paymentStatusLabels[tx.status] || paymentStatusLabels.pending;
                        return (
                          <tr key={tx.id} className="border-b last:border-0">
                            <td className="p-4 text-sm font-mono">{tx.provider_tx_id || tx.id.slice(0, 8)}</td>
                            <td className="p-4 text-sm font-medium">NT${tx.amount?.toLocaleString()}</td>
                            <td className="p-4"><Badge variant={si.variant} className="text-xs">{si.label}</Badge></td>
                            <td className="p-4 text-sm text-muted-foreground">{tx.provider_id?.slice(0, 8) || '-'}</td>
                            <td className="p-4 text-sm text-muted-foreground">{tx.created_at ? new Date(tx.created_at).toLocaleString('zh-TW') : '-'}</td>
                            <td className="p-4">
                              {tx.status === 'paid' && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs text-company hover:text-company hover:bg-company/10"
                                  onClick={() => { setRefundingTx(tx); setRefundReason(''); }}
                                >
                                  <Undo2 className="h-3.5 w-3.5 mr-1" />退款
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Refund Dialog */}
        <AlertDialog open={!!refundingTx} onOpenChange={(open) => { if (!open) setRefundingTx(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>確認退款</AlertDialogTitle>
              <AlertDialogDescription>
                將對交易 {refundingTx?.provider_tx_id || refundingTx?.id?.slice(0, 8)} 進行退款，金額 NT${refundingTx?.amount?.toLocaleString()}。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2 py-2">
              <Label>退款原因</Label>
              <Textarea value={refundReason} onChange={e => setRefundReason(e.target.value)} placeholder="請填寫退款原因..." rows={3} />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={handleRefund} className="bg-company hover:bg-company/90 text-white">確認退款</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </CompanyLayout>
  );
};

export default CompanyPayments;
