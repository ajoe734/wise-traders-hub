import { useState, useEffect, useMemo } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Edit, Search, Package } from 'lucide-react';
import { toast } from 'sonner';

const planTypeLabels: Record<string, string> = {
  analyst_signal_l1: '分析師即時策略訂閱',
  analyst_signal_diag_l2: '分析師策略＋持股健檢',
  mentor_weekly_journal: '實戰導師週記訂閱',
};

const reviewStatusLabels: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  draft: { label: '草稿', variant: 'outline' },
  pending: { label: '待審核', variant: 'secondary' },
  approved: { label: '已核准', variant: 'default' },
  rejected: { label: '已退回', variant: 'destructive' },
};

const CompanyPlans = () => {
  const [plans, setPlans] = useState<any[]>([]);
  const [experts, setExperts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editPlan, setEditPlan] = useState<any>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    const [{ data: p }, { data: e }] = await Promise.all([
      supabase.from('expert_plans').select('*, experts(name, role)').order('created_at', { ascending: false }),
      supabase.from('experts').select('id, name, role, slug').order('name'),
    ]);
    setPlans(p || []);
    setExperts(e || []);
    setLoading(false);
  };

  const filtered = plans.filter(p => {
    if (!search) return true;
    const q = search.toLowerCase();
    return p.name?.toLowerCase().includes(q) || p.experts?.name?.toLowerCase().includes(q);
  });

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">方案管理</h1>
            <p className="text-muted-foreground text-sm mt-1">建立、編輯與審核訂閱方案</p>
          </div>
          <Button size="sm" className="bg-company hover:bg-company/90 text-white" onClick={() => { setEditPlan(null); setIsCreateOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />新增方案
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <Package className="h-5 w-5 text-muted-foreground" />
              <div><div className="text-2xl font-bold">{plans.length}</div><div className="text-xs text-muted-foreground">總方案數</div></div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <Package className="h-5 w-5 text-green-500" />
              <div><div className="text-2xl font-bold">{plans.filter(p => p.is_active).length}</div><div className="text-xs text-muted-foreground">已上架</div></div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <Package className="h-5 w-5 text-yellow-500" />
              <div><div className="text-2xl font-bold">{plans.filter(p => p.review_status === 'pending').length}</div><div className="text-xs text-muted-foreground">待審核</div></div>
            </CardContent>
          </Card>
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="搜尋方案或分析師..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>

        <Card>
          <CardContent className="p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-muted-foreground">
                  <th className="p-4">方案名稱</th>
                  <th className="p-4">分析師</th>
                  <th className="p-4">類型</th>
                  <th className="p-4">月費</th>
                  <th className="p-4">審核狀態</th>
                  <th className="p-4">上架</th>
                  <th className="p-4">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="p-8 text-center text-muted-foreground text-sm">載入中...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7} className="p-8 text-center text-muted-foreground text-sm">尚無方案</td></tr>
                ) : (
                  filtered.map(plan => {
                    const rs = reviewStatusLabels[plan.review_status] || reviewStatusLabels.draft;
                    return (
                      <tr key={plan.id} className="border-b last:border-0 hover:bg-muted/50">
                        <td className="p-4 font-medium text-sm">{plan.name}</td>
                        <td className="p-4 text-sm">{plan.experts?.name || '-'}</td>
                        <td className="p-4"><Badge variant="outline" className="text-xs">{planTypeLabels[plan.plan_type] || plan.plan_type}</Badge></td>
                        <td className="p-4 text-sm">NT${plan.price_monthly?.toLocaleString()}</td>
                        <td className="p-4"><Badge variant={rs.variant} className="text-xs">{rs.label}</Badge></td>
                        <td className="p-4">
                          <Badge variant={plan.is_active ? 'default' : 'outline'} className="text-xs">
                            {plan.is_active ? '上架' : '下架'}
                          </Badge>
                        </td>
                        <td className="p-4">
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setEditPlan(plan); setIsCreateOpen(true); }}>
                            <Edit className="h-3 w-3 mr-1" />編輯
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <PlanFormDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        plan={editPlan}
        experts={experts}
        onSaved={() => { setIsCreateOpen(false); fetchData(); }}
      />
    </CompanyLayout>
  );
};

