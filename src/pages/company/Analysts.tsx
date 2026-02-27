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
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { Eye, UserPlus, Package, MessageCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

const CompanyAnalysts = () => {
  const [experts, setExperts] = useState<any[]>([]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // Create analyst form
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [role, setRole] = useState('');
  const [creating, setCreating] = useState(false);

  // Plan management
  const [planExpert, setPlanExpert] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [isAddPlanOpen, setIsAddPlanOpen] = useState(false);
  const [planName, setPlanName] = useState('');
  const [planType, setPlanType] = useState('');
  const [planMonthly, setPlanMonthly] = useState('');
  const [planYearly, setPlanYearly] = useState('');
  const [planDesc, setPlanDesc] = useState('');
  const [savingPlan, setSavingPlan] = useState(false);

  // LINE channel management
  const [lineExpert, setLineExpert] = useState<any>(null);
  const [lineChannel, setLineChannel] = useState<any>(null);
  const [lineLoading, setLineLoading] = useState(false);
  const [lineChannelId, setLineChannelId] = useState('');
  const [lineToken, setLineToken] = useState('');
  const [lineChannelName, setLineChannelName] = useState('');
  const [lineOaId, setLineOaId] = useState('');
  const [lineQrCodeUrl, setLineQrCodeUrl] = useState('');
  const [lineActive, setLineActive] = useState(true);
  const [savingLine, setSavingLine] = useState(false);
  const [lineBindingsCount, setLineBindingsCount] = useState(0);

  useEffect(() => { fetchExperts(); }, []);

  const fetchExperts = async () => {
    setLoading(true);
    const { data } = await supabase.from('experts').select('*').order('created_at', { ascending: false });
    setExperts(data || []);
    setLoading(false);
  };

  const handleCreate = async () => {
    if (!email || !password || !name || !slug || !role) {
      toast.error('請填寫所有必填欄位');
      return;
    }
    setCreating(true);
    const { data, error } = await supabase.functions.invoke('create-analyst', {
      body: { email, password, name, slug, role },
    });
    setCreating(false);
    if (error || data?.error) {
      toast.error(data?.error || error?.message || '建立失敗');
      return;
    }
    toast.success('分析師已建立');
    setIsCreateOpen(false);
    setEmail(''); setPassword(''); setName(''); setSlug(''); setRole('');
    fetchExperts();
  };

  const toggleStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'suspended' : 'active';
    setExperts(prev => prev.map(e => e.id === id ? { ...e, status: newStatus } : e));
    await supabase.from('experts').update({ status: newStatus }).eq('id', id);
    toast.success(newStatus === 'active' ? '已啟用' : '已停用');
  };

  // Plan management
  const openPlans = async (expert: any) => {
    setPlanExpert(expert);
    setPlansLoading(true);
    const { data } = await supabase
      .from('expert_plans')
      .select('*')
      .eq('expert_id', expert.id)
      .order('created_at', { ascending: false });
    setPlans(data || []);
    setPlansLoading(false);
  };

  const closePlans = () => {
    setPlanExpert(null);
    setPlans([]);
  };

  const togglePlanActive = async (planId: string, currentActive: boolean) => {
    await supabase.from('expert_plans').update({ is_active: !currentActive }).eq('id', planId);
    toast.success(!currentActive ? '方案已上架' : '方案已下架');
    if (planExpert) openPlans(planExpert);
  };

  const handleAddPlan = async () => {
    if (!planName || !planType || !planMonthly || !planExpert) {
      toast.error('請填寫必填欄位');
      return;
    }
    setSavingPlan(true);
    const { error } = await supabase.from('expert_plans').insert({
      expert_id: planExpert.id,
      name: planName,
      plan_type: planType as any,
      price_monthly: parseInt(planMonthly),
      price_yearly: planYearly ? parseInt(planYearly) : null,
      description: planDesc || null,
      review_status: 'approved' as any,
      is_active: true,
    });
    setSavingPlan(false);
    if (error) {
      toast.error('建立方案失敗');
      return;
    }
    toast.success('方案已建立');
    setIsAddPlanOpen(false);
    setPlanName(''); setPlanType(''); setPlanMonthly(''); setPlanYearly(''); setPlanDesc('');
    openPlans(planExpert);
  };
  // LINE channel management
  const openLineSettings = async (expert: any) => {
    setLineExpert(expert);
    setLineLoading(true);
    const { data: ch } = await supabase
      .from('expert_line_channels')
      .select('*')
      .eq('expert_id', expert.id)
      .single();
    if (ch) {
      setLineChannel(ch);
      setLineChannelId(ch.channel_id);
      setLineToken(ch.channel_access_token);
      setLineChannelName(ch.channel_name || '');
      setLineOaId(ch.line_oa_id || '');
      setLineQrCodeUrl(ch.qr_code_url || '');
      setLineActive(ch.is_active);
    } else {
      setLineChannel(null);
      setLineChannelId('');
      setLineToken('');
      setLineChannelName('');
      setLineOaId('');
      setLineQrCodeUrl('');
      setLineActive(true);
    }
    const { count } = await supabase
      .from('member_line_bindings')
      .select('id', { count: 'exact', head: true })
      .eq('expert_id', expert.id)
      .eq('is_active', true);
    setLineBindingsCount(count || 0);
    setLineLoading(false);
  };

  const closeLineSettings = () => {
    setLineExpert(null);
    setLineChannel(null);
  };

  const handleSaveLine = async () => {
    if (!lineExpert || !lineChannelId || !lineToken) {
      toast.error('請填寫 Channel ID 和 Access Token');
      return;
    }
    setSavingLine(true);
    if (lineChannel) {
      const { error } = await supabase
        .from('expert_line_channels')
        .update({
          channel_id: lineChannelId,
          channel_access_token: lineToken,
          channel_name: lineChannelName || null,
          line_oa_id: lineOaId || null,
          qr_code_url: lineQrCodeUrl || null,
          is_active: lineActive,
        })
        .eq('id', lineChannel.id);
      if (error) { toast.error('更新失敗'); setSavingLine(false); return; }
      toast.success('LINE 設定已更新');
    } else {
      const { error } = await supabase
        .from('expert_line_channels')
        .insert({
          expert_id: lineExpert.id,
          channel_id: lineChannelId,
          channel_access_token: lineToken,
          channel_name: lineChannelName || null,
          line_oa_id: lineOaId || null,
          qr_code_url: lineQrCodeUrl || null,
          is_active: lineActive,
        });
      if (error) { toast.error('建立失敗'); setSavingLine(false); return; }
      toast.success('LINE 設定已儲存');
    }
    setSavingLine(false);
    closeLineSettings();
  };

  const planTypeLabel = (t: string) => {
    switch (t) {
      case 'analyst_signal_l1': return '跟單派 L1';
      case 'analyst_signal_diag_l2': return '跟單派 L2';
      case 'mentor_weekly_journal': return '修煉派';
      default: return t;
    }
  };

  const getPlanTypeOptions = (expertRole: string) => {
    if (expertRole === 'advisor') {
      return [
        { value: 'analyst_signal_l1', label: '跟單派 L1（即時訊號）' },
        { value: 'analyst_signal_diag_l2', label: '跟單派 L2（訊號 + 持股健檢）' },
      ];
    }
    return [
      { value: 'mentor_weekly_journal', label: '修煉派（週記）' },
    ];
  };

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">分析師管理</h1>
            <p className="text-muted-foreground text-sm mt-1">管理所有分析師帳號、權限與方案</p>
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><UserPlus className="h-4 w-4 mr-2" />新增分析師</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>新增分析師帳號</DialogTitle></DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="analyst@example.com" type="email" />
                </div>
                <div className="space-y-2">
                  <Label>密碼</Label>
                  <Input value={password} onChange={e => setPassword(e.target.value)} placeholder="至少 6 位" type="password" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>姓名</Label>
                    <Input value={name} onChange={e => setName(e.target.value)} placeholder="趙彭博" />
                  </div>
                  <div className="space-y-2">
                    <Label>Slug（URL識別）</Label>
                    <Input value={slug} onChange={e => setSlug(e.target.value)} placeholder="zhao-pengbo" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>角色</Label>
                  <Select value={role} onValueChange={setRole}>
                    <SelectTrigger><SelectValue placeholder="選擇角色" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="advisor">投顧分析師</SelectItem>
                      <SelectItem value="mentor">實戰導師</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <Button variant="outline" onClick={() => setIsCreateOpen(false)}>取消</Button>
                  <Button onClick={handleCreate} disabled={creating}>{creating ? '建立中...' : '建立帳號'}</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardContent className="p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-muted-foreground">
                  <th className="p-4">分析師</th>
                  <th className="p-4">角色</th>
                  <th className="p-4">Slug</th>
                  <th className="p-4">狀態</th>
                  <th className="p-4">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="p-8 text-center text-muted-foreground text-sm">載入中...</td></tr>
                ) : experts.length === 0 ? (
                  <tr><td colSpan={5} className="p-8 text-center text-muted-foreground text-sm">尚無分析師</td></tr>
                ) : (
                  experts.map(exp => (
                    <tr key={exp.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <img src={exp.avatar_url || '/placeholder.svg'} alt={exp.name} className="h-8 w-8 rounded-full object-cover" />
                          <p className="font-medium text-sm">{exp.name}</p>
                        </div>
                      </td>
                      <td className="p-4">
                        <Badge variant={exp.role === 'advisor' ? 'default' : 'secondary'} className="text-xs">
                          {exp.role === 'advisor' ? '投顧分析師' : '實戰導師'}
                        </Badge>
                      </td>
                      <td className="p-4 text-sm text-muted-foreground">{exp.slug}</td>
                      <td className="p-4">
                        <Badge 
                          className={`text-xs ${exp.status === 'active' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}
                        >
                          {exp.status === 'active' ? '啟用中' : '已停用'}
                        </Badge>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openPlans(exp)}>
                            <Package className="h-3 w-3 mr-1" />方案
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openLineSettings(exp)}>
                            <MessageCircle className="h-3 w-3 mr-1" />LINE
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
                            <Link to={`/admin/${exp.slug}`}><Eye className="h-3 w-3 mr-1" />後台</Link>
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => toggleStatus(exp.id, exp.status)}>
                            {exp.status === 'active' ? '停用' : '啟用'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* Plan Management Dialog */}
      <Dialog open={!!planExpert} onOpenChange={(open) => { if (!open) closePlans(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{planExpert?.name} — 方案管理</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {plansLoading ? (
              <p className="text-sm text-muted-foreground text-center py-4">載入中...</p>
            ) : plans.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">尚無方案</p>
            ) : (
              <div className="space-y-3">
                {plans.map(plan => (
                  <div key={plan.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{plan.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {planTypeLabel(plan.plan_type)} · NT${plan.price_monthly?.toLocaleString()}/月
                        {plan.price_yearly ? ` · NT$${plan.price_yearly.toLocaleString()}/年` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      <span className="text-xs text-muted-foreground">{plan.is_active ? '上架' : '下架'}</span>
                      <Switch checked={plan.is_active} onCheckedChange={() => togglePlanActive(plan.id, plan.is_active)} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            <Button variant="outline" size="sm" className="w-full" onClick={() => setIsAddPlanOpen(true)}>
              + 新增方案
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Plan Dialog */}
      <Dialog open={isAddPlanOpen} onOpenChange={setIsAddPlanOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>新增方案 — {planExpert?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>方案名稱</Label>
              <Input value={planName} onChange={e => setPlanName(e.target.value)} placeholder="例：跟單派 基礎方案" />
            </div>
            <div className="space-y-2">
              <Label>方案類型</Label>
              <Select value={planType} onValueChange={setPlanType}>
                <SelectTrigger><SelectValue placeholder="選擇類型" /></SelectTrigger>
                <SelectContent>
                  {planExpert && getPlanTypeOptions(planExpert.role).map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>月費（NT$）</Label>
                <Input type="number" value={planMonthly} onChange={e => setPlanMonthly(e.target.value)} placeholder="1699" />
              </div>
              <div className="space-y-2">
                <Label>年費（NT$，選填）</Label>
                <Input type="number" value={planYearly} onChange={e => setPlanYearly(e.target.value)} placeholder="16990" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>描述（選填）</Label>
              <Textarea value={planDesc} onChange={e => setPlanDesc(e.target.value)} placeholder="方案描述..." rows={2} />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setIsAddPlanOpen(false)}>取消</Button>
              <Button onClick={handleAddPlan} disabled={savingPlan}>{savingPlan ? '建立中...' : '建立方案'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* LINE Channel Settings Dialog */}
      <Dialog open={!!lineExpert} onOpenChange={(open) => { if (!open) closeLineSettings(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{lineExpert?.name} — LINE 設定</DialogTitle>
          </DialogHeader>
          {lineLoading ? (
            <p className="text-sm text-muted-foreground text-center py-4">載入中...</p>
          ) : (
            <div className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label>Channel ID</Label>
                <Input value={lineChannelId} onChange={e => setLineChannelId(e.target.value)} placeholder="LINE Channel ID" />
              </div>
              <div className="space-y-2">
                <Label>Channel Access Token</Label>
                <Input value={lineToken} onChange={e => setLineToken(e.target.value)} placeholder="長期 Channel Access Token" type="password" />
              </div>
              <div className="space-y-2">
                <Label>顯示名稱（選填）</Label>
                <Input value={lineChannelName} onChange={e => setLineChannelName(e.target.value)} placeholder="例：趙彭博｜訊號通知" />
              </div>
              <div className="space-y-2">
                <Label>Bot Basic ID</Label>
                <Input value={lineOaId} onChange={e => setLineOaId(e.target.value)} placeholder="例：@zhao-pengbo" />
                <p className="text-xs text-muted-foreground">訂閱者透過此 ID 搜尋並加入官方帳號</p>
              </div>
              <div className="space-y-2">
                <Label>QR Code 網址（選填）</Label>
                <Input value={lineQrCodeUrl} onChange={e => setLineQrCodeUrl(e.target.value)} placeholder="https://qr-official.line.me/..." />
                <p className="text-xs text-muted-foreground">訂閱者可掃描 QR Code 加入官方帳號</p>
              </div>
              <div className="flex items-center justify-between">
                <Label>啟用推播</Label>
                <Switch checked={lineActive} onCheckedChange={setLineActive} />
              </div>
              <div className="text-xs text-muted-foreground">
                已綁定訂閱者：{lineBindingsCount} 人
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="outline" onClick={closeLineSettings}>取消</Button>
                <Button onClick={handleSaveLine} disabled={savingLine}>
                  {savingLine ? '儲存中...' : lineChannel ? '更新設定' : '儲存設定'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </CompanyLayout>
  );
};

export default CompanyAnalysts;
