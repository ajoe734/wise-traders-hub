import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Plus, Pencil, X, Loader2, Sparkles, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';

type PlanType = 'analyst_signal_l1' | 'analyst_signal_diag_l2' | 'mentor_weekly_journal';

type ReviewStatus = 'draft' | 'pending' | 'approved' | 'rejected';

interface Plan {
  id: string;
  expert_id: string;
  name: string;
  description: string | null;
  plan_type: PlanType;
  price_monthly: number;
  price_yearly: number | null;
  features: any;
  is_active: boolean;
  review_status: ReviewStatus;
  review_note: string | null;
}

const REVIEW_STATUS_LABEL: Record<ReviewStatus, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-muted text-muted-foreground' },
  pending: { label: '待審核', cls: 'bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400' },
  approved: { label: '已核准', cls: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400' },
  rejected: { label: '已退回', cls: 'bg-destructive/15 text-destructive border-destructive/30' },
};

const PLAN_TYPE_LABEL: Record<PlanType, string> = {
  analyst_signal_l1: '即時訊號',
  analyst_signal_diag_l2: '訊號 + 持股健檢',
  mentor_weekly_journal: 'T+7 週記教學',
};

const ADVISOR_PLAN_TYPES: PlanType[] = ['analyst_signal_l1', 'analyst_signal_diag_l2'];
const MENTOR_PLAN_TYPES: PlanType[] = ['mentor_weekly_journal'];

