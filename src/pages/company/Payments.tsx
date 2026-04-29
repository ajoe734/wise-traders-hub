import { useState, useEffect } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { CreditCard, Plus, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';

const providerLabels: Record<string, string> = {
  acpay: 'ACpay',
  ecpay: '綠界 ECPay',
  newebpay: '藍新 NewebPay',
  line_pay: 'LINE Pay',
};

const CompanyPayments = () => {
  const [providers, setProviders] = useState<any[]>([]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newProviderType, setNewProviderType] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');

  useEffect(() => { fetchProviders(); }, []);

  const fetchProviders = async () => {
    const { data } = await supabase.from('payment_providers').select('*').order('created_at');
    const filtered = (data || []).filter((p) => p.provider_type !== 'stripe');
    const order: Record<string, number> = { acpay: 0, ecpay: 1, newebpay: 2, line_pay: 3 };
    filtered.sort((a, b) => (order[a.provider_type] ?? 99) - (order[b.provider_type] ?? 99));
    setProviders(filtered);
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

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">金流工具</h1>
            <p className="text-muted-foreground text-sm mt-1">管理對外開放的金流通道（信用卡、行動支付）</p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/company/revenue">
              <ExternalLink className="h-4 w-4 mr-2" />前往對帳中心
            </Link>
          </Button>
        </div>

        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            交易紀錄、退款、營收與分潤對帳已整合到 <Link to="/company/revenue" className="text-company underline">對帳中心</Link>。本頁僅管理金流通道的啟用狀態。
          </CardContent>
        </Card>

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
      </div>
    </CompanyLayout>
  );
};

export default CompanyPayments;
