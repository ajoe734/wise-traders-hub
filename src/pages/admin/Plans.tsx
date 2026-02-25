import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { Plus, Package, Send, Edit2 } from 'lucide-react';
import { toast } from 'sonner';

const statusLabels: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  draft: { label: '草稿', variant: 'outline' },
  pending: { label: '審核中', variant: 'secondary' },
  approved: { label: '已核准', variant: 'default' },
  rejected: { label: '已退回', variant: 'destructive' },
};

const planTypeLabels: Record<string, string> = {
  analyst_signal_l1: '即時訊號 L1',
  analyst_signal_diag_l2: '即時訊號+健檢 L2',
  mentor_weekly_journal: '實戰週記',
};

const AdminPlans = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const { user } = useAuth();
  const [plans, setPlans] = useState<any[]>([]);
  const [expert, setExpert] = useState<any>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // Form state
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formType, setFormType] = useState('');
  const [formMonthly, setFormMonthly] = useState('');
  const [formYearly, setFormYearly] = useState('');

  useEffect(() => {
    fetchData();
  }, [expertSlug]);

  const fetchData = async () => {
    if (!expertSlug) return;
    setLoading(true);
    const { data: exp } = await supabase.from('experts').select('*').eq('slug', expertSlug).single();
    setExpert(exp);
    if (exp) {
      const { data: p } = await supabase.from('expert_plans').select('*').eq('expert_id', exp.id).order('created_at', { ascending: false });
      setPlans(p || []);
    }
    setLoading(false);
  };

  const handleCreate = async () => {
    if (!expert || !formName || !formType) return;
    const { error } = await supabase.from('expert_plans').insert({
      expert_id: expert.id,
      name: formName,
      description: formDesc,
      plan_type: formType as any,
      price_monthly: parseInt(formMonthly) || 0,
      price_yearly: formYearly ? parseInt(formYearly) : null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('方案已建立');
    setIsCreateOpen(false);
    setFormName(''); setFormDesc(''); setFormType(''); setFormMonthly(''); setFormYearly('');
    fetchData();
  };

  const handleSubmitReview = async (planId: string) => {
    const { error } = await supabase.from('expert_plans').update({ review_status: 'pending' as any }).eq('id', planId);
    if (error) { toast.error(error.message); return; }
    toast.success('已送審');
    fetchData();
  };

  const isAdvisor = expert?.role === 'advisor';
  const allowedTypes = isAdvisor
    ? [{ value: 'analyst_signal_l1', label: '即時訊號 L1' }, { value: 'analyst_signal_diag_l2', label: '即時訊號+健檢 L2' }]
    : [{ value: 'mentor_weekly_journal', label: '實戰週記' }];

  if (loading) return <AdminLayout><div className="flex items-center justify-center h-64 text-muted-foreground">載入中...</div></AdminLayout>;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">方案管理</h1>
            <p className="text-muted-foreground text-sm mt-1">管理您的訂閱方案</p>
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className={cn(isAdvisor ? "bg-advisor hover:bg-advisor/90" : "bg-mentor hover:bg-mentor/90")}>
                <Plus className="h-4 w-4 mr-2" />新增方案
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>新增訂閱方案</DialogTitle></DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label>方案名稱</Label>
                  <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="例：即時策略訂閱" />
                </div>
                <div className="space-y-2">
                  <Label>方案描述</Label>
                  <Textarea value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="描述方案內容..." rows={3} />
                </div>
                <div className="space-y-2">
                  <Label>方案類型</Label>
                  <Select value={formType} onValueChange={setFormType}>
                    <SelectTrigger><SelectValue placeholder="選擇類型" /></SelectTrigger>
                    <SelectContent>
                      {allowedTypes.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>月費 (NT$)</Label>
                    <Input value={formMonthly} onChange={e => setFormMonthly(e.target.value)} type="number" placeholder="3980" />
                  </div>
                  <div className="space-y-2">
                    <Label>年費 (NT$)</Label>
                    <Input value={formYearly} onChange={e => setFormYearly(e.target.value)} type="number" placeholder="39800" />
                  </div>
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <Button variant="outline" onClick={() => setIsCreateOpen(false)}>取消</Button>
                  <Button onClick={handleCreate}>建立方案</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {plans.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Package className="h-8 w-8 mx-auto mb-3 opacity-50" />
              <p>尚未建立任何方案</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {plans.map(plan => {
              const si = statusLabels[plan.review_status] || statusLabels.draft;
              return (
                <Card key={plan.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">{plan.name}</h3>
                          <Badge variant={si.variant} className="text-xs">{si.label}</Badge>
                          {plan.is_active && <Badge className="text-xs bg-green-600">已上架</Badge>}
                        </div>
                        <p className="text-sm text-muted-foreground">{planTypeLabels[plan.plan_type]}</p>
                        {plan.description && <p className="text-sm text-muted-foreground">{plan.description}</p>}
                        <div className="flex gap-4 text-sm">
                          <span>月費：NT${plan.price_monthly?.toLocaleString()}</span>
                          {plan.price_yearly && <span>年費：NT${plan.price_yearly?.toLocaleString()}</span>}
                        </div>
                        {plan.review_status === 'rejected' && plan.review_note && (
                          <p className="text-sm text-destructive mt-1">退回理由：{plan.review_note}</p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {(plan.review_status === 'draft' || plan.review_status === 'rejected') && (
                          <Button size="sm" variant="outline" onClick={() => handleSubmitReview(plan.id)}>
                            <Send className="h-3 w-3 mr-1" />送審
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AdminLayout>
  );
};

export default AdminPlans;