const AdminPlans = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const { user, hasRole } = useAuth();
  const isCompanyAdmin = hasRole('company_admin');
  const isOwner = !!user?.expertSlug && user.expertSlug === expertSlug;
  const isReadOnly = isCompanyAdmin && !isOwner;

  const [expert, setExpert] = useState<{ id: string; role: 'advisor' | 'mentor' } | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [planType, setPlanType] = useState<PlanType>('analyst_signal_l1');
  const [priceMonthly, setPriceMonthly] = useState('');
  const [priceYearly, setPriceYearly] = useState('');
  const [features, setFeatures] = useState<string[]>([]);
  const [newFeature, setNewFeature] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const allowedTypes = expert?.role === 'mentor' ? MENTOR_PLAN_TYPES : ADVISOR_PLAN_TYPES;

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expertSlug]);

  const fetchAll = async () => {
    if (!expertSlug) return;
    setLoading(true);
    const { data: e } = await supabase
      .from('experts')
      .select('id, role')
      .eq('slug', expertSlug)
      .single();
    if (!e) { setLoading(false); return; }
    setExpert({ id: e.id, role: e.role as 'advisor' | 'mentor' });

    const { data: ps } = await supabase
      .from('expert_plans')
      .select('*')
      .eq('expert_id', e.id)
      .order('price_monthly');
    const list = (ps || []) as Plan[];
    setPlans(list);

    if (list.length > 0) {
      const ids = list.map(p => p.id);
      const { data: subs } = await supabase
        .from('member_subscriptions')
        .select('plan_id')
        .in('plan_id', ids)
        .eq('status', 'active');
      const c: Record<string, number> = {};
      ids.forEach(id => (c[id] = 0));
      (subs || []).forEach(s => { c[s.plan_id] = (c[s.plan_id] || 0) + 1; });
      setCounts(c);
    } else {
      setCounts({});
    }
    setLoading(false);
  };

  const openCreate = () => {
    setEditingPlan(null);
    setName('');
    setDescription('');
    setPlanType(allowedTypes[0]);
    setPriceMonthly('');
    setPriceYearly('');
    setFeatures([]);
    setNewFeature('');
    setIsActive(true);
    setDialogOpen(true);
  };

  const openEdit = (p: Plan) => {
    setEditingPlan(p);
    setName(p.name);
    setDescription(p.description || '');
    setPlanType(p.plan_type);
    setPriceMonthly(String(p.price_monthly));
    setPriceYearly(p.price_yearly != null ? String(p.price_yearly) : '');
    setFeatures(Array.isArray(p.features) ? p.features.filter((f: any) => typeof f === 'string') : []);
    setNewFeature('');
    setIsActive(p.is_active);
    setDialogOpen(true);
  };

  const addFeature = () => {
    const v = newFeature.trim();
    if (v && !features.includes(v)) {
      setFeatures([...features, v]);
      setNewFeature('');
    }
  };

  const handleSave = async () => {
    if (!expert) return;
    if (!name.trim()) { toast.error('請輸入方案名稱'); return; }
    const m = Number(priceMonthly);
    if (!Number.isFinite(m) || m < 0) { toast.error('月費需為 0 或正整數'); return; }
    const y = priceYearly === '' ? null : Number(priceYearly);
    if (y != null && (!Number.isFinite(y) || y < m * 6)) {
      toast.error('年費若填寫，需 ≥ 月費 × 6');
      return;
    }
    if (!allowedTypes.includes(planType)) {
      toast.error('此方案類型不適用您的角色');
      return;
    }

    setSaving(true);
    const payload = {
      expert_id: expert.id,
      name: name.trim(),
      description: description.trim() || null,
      plan_type: planType,
      price_monthly: Math.round(m),
      price_yearly: y != null ? Math.round(y) : null,
      features: features as any,
      is_active: isActive,
    };

    const res = editingPlan
      ? await supabase.from('expert_plans').update(payload).eq('id', editingPlan.id)
      : await supabase.from('expert_plans').insert(payload);

    setSaving(false);
    if (res.error) { toast.error('儲存失敗：' + res.error.message); return; }
    if (isCompanyAdmin) {
      toast.success(editingPlan ? '已更新方案' : '已建立方案');
    } else {
      toast.success(
        editingPlan
          ? '方案已送審，公司審核通過後即上架'
          : '方案已建立並送審，公司審核通過後即上架',
      );
    }
    setDialogOpen(false);
    fetchAll();
  };

  const toggleActive = async (p: Plan) => {
    const { error } = await supabase
      .from('expert_plans')
      .update({ is_active: !p.is_active })
      .eq('id', p.id);
    if (error) { toast.error('切換失敗：' + error.message); return; }
    toast.success(!p.is_active ? '方案已上架' : '方案已下架');
    fetchAll();
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />載入中...
        </div>
      </AdminLayout>
    );
  }

  if (!expert) return <AdminLayout><div /></AdminLayout>;

  const isAdvisor = expert.role === 'advisor';

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Wallet className="h-6 w-6" /> 訂閱方案管理
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              管理前台展示的訂閱方案、定價與亮點
            </p>
          </div>
          {!isReadOnly && (
            <Button
              onClick={openCreate}
              className={cn(isAdvisor ? 'bg-advisor hover:bg-advisor/90' : 'bg-mentor hover:bg-mentor/90')}
            >
              <Plus className="h-4 w-4 mr-2" />新增方案
            </Button>
          )}
        </div>

        <Card>
          <CardContent className="p-0">
            {plans.length === 0 ? (
              <div className="p-10 text-center text-muted-foreground">
                尚未建立任何方案，請點擊右上「新增方案」
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>名稱</TableHead>
                    <TableHead>類型</TableHead>
                    <TableHead className="text-right">月費</TableHead>
                    <TableHead className="text-right">年費</TableHead>
                    <TableHead className="text-center">訂閱人數</TableHead>
                    <TableHead className="text-center">審核狀態</TableHead>
                    <TableHead className="text-center">啟用</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plans.map((p) => {
                    const rs = REVIEW_STATUS_LABEL[p.review_status] || REVIEW_STATUS_LABEL.draft;
                    return (
                      <TableRow key={p.id}>
                        <TableCell>
                          <div className="font-medium">{p.name}</div>
                          {p.description && (
                            <div className="text-xs text-muted-foreground line-clamp-1">{p.description}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">
                            {PLAN_TYPE_LABEL[p.plan_type]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          NT$ {p.price_monthly.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {p.price_yearly != null ? `NT$ ${p.price_yearly.toLocaleString()}` : '—'}
                        </TableCell>
                        <TableCell className="text-center tabular-nums">
                          {counts[p.id] || 0}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge className={cn('text-[11px] border', rs.cls)} variant="outline">
                            {rs.label}
                          </Badge>
                          {p.review_status === 'rejected' && p.review_note && (
                            <div className="text-[10px] text-destructive mt-1 max-w-[160px] mx-auto line-clamp-2">
                              退回原因：{p.review_note}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch
                            checked={p.is_active}
                            onCheckedChange={() => !isReadOnly && toggleActive(p)}
                            disabled={isReadOnly}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          {!isReadOnly && (
                            <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {!isReadOnly && (
          <p className="text-xs text-muted-foreground">
            提示：方案不可永久刪除（保留歷史紀錄）。如需停售請切換「啟用」開關。「啟用」需配合「審核狀態 = 已核准」才會在前台上架。已有訂閱者的方案改價後，現有訂閱維持原價直到下次續扣。
          </p>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingPlan ? '編輯方案' : '新增方案'}</DialogTitle>
            <DialogDescription>
              方案內容會即時反映於前台 Hero 區與訂閱卡片
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>方案名稱</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：即時訊號通知" />
            </div>

            <div className="space-y-2">
              <Label>方案描述（選填）</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="一句話說明此方案的價值"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>方案類型</Label>
                <Select value={planType} onValueChange={(v) => setPlanType(v as PlanType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {allowedTypes.map((t) => (
                      <SelectItem key={t} value={t}>{PLAN_TYPE_LABEL[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>啟用狀態</Label>
                <div className="flex items-center h-9 gap-2">
                  <Switch checked={isActive} onCheckedChange={setIsActive} />
                  <span className="text-sm text-muted-foreground">
                    {isActive ? '前台可見' : '前台隱藏'}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>月費（NT$）</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={priceMonthly}
                  onChange={(e) => setPriceMonthly(e.target.value)}
                  placeholder="例：1980"
                />
              </div>
              <div className="space-y-2">
                <Label>年費（NT$，選填）</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={priceYearly}
                  onChange={(e) => setPriceYearly(e.target.value)}
                  placeholder="≥ 月費 × 6"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <Sparkles className="h-3.5 w-3.5" /> 方案亮點
              </Label>
              <div className="space-y-2">
                {features.map((f, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="flex-1 px-3 py-2 rounded-md border bg-muted/30 text-sm">{f}</div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setFeatures(features.filter((_, idx) => idx !== i))}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Input
                    value={newFeature}
                    onChange={(e) => setNewFeature(e.target.value)}
                    placeholder="例：即時訊號推播通知"
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addFeature())}
                  />
                  <Button type="button" variant="outline" onClick={addFeature}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  留空時前台顯示系統預設亮點清單
                </p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? '儲存中...' : (editingPlan ? '更新' : '建立')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
};

export default AdminPlans;
