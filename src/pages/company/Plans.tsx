import { SEO } from '@/components/SEO';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Layers, Tag, HeartPulse } from 'lucide-react';
import CheckupPlansAdmin from '@/components/company/CheckupPlansAdmin';
import { useCompanyPlans } from '@/hooks/company/useCompanyPlans';
import type { PlanRow, SplitForm } from '@/pages/_companyPlans/types';
import PlansTable from '@/pages/_companyPlans/PlansTable';
import CrossDiscountsPanel from '@/pages/_companyPlans/CrossDiscountsPanel';
import PlanDetailSheet from '@/pages/_companyPlans/PlanDetailSheet';
import RejectDialog from '@/pages/_companyPlans/RejectDialog';

export default function CompanyPlans() {
  const [outerTab, setOuterTab] = useState<'plans' | 'cross_discounts' | 'checkup'>('plans');
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  const [acting, setActing] = useState(false);

  // Cross-product discounts — local form state (seeded from query, mutated by inputs)
  const [cross, setCross] = useState<Record<string, number>>({});
  const [crossOriginal, setCrossOriginal] = useState<Record<string, number>>({});
  const [savingCross, setSavingCross] = useState(false);

  // Detail sheet
  const [openId, setOpenId] = useState<string | null>(null);

  // Reject dialog
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState('');

  // Split editor
  const [splitForm, setSplitForm] = useState<SplitForm>({ pct_platform: 55, pct_expert: 45, is_active: true, notes: '' });
  const [splitEditing, setSplitEditing] = useState(false);

  const {
    data, isFetching,
    approve, reject, toggleActive, saveSplit, removeSplit, saveCross,
  } = useCompanyPlans();

  const rows = data?.rows ?? [];
  const defaultRule = data?.defaultRule ?? { pct_platform: 55, pct_expert: 45 };
  const loading = isFetching && !data;

  // Seed editable cross-discount form whenever the server snapshot lands
  useEffect(() => {
    if (!data) return;
    setCross(data.crossMap);
    setCrossOriginal(data.crossMap);
  }, [data]);

  const current = useMemo(() => rows.find(r => r.id === openId) ?? null, [rows, openId]);

  const filtered = useMemo(
    () => (tab === 'pending' ? rows.filter(r => r.review_status === 'pending') : rows),
    [rows, tab],
  );

  const pendingCount = rows.filter(r => r.review_status === 'pending').length;

  const beginEditSplit = (p: PlanRow) => {
    if (p.override) {
      setSplitForm({
        pct_platform: p.override.pct_platform,
        pct_expert: p.override.pct_expert,
        is_active: p.override.is_active,
        notes: p.override.notes ?? '',
      });
    } else {
      setSplitForm({
        pct_platform: defaultRule.pct_platform,
        pct_expert: defaultRule.pct_expert,
        is_active: true,
        notes: '',
      });
    }
    setSplitEditing(true);
  };

  const wrapAction = <T extends any[]>(fn: (...args: T) => Promise<boolean>) =>
    async (...args: T) => {
      setActing(true);
      try { await fn(...args); } finally { setActing(false); }
    };

  const handleApprove = wrapAction((p: PlanRow) => approve(p));
  const handleToggle = wrapAction((p: PlanRow, next: boolean) => toggleActive(p, next));
  const handleRemoveSplit = wrapAction((p: PlanRow) => removeSplit(p, defaultRule));
  const handleSaveSplit = wrapAction(async () => {
    if (!current) return false;
    const ok = await saveSplit(current, splitForm);
    if (ok) setSplitEditing(false);
    return ok;
  });
  const handleSubmitReject = wrapAction(async () => {
    if (!current) return false;
    const ok = await reject(current, rejectNote);
    if (ok) { setRejectOpen(false); setRejectNote(''); }
    return ok;
  });

  const handleSaveCross = async () => {
    setSavingCross(true);
    try {
      const ok = await saveCross(cross, crossOriginal);
      if (ok) setCrossOriginal(cross);
    } finally {
      setSavingCross(false);
    }
  };

  return (
    <CompanyLayout>
      <SEO title={'方案審核 | legendflow'} description={'分析師訂閱方案審核與分潤設定。'} path={'/company/plans'} noindex />
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Layers className="h-6 w-6" /> 方案管理
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              審核分析師方案、上下架與分潤覆寫，集中於此。
            </p>
          </div>
          <div className="text-sm text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
            全站預設分潤：
            <span className="font-medium text-foreground ml-1">
              平台 {defaultRule.pct_platform}% / 專家 {defaultRule.pct_expert}%
            </span>
            <Link to="/company/payment-settings" className="ml-3 underline text-primary text-xs">
              編輯預設
            </Link>
          </div>
        </div>

        <Tabs value={outerTab} onValueChange={(v) => setOuterTab(v as any)}>
          <TabsList>
            <TabsTrigger value="plans"><Layers className="h-3.5 w-3.5 mr-1" />方案審核 / 分潤</TabsTrigger>
            <TabsTrigger value="cross_discounts"><Tag className="h-3.5 w-3.5 mr-1" />跨產品折扣</TabsTrigger>
            <TabsTrigger value="checkup"><HeartPulse className="h-3.5 w-3.5 mr-1" />健檢方案</TabsTrigger>
          </TabsList>

          <TabsContent value="checkup" className="mt-4">
            <CheckupPlansAdmin />
          </TabsContent>

          <TabsContent value="cross_discounts" className="mt-4 space-y-4">
            <CrossDiscountsPanel
              cross={cross}
              crossOriginal={crossOriginal}
              savingCross={savingCross}
              setCross={setCross}
              onSave={handleSaveCross}
              onReset={() => setCross(crossOriginal)}
            />
          </TabsContent>

          <TabsContent value="plans" className="mt-4">
            <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
              <TabsList>
                <TabsTrigger value="pending">
                  待審核
                  <Badge variant="secondary" className="ml-2">{pendingCount}</Badge>
                </TabsTrigger>
                <TabsTrigger value="all">全部方案</TabsTrigger>
              </TabsList>

              <TabsContent value={tab} className="mt-4">
                <PlansTable
                  loading={loading}
                  tab={tab}
                  filtered={filtered}
                  defaultRule={defaultRule}
                  onOpen={setOpenId}
                />
              </TabsContent>
            </Tabs>
          </TabsContent>
        </Tabs>
      </div>

      <PlanDetailSheet
        open={!!openId}
        current={current}
        defaultRule={defaultRule}
        acting={acting}
        splitEditing={splitEditing}
        splitForm={splitForm}
        setSplitForm={setSplitForm}
        setSplitEditing={setSplitEditing}
        setOpen={(v) => { if (!v) { setOpenId(null); setSplitEditing(false); } }}
        beginEditSplit={beginEditSplit}
        onApprove={handleApprove}
        onOpenReject={(p) => { setRejectNote(p.review_note ?? ''); setRejectOpen(true); }}
        onToggleActive={handleToggle}
        onSaveSplit={handleSaveSplit}
        onRemoveSplit={handleRemoveSplit}
      />

      <RejectDialog
        open={rejectOpen}
        rejectNote={rejectNote}
        acting={acting}
        setOpen={setRejectOpen}
        setRejectNote={setRejectNote}
        onSubmit={handleSubmitReject}
      />
    </CompanyLayout>
  );
}
