import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Plus, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { PermissionTooltip } from '@/components/admin/PermissionTooltip';
import type { AdminPlan, PlanType } from '@/hooks/admin/useAdminPlansData';
import { PLAN_TYPE_LABEL } from './constants';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editingPlan: AdminPlan | null;
  expertId: string;
  allowedTypes: PlanType[];
  isReadOnly: boolean;
  isCompanyAdmin: boolean;
  onSaved: () => void;
}

export function PlanFormDialog({
  open, onOpenChange, editingPlan, expertId, allowedTypes,
  isReadOnly, isCompanyAdmin, onSaved,
}: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [planType, setPlanType] = useState<PlanType>(allowedTypes[0]);
  const [priceMonthly, setPriceMonthly] = useState('');
  const [priceYearly, setPriceYearly] = useState('');
  const [features, setFeatures] = useState<string[]>([]);
  const [newFeature, setNewFeature] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  // 每次開啟 dialog 時用 editingPlan 重置表單（create 模式則重置為空白）
  useEffect(() => {
    if (!open) return;
    if (editingPlan) {
      setName(editingPlan.name);
      setDescription(editingPlan.description || '');
      setPlanType(editingPlan.plan_type);
      setPriceMonthly(String(editingPlan.price_monthly));
      setPriceYearly(editingPlan.price_yearly != null ? String(editingPlan.price_yearly) : '');
      setFeatures(
        Array.isArray(editingPlan.features)
          ? editingPlan.features.filter((f: any) => typeof f === 'string')
          : [],
      );
      setIsActive(editingPlan.is_active);
    } else {
      setName('');
      setDescription('');
      setPlanType(allowedTypes[0]);
      setPriceMonthly('');
      setPriceYearly('');
      setFeatures([]);
      setIsActive(true);
    }
    setNewFeature('');
  }, [open, editingPlan, allowedTypes]);

  const addFeature = () => {
    const v = newFeature.trim();
    if (v && !features.includes(v)) {
      setFeatures([...features, v]);
      setNewFeature('');
    }
  };

  const handleSave = async () => {
    if (!name.trim()) return toast.error('請輸入方案名稱');
    const m = Number(priceMonthly);
    if (!Number.isFinite(m) || m < 0) return toast.error('月費需為 0 或正整數');
    const y = priceYearly === '' ? null : Number(priceYearly);
    if (y != null && (!Number.isFinite(y) || y < m * 6)) {
      return toast.error('年費若填寫，需 ≥ 月費 × 6');
    }
    if (!allowedTypes.includes(planType)) return toast.error('此方案類型不適用您的角色');

    setSaving(true);
    const payload = {
      expert_id: expertId,
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
    if (res.error) return toast.error('儲存失敗：' + res.error.message);

    if (isCompanyAdmin) {
      toast.success(editingPlan ? '已更新方案' : '已建立方案');
    } else {
      toast.success(
        editingPlan
          ? '方案已送審，公司審核通過後即上架'
          : '方案已建立並送審，公司審核通過後即上架',
      );
    }
    onOpenChange(false);
    onSaved();
  };

  const roClass = cn(isReadOnly && 'bg-muted/50 cursor-not-allowed');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editingPlan ? '編輯方案' : '新增方案'}</DialogTitle>
          <DialogDescription>方案內容會即時反映於前台 Hero 區與訂閱卡片</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {isReadOnly && (
            <div className="rounded-md border border-muted-foreground/20 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              您目前以唯讀模式檢視此方案內容。僅限方案擁有者或公司管理員可編輯。
            </div>
          )}

          <div className="space-y-2">
            <Label>方案名稱</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：即時訊號通知" readOnly={isReadOnly} className={roClass} />
          </div>

          <div className="space-y-2">
            <Label>方案描述（選填）</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="一句話說明此方案的價值" readOnly={isReadOnly} className={roClass} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>方案類型</Label>
              <Select value={planType} onValueChange={(v) => setPlanType(v as PlanType)} disabled={isReadOnly}>
                <SelectTrigger className={roClass}><SelectValue /></SelectTrigger>
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
                <Switch checked={isActive} onCheckedChange={setIsActive} disabled={isReadOnly} />
                <span className="text-sm text-muted-foreground">{isActive ? '前台可見' : '前台隱藏'}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>月費（NT$）</Label>
              <Input type="number" inputMode="numeric" value={priceMonthly} onChange={(e) => setPriceMonthly(e.target.value)} placeholder="例：1980" readOnly={isReadOnly} className={roClass} />
            </div>
            <div className="space-y-2">
              <Label>年費（NT$，選填）</Label>
              <Input type="number" inputMode="numeric" value={priceYearly} onChange={(e) => setPriceYearly(e.target.value)} placeholder="≥ 月費 × 6" readOnly={isReadOnly} className={roClass} />
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
                  <PermissionTooltip disabled={isReadOnly}>
                    <Button type="button" variant="ghost" size="icon" disabled={isReadOnly} onClick={() => setFeatures(features.filter((_, idx) => idx !== i))}>
                      <X className="h-4 w-4" />
                    </Button>
                  </PermissionTooltip>
                </div>
              ))}
              <div className="flex gap-2">
                <Input value={newFeature} onChange={(e) => setNewFeature(e.target.value)} placeholder="例:即時訊號推播通知" onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addFeature())} readOnly={isReadOnly} className={roClass} />
                <PermissionTooltip disabled={isReadOnly}>
                  <Button type="button" variant="outline" onClick={addFeature} disabled={isReadOnly}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </PermissionTooltip>
              </div>
              <p className="text-xs text-muted-foreground">留空時前台顯示系統預設亮點清單</p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{isReadOnly ? '關閉' : '取消'}</Button>
          <PermissionTooltip disabled={isReadOnly}>
            <Button onClick={handleSave} disabled={saving || isReadOnly}>
              {saving ? '儲存中...' : (editingPlan ? '更新' : '建立')}
            </Button>
          </PermissionTooltip>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
