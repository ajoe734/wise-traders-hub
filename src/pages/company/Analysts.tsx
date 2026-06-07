import { SEO } from '@/components/SEO';
import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { logAdminAction } from '@/lib/auditLog';
import { useSessionString, useSessionBool } from '@/hooks/useSessionState';
import { useLineChannelEditor } from '@/hooks/company/useLineChannelEditor';
import { useAnalystAccount } from '@/hooks/company/useAnalystAccount';
import { AnalystsTable } from '@/pages/_companyAnalysts/AnalystsTable';
import { CreateAnalystDialog } from '@/pages/_companyAnalysts/CreateAnalystDialog';
import { LineChannelDialog } from '@/pages/_companyAnalysts/LineChannelDialog';
import { AccountCredentialsDialog } from '@/pages/_companyAnalysts/AccountCredentialsDialog';

const CompanyAnalysts = () => {
  const queryClient = useQueryClient();
  const { data: experts = [], isLoading: loading } = useQuery({
    queryKey: ['company-experts'],
    queryFn: async () => {
      const { data } = await supabase.from('experts').select('*').order('created_at', { ascending: false });
      return data || [];
    },
    staleTime: 30_000,
  });
  const refetchExperts = () => queryClient.invalidateQueries({ queryKey: ['company-experts'] });
  const setExperts = (updater: (prev: any[]) => any[]) =>
    queryClient.setQueryData<any[]>(['company-experts'], (prev) => updater(prev || []));

  const [isCreateOpen, setIsCreateOpen] = useSessionBool('company_analyst_create_open', false);

  // Create analyst form
  const [email, setEmail] = useSessionString('ca_email');
  const [password, setPassword] = useSessionString('ca_password');
  const [name, setName] = useSessionString('ca_name');
  const [slug, setSlug] = useSessionString('ca_slug');
  const [role, setRole] = useSessionString('ca_role');
  const [creating, setCreating] = useState(false);

  const clearForm = () => {
    setEmail(''); setPassword(''); setName(''); setSlug(''); setRole('');
    ['ca_email','ca_password','ca_name','ca_slug','ca_role'].forEach(k => sessionStorage.removeItem(k));
  };

  const lineEditor = useLineChannelEditor();
  const account = useAnalystAccount();

  // Restore LINE dialog title when experts arrive
  useEffect(() => {
    lineEditor.restoreTitle(experts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experts, lineEditor.lineExpertId]);

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
    await logAdminAction({
      action: 'analyst.create',
      targetType: 'experts',
      targetId: data?.expert_id ?? null,
      detail: { after: { name, slug, role, email }, context: { email, role } },
    });
    setIsCreateOpen(false);
    clearForm();
    refetchExperts();
  };

  const toggleStatus = async (id: string, currentStatus: string) => {
    let newStatus: string;
    const expert = experts.find(e => e.id === id);
    if (currentStatus === 'suspended') {
      newStatus = expert?.created_by ? 'active' : 'draft';
    } else {
      newStatus = 'suspended';
    }
    setExperts(prev => prev.map(e => e.id === id ? { ...e, status: newStatus } : e));
    await supabase.from('experts').update({ status: newStatus }).eq('id', id);
    await logAdminAction({
      action: newStatus === 'suspended' ? 'analyst.suspend' : 'analyst.activate',
      targetType: 'experts',
      targetId: id,
      detail: {
        before: { status: currentStatus },
        after: { status: newStatus },
        context: { name: expert?.name, slug: expert?.slug },
      },
    });
    toast.success(newStatus === 'suspended' ? '已停用' : '已啟用');
  };

  return (
    <CompanyLayout>
      <SEO title={'分析師管理 | legendflow'} description={'分析師檔案、上下架、權限管理。'} path={'/company/analysts'} noindex />
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">分析師管理</h1>
            <p className="text-muted-foreground text-sm mt-1">管理所有分析師帳號與權限</p>
          </div>
          <CreateAnalystDialog
            open={isCreateOpen}
            setOpen={setIsCreateOpen}
            email={email} setEmail={setEmail}
            password={password} setPassword={setPassword}
            name={name} setName={setName}
            slug={slug} setSlug={setSlug}
            role={role} setRole={setRole}
            creating={creating}
            clearForm={clearForm}
            onCreate={handleCreate}
          />
        </div>

        <AnalystsTable
          loading={loading}
          experts={experts}
          onOpenLine={lineEditor.openLineSettings}
          onOpenAccount={account.openAccountDialog}
          onToggleStatus={toggleStatus}
        />
      </div>

      <LineChannelDialog editor={lineEditor} />
      <AccountCredentialsDialog account={account} />
    </CompanyLayout>
  );
};

export default CompanyAnalysts;
