import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { logAdminAction } from '@/lib/auditLog';
import type { PlanRow, OverrideRow, DefaultRule, SplitForm } from '@/pages/_companyPlans/types';

/**
 * Single-snapshot query + 6 mutations for company/Plans page.
 * - 過濾（outerTab/tab）為純前端，不進 queryKey，30s staleTime 內切 tab 不重抓
 * - 所有 mutation 完成後 invalidate ['company','plans']，detail sheet 維持掛載刷新
 */
export function useCompanyPlans() {
  const queryClient = useQueryClient();
  const queryKey = ['company', 'plans'] as const;

  const { data, isFetching } = useQuery({
    queryKey,
    queryFn: async () => {
      const [plansRes, overridesRes, settingsRes, crossRes] = await Promise.all([
        supabase
          .from('expert_plans')
          .select('*, experts:expert_id(name, slug, role)')
          .order('created_at', { ascending: false }),
        supabase
          .from('plan_split_overrides')
          .select('id, plan_id, pct_platform, pct_expert, is_active, notes'),
        (supabase.from as any)('payment_settings_safe').select('key, value').eq('key', 'split_standard').maybeSingle(),
        (supabase.from as any)('payment_settings_safe').select('value').eq('key', 'cross_discounts').maybeSingle(),
      ]);

      if (plansRes.error) toast.error('載入方案失敗：' + plansRes.error.message);

      const overrideMap = new Map<string, OverrideRow>();
      (overridesRes.data || []).forEach((o: any) => overrideMap.set(o.plan_id, {
        id: o.id, pct_platform: o.pct_platform, pct_expert: o.pct_expert,
        is_active: o.is_active, notes: o.notes,
      }));

      const merged: PlanRow[] = (plansRes.data || []).map((p: any) => ({
        ...p,
        override: overrideMap.get(p.id) ?? null,
      }));

      const s = settingsRes.data?.value as any;
      const defaultRule: DefaultRule = s
        ? { pct_platform: s.pct_platform ?? 55, pct_expert: s.pct_expert ?? 45 }
        : { pct_platform: 55, pct_expert: 45 };

      const crossMap = (crossRes.data?.value as Record<string, number>) || {};

      return { rows: merged, defaultRule, crossMap };
    },
    staleTime: 30_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const approve = async (p: PlanRow): Promise<boolean> => {
    const { error } = await supabase
      .from('expert_plans')
      .update({ review_status: 'approved', review_note: null })
      .eq('id', p.id);
    if (error) { toast.error('核准失敗：' + error.message); return false; }
    await logAdminAction({
      action: 'plan.approve',
      targetType: 'expert_plan',
      targetId: p.id,
      detail: {
        before: { review_status: p.review_status },
        after: { review_status: 'approved' },
        context: { plan_name: p.name, expert_name: p.experts?.name },
      },
    });
    toast.success('已核准方案');
    invalidate();
    return true;
  };

  const reject = async (current: PlanRow, rejectNote: string): Promise<boolean> => {
    if (!rejectNote.trim()) { toast.error('請填寫退回原因'); return false; }
    const { error } = await supabase
      .from('expert_plans')
      .update({ review_status: 'rejected', review_note: rejectNote.trim() })
      .eq('id', current.id);
    if (error) { toast.error('退回失敗：' + error.message); return false; }
    await logAdminAction({
      action: 'plan.reject',
      targetType: 'expert_plan',
      targetId: current.id,
      detail: {
        before: { review_status: current.review_status },
        after: { review_status: 'rejected' },
        context: { plan_name: current.name, expert_name: current.experts?.name, reason: rejectNote.trim() },
      },
    });
    toast.success('已退回方案');
    invalidate();
    return true;
  };

  const toggleActive = async (p: PlanRow, next: boolean): Promise<boolean> => {
    const { error } = await supabase
      .from('expert_plans')
      .update({ is_active: next })
      .eq('id', p.id);
    if (error) { toast.error('更新失敗：' + error.message); return false; }
    await logAdminAction({
      action: 'plan.toggle_active',
      targetType: 'expert_plan',
      targetId: p.id,
      detail: {
        before: { is_active: p.is_active },
        after: { is_active: next },
        context: { plan_name: p.name, expert_name: p.experts?.name },
      },
    });
    toast.success(next ? '已上架' : '已下架');
    invalidate();
    return true;
  };

  const saveSplit = async (current: PlanRow, splitForm: SplitForm): Promise<boolean> => {
    if (splitForm.pct_platform + splitForm.pct_expert !== 100) {
      toast.error('比例錯誤：平台 + 專家需為 100%');
      return false;
    }
    const payload = {
      plan_id: current.id,
      pct_platform: splitForm.pct_platform,
      pct_expert: splitForm.pct_expert,
      is_active: splitForm.is_active,
      notes: splitForm.notes || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from('plan_split_overrides')
      .upsert(payload, { onConflict: 'plan_id' });
    if (error) { toast.error('儲存失敗：' + error.message); return false; }
    await logAdminAction({
      action: 'plan.split_override_upsert',
      targetType: 'plan_split_overrides',
      targetId: current.id,
      detail: {
        before: current.override ?? null,
        after: { pct_platform: splitForm.pct_platform, pct_expert: splitForm.pct_expert, is_active: splitForm.is_active, notes: splitForm.notes || null },
        context: { plan_name: current.name },
      },
    });
    toast.success('已儲存分潤覆寫');
    invalidate();
    return true;
  };

  const removeSplit = async (p: PlanRow, defaultRule: DefaultRule): Promise<boolean> => {
    if (!p.override) return false;
    if (!confirm(`確定刪除「${p.name}」的分潤覆寫？刪除後將回退到全站預設 ${defaultRule.pct_platform}/${defaultRule.pct_expert}。`)) return false;
    const overrideSnapshot = p.override;
    const { error } = await supabase.from('plan_split_overrides').delete().eq('id', p.override.id);
    if (error) { toast.error('刪除失敗：' + error.message); return false; }
    await logAdminAction({
      action: 'plan.split_override_remove',
      targetType: 'plan_split_overrides',
      targetId: p.id,
      detail: { before: overrideSnapshot, after: null, context: { plan_name: p.name } },
    });
    toast.success('已刪除覆寫');
    invalidate();
    return true;
  };

  const saveCross = async (
    cross: Record<string, number>,
    crossOriginal: Record<string, number>,
  ): Promise<boolean> => {
    const userId = (await supabase.auth.getUser()).data.user?.id;
    const { error } = await supabase
      .from('payment_settings')
      .upsert(
        { key: 'cross_discounts', value: cross, updated_by: userId, updated_at: new Date().toISOString() },
        { onConflict: 'key' },
      );
    if (error) { toast.error('儲存失敗：' + error.message); return false; }
    await logAdminAction({
      action: 'plan.cross_discount_update',
      targetType: 'payment_settings',
      detail: { before: crossOriginal, after: cross },
    });
    toast.success('已儲存跨產品折扣');
    invalidate();
    return true;
  };

  return {
    data,
    isFetching,
    approve,
    reject,
    toggleActive,
    saveSplit,
    removeSplit,
    saveCross,
  };
}
