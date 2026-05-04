import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from '@/components/ui/sheet';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2, Pencil, Trash2, Plus, HeartPulse } from 'lucide-react';
import { logAdminAction } from '@/lib/auditLog';

interface CheckupPlanRow {
  id: string;
  tier: 'basic' | 'pro' | string;
  name: string;
  description: string | null;
  price_monthly: number;
  price_yearly: number;
  monthly_quota: number;
  quota_period: 'month' | 'week' | string;
  features: any;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

interface FormState {
  id?: string;
  tier: string;
  name: string;
  description: string;
  price_monthly: number;
  price_yearly: number;
  monthly_quota: number;
  quota_period: string;
  features_text: string;
  sort_order: number;
  is_active: boolean;
}

const emptyForm: FormState = {
  tier: 'basic',
  name: '',
  description: '',
  price_monthly: 0,
  price_yearly: 0,
  monthly_quota: 1,
  quota_period: 'month',
  features_text: '',
  sort_order: 0,
  is_active: true,
};

export default function CheckupPlansAdmin() {
  const [rows, setRows] = useState<CheckupPlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('checkup_plans')
      .select('*')
      .order('sort_order');
    if (error) {
      toast.error('讀取失敗：' + error.message);
    } else {
      setRows((data ?? []) as any);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setForm(emptyForm);
    setEditOpen(true);
  };

  const openEdit = (r: CheckupPlanRow) => {
    setForm({
      id: r.id,
      tier: r.tier,
      name: r.name,
      description: r.description ?? '',
      price_monthly: r.price_monthly,
      price_yearly: r.price_yearly,
      monthly_quota: r.monthly_quota,
      quota_period: r.quota_period,
      features_text: Array.isArray(r.features)
        ? r.features.filter((f: any) => typeof f === 'string').join('\n')
        : '',
      sort_order: r.sort_order,
      is_active: r.is_active,
    });
    setEditOpen(true);
  };

  const toggleActive = async (r: CheckupPlanRow, next: boolean) => {
    const { error } = await supabase
      .from('checkup_plans')
      .update({ is_active: next })
      .eq('id', r.id);
    if (error) {
      toast.error('更新失敗：' + error.message);
      return;
    }
    await logAdminAction(next ? 'checkup_plan.activate' : 'checkup_plan.deactivate', r.id, { name: r.name });
    toast.success(next ? '已上架' : '已下架');
    load();
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error('請輸入名稱'); return; }
    if (form.price_monthly < 0 || form.price_yearly < 0) { toast.error('價格不可為負'); return; }
    setSaving(true);
    const features = form.features_text
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);
    const payload = {
      tier: form.tier,
      name: form.name.trim(),
      description: form.description.trim() || null,
      price_monthly: form.price_monthly,
      price_yearly: form.price_yearly,
      monthly_quota: form.monthly_quota,
      quota_period: form.quota_period,
      features,
      sort_order: form.sort_order,
      is_active: form.is_active,
    };
    let error;
    if (form.id) {
      ({ error } = await supabase.from('checkup_plans').update(payload).eq('id', form.id));
    } else {
      ({ error } = await supabase.from('checkup_plans').insert(payload));
    }
    setSaving(false);
    if (error) {
      toast.error('儲存失敗：' + error.message);
      return;
    }
    await logAdminAction(form.id ? 'checkup_plan.update' : 'checkup_plan.create', form.id ?? null, { name: payload.name, tier: payload.tier });
    toast.success(form.id ? '已更新' : '已新增');
    setEditOpen(false);
    load();
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    // Block deletion if active subscriptions exist
    const { count, error: cntErr } = await supabase
      .from('checkup_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('plan_id', deleteId)
      .eq('status', 'active');
    if (cntErr) {
      setDeleting(false);
      toast.error('檢查訂閱失敗：' + cntErr.message);
      return;
    }
    if ((count ?? 0) > 0) {
      setDeleting(false);
      toast.error(`此方案仍有 ${count} 位有效訂閱者，請先下架不要刪除`);
      return;
    }
    const target = rows.find(r => r.id === deleteId);
    const { error } = await supabase.from('checkup_plans').delete().eq('id', deleteId);
    setDeleting(false);
    if (error) {
      toast.error('刪除失敗：' + error.message);
      return;
    }
    await logAdminAction('checkup_plan.delete', deleteId, { name: target?.name });
    toast.success('已刪除');
    setDeleteId(null);
    load();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h3 className="font-semibold flex items-center gap-2">
                <HeartPulse className="h-4 w-4 text-primary" />
                持股健檢方案
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                管理健檢 Basic / Pro 等方案的價格、配額、上下架狀態。
              </p>
            </div>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5 mr-1" />新增方案
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />載入中…
            </div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground text-sm">尚無健檢方案</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {rows.map(r => (
                <div key={r.id} className="rounded-lg border p-4 space-y-3 bg-card">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{r.name}</span>
                        <Badge variant="outline" className="text-[10px] uppercase">{r.tier}</Badge>
                      </div>
                      {r.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.description}</p>
                      )}
                    </div>
                    <Switch
                      checked={r.is_active}
                      onCheckedChange={(v) => toggleActive(r, v)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <div className="text-[11px] text-muted-foreground">月費</div>
                      <div className="tabular-nums font-medium">NT$ {r.price_monthly.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-muted-foreground">年費</div>
                      <div className="tabular-nums font-medium">NT$ {r.price_yearly.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-muted-foreground">配額</div>
                      <div className="tabular-nums font-medium">
                        {r.monthly_quota} 次 / {r.quota_period === 'week' ? '週' : '月'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-muted-foreground">排序</div>
                      <div className="tabular-nums font-medium">{r.sort_order}</div>
                    </div>
                  </div>
                  {Array.isArray(r.features) && r.features.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {r.features.filter((f: any) => typeof f === 'string').slice(0, 6).map((f: string, i: number) => (
                        <Badge key={i} variant="secondary" className="text-[10px]">{f}</Badge>
                      ))}
                      {r.features.length > 6 && (
                        <span className="text-[10px] text-muted-foreground">+{r.features.length - 6}</span>
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    <Button size="sm" variant="outline" onClick={() => openEdit(r)}>
                      <Pencil className="h-3.5 w-3.5 mr-1" />編輯
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteId(r.id)}>
                      <Trash2 className="h-3.5 w-3.5 mr-1" />刪除
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Sheet */}
      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{form.id ? '編輯健檢方案' : '新增健檢方案'}</SheetTitle>
            <SheetDescription>所有欄位均為必填，價格單位為新台幣。</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">層級 (tier)</Label>
                <Select value={form.tier} onValueChange={(v) => setForm(f => ({ ...f, tier: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="basic">basic</SelectItem>
                    <SelectItem value="pro">pro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">排序</Label>
                <Input type="number" value={form.sort_order}
                  onChange={e => setForm(f => ({ ...f, sort_order: Number(e.target.value) }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">名稱</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">描述</Label>
              <Textarea rows={2} value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">月費 (NT$)</Label>
                <Input type="number" min={0} value={form.price_monthly}
                  onChange={e => setForm(f => ({ ...f, price_monthly: Number(e.target.value) }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">年費 (NT$)</Label>
                <Input type="number" min={0} value={form.price_yearly}
                  onChange={e => setForm(f => ({ ...f, price_yearly: Number(e.target.value) }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">配額次數</Label>
                <Input type="number" min={0} value={form.monthly_quota}
                  onChange={e => setForm(f => ({ ...f, monthly_quota: Number(e.target.value) }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">配額週期</Label>
                <Select value={form.quota_period} onValueChange={(v) => setForm(f => ({ ...f, quota_period: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">每月</SelectItem>
                    <SelectItem value="week">每週</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">特色（每行一條）</Label>
              <Textarea rows={5} value={form.features_text}
                placeholder={'例如：\n每月 22 次完整健檢\n優先客服支援'}
                onChange={e => setForm(f => ({ ...f, features_text: e.target.value }))} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label className="text-sm">上架狀態</Label>
                <p className="text-xs text-muted-foreground">關閉後此方案不會在購買頁顯示。</p>
              </div>
              <Switch checked={form.is_active}
                onCheckedChange={(v) => setForm(f => ({ ...f, is_active: v }))} />
            </div>
          </div>
          <SheetFooter className="mt-6">
            <Button variant="ghost" onClick={() => setEditOpen(false)} disabled={saving}>取消</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              儲存
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delete dialog */}
      <Dialog open={!!deleteId} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>確認刪除？</DialogTitle>
            <DialogDescription>
              刪除後將無法復原，且若仍有有效訂閱者將會被擋下。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteId(null)} disabled={deleting}>取消</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              確認刪除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
