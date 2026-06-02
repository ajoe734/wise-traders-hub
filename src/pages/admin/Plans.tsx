import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Plus, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PermissionTooltip } from '@/components/admin/PermissionTooltip';
import {
  useAdminPlansData,
  type AdminPlan,
} from '@/hooks/admin/useAdminPlansData';
import { PlansTable } from '@/pages/_adminPlans/PlansTable';
import { PlanFormDialog } from '@/pages/_adminPlans/PlanFormDialog';
import {
  ADVISOR_PLAN_TYPES,
  MENTOR_PLAN_TYPES,
} from '@/pages/_adminPlans/constants';

const AdminPlans = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const { user, hasRole } = useAuth();
  const isCompanyAdmin = hasRole('company_admin');
  const isOwner = !!user?.expertSlug && user.expertSlug === expertSlug;
  const isReadOnly = !isCompanyAdmin && !isOwner;

  const { expert, plans, counts, loading, invalidate } = useAdminPlansData(expertSlug);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<AdminPlan | null>(null);

  const allowedTypes = useMemo(
    () => (expert?.role === 'mentor' ? MENTOR_PLAN_TYPES : ADVISOR_PLAN_TYPES),
    [expert?.role],
  );

  const openCreate = () => {
    setEditingPlan(null);
    setDialogOpen(true);
  };
  const openEdit = (p: AdminPlan) => {
    setEditingPlan(p);
    setDialogOpen(true);
  };

  const toggleActive = async (p: AdminPlan) => {
    const { error } = await supabase
      .from('expert_plans')
      .update({ is_active: !p.is_active })
      .eq('id', p.id);
    if (error) return toast.error('切換失敗：' + error.message);
    toast.success(!p.is_active ? '方案已上架' : '方案已下架');
    invalidate();
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
          <PermissionTooltip disabled={isReadOnly}>
            <Button
              onClick={openCreate}
              disabled={isReadOnly}
              className={cn(isAdvisor ? 'bg-advisor hover:bg-advisor/90' : 'bg-mentor hover:bg-mentor/90')}
            >
              <Plus className="h-4 w-4 mr-2" />新增方案
            </Button>
          </PermissionTooltip>
        </div>

        <PlansTable
          plans={plans}
          counts={counts}
          isReadOnly={isReadOnly}
          onEdit={openEdit}
          onToggleActive={toggleActive}
        />

        {!isReadOnly && (
          <p className="text-xs text-muted-foreground">
            提示：方案不可永久刪除（保留歷史紀錄）。如需停售請切換「啟用」開關。「啟用」需配合「審核狀態 = 已核准」才會在前台上架。已有訂閱者的方案改價後，現有訂閱維持原價直到下次續扣。
          </p>
        )}
      </div>

      {expert && (
        <PlanFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          editingPlan={editingPlan}
          expertId={expert.id}
          allowedTypes={allowedTypes}
          isReadOnly={isReadOnly}
          isCompanyAdmin={isCompanyAdmin}
          onSaved={invalidate}
        />
      )}
    </AdminLayout>
  );
};

export default AdminPlans;