function PlanFormDialog({ open, onOpenChange, plan, experts, onSaved }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  plan: any;
  experts: any[];
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [expertId, setExpertId] = useState('');
  const [planType, setPlanType] = useState('');
  const [priceMonthly, setPriceMonthly] = useState('');
  const [priceYearly, setPriceYearly] = useState('');
  const [description, setDescription] = useState('');
  const [reviewStatus, setReviewStatus] = useState('draft');
  const [reviewNote, setReviewNote] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (plan) {
      setName(plan.name || '');
      setExpertId(plan.expert_id || '');
      setPlanType(plan.plan_type || '');
      setPriceMonthly(String(plan.price_monthly || ''));
      setPriceYearly(plan.price_yearly != null ? String(plan.price_yearly) : '');
      setDescription(plan.description || '');
      setReviewStatus(plan.review_status || 'draft');
      setReviewNote(plan.review_note || '');
      setIsActive(plan.is_active || false);
    } else {
      setName(''); setExpertId(''); setPlanType(''); setPriceMonthly(''); setPriceYearly('');
      setDescription(''); setReviewStatus('draft'); setReviewNote(''); setIsActive(false);
    }
  }, [plan, open]);

  const handleSave = async () => {
    if (!name || !expertId || !planType) { toast.error('請填寫必填欄位'); return; }
    setSaving(true);
    const payload = {
      name,
      expert_id: expertId,
      plan_type: planType as any,
      price_monthly: parseInt(priceMonthly) || 0,
      price_yearly: priceYearly ? parseInt(priceYearly) : null,
      description: description || null,
      review_status: reviewStatus as any,
      review_note: reviewNote || null,
      is_active: isActive,
    };

    if (plan?.id) {
      const { error } = await supabase.from('expert_plans').update(payload).eq('id', plan.id);
      if (error) { toast.error('更新失敗：' + error.message); setSaving(false); return; }
      toast.success('方案已更新');
    } else {
      const { error } = await supabase.from('expert_plans').insert(payload);
      if (error) { toast.error('建立失敗：' + error.message); setSaving(false); return; }
      toast.success('方案已建立');
    }
    setSaving(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{plan ? '編輯方案' : '新增方案'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2 overflow-y-auto flex-1">
          <div className="space-y-2">
            <Label>方案名稱 *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="例：分析師即時策略訂閱" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>分析師 *</Label>
              <Select value={expertId} onValueChange={setExpertId}>
                <SelectTrigger><SelectValue placeholder="選擇" /></SelectTrigger>
                <SelectContent>
                  {experts.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>方案類型 *</Label>
              <Select value={planType} onValueChange={setPlanType}>
                <SelectTrigger><SelectValue placeholder="選擇" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="analyst_signal_l1">即時策略訂閱</SelectItem>
                  <SelectItem value="analyst_signal_diag_l2">策略＋持股健檢</SelectItem>
                  <SelectItem value="mentor_weekly_journal">週記訂閱</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>月費（NT$）</Label>
              <Input type="number" value={priceMonthly} onChange={e => setPriceMonthly(e.target.value)} placeholder="1699" />
            </div>
            <div className="space-y-2">
              <Label>年費（NT$，選填）</Label>
              <Input type="number" value={priceYearly} onChange={e => setPriceYearly(e.target.value)} placeholder="16990" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>方案說明</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="方案包含的服務內容..." rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>審核狀態</Label>
              <Select value={reviewStatus} onValueChange={setReviewStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">草稿</SelectItem>
                  <SelectItem value="pending">待審核</SelectItem>
                  <SelectItem value="approved">已核准</SelectItem>
                  <SelectItem value="rejected">已退回</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>上架狀態</Label>
              <div className="flex items-center h-9 gap-2">
                <Switch checked={isActive} onCheckedChange={setIsActive} />
                <span className="text-sm">{isActive ? '上架中' : '下架'}</span>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <Label>審核備註</Label>
            <Textarea value={reviewNote} onChange={e => setReviewNote(e.target.value)} placeholder="審核意見..." rows={2} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? '儲存中...' : plan ? '更新方案' : '建立方案'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default CompanyPlans;
