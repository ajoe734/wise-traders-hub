import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from '@/components/ui/sheet';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Loader2, Layers, CheckCircle2, XCircle, Pencil, Trash2, Sparkles, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { logAdminAction } from '@/lib/auditLog';

const CROSS_FIELDS: { key: string; label: string; hint: string }[] = [
  { key: 'has_checkup_basic_discount_on_expert', label: '已訂健檢 Basic → 訂閱方案折扣', hint: '會員在持有健檢 Basic 期間訂閱分析師方案時自動折抵' },
  { key: 'has_checkup_pro_discount_on_expert', label: '已訂健檢 Pro → 訂閱方案折扣', hint: '會員在持有健檢 Pro 期間訂閱分析師方案時自動折抵' },
  { key: 'has_expert_discount_on_checkup_basic', label: '已訂方案 → 健檢 Basic 折扣', hint: '會員在持有任一訂閱方案期間購買健檢 Basic 時自動折抵' },
  { key: 'has_expert_discount_on_checkup_pro', label: '已訂方案 → 健檢 Pro 折扣', hint: '會員在持有任一訂閱方案期間購買健檢 Pro 時自動折抵' },
];

type ReviewStatus = 'draft' | 'pending' | 'approved' | 'rejected';

interface OverrideRow {
  id: string;
  pct_platform: number;
  pct_expert: number;
  is_active: boolean;
  notes: string | null;
}

interface PlanRow {
  id: string;
  expert_id: string;
  name: string;
  description: string | null;
  plan_type: string;
  price_monthly: number;
  price_yearly: number | null;
  features: any;
  is_active: boolean;
  review_status: ReviewStatus;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  experts: { name: string; slug: string; role: string } | null;
  override: OverrideRow | null;
}

interface DefaultRule { pct_platform: number; pct_expert: number; }

const STATUS_LABEL: Record<ReviewStatus, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-muted text-muted-foreground' },
  pending: { label: '待審核', cls: 'bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400' },
  approved: { label: '已核准', cls: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400' },
  rejected: { label: '已退回', cls: 'bg-destructive/15 text-destructive border-destructive/30' },
};

const PLAN_TYPE_LABEL: Record<string, string> = {
  analyst_signal_l1: '即時訊號',
  analyst_signal_diag_l2: '訊號 + 持股健檢',
  mentor_weekly_journal: 'T+7 週記教學',
};

export default function CompanyPlans() {
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [defaultRule, setDefaultRule] = useState<DefaultRule>({ pct_platform: 55, pct_expert: 45 });
  const [loading, setLoading] = useState(true);
  const [outerTab, setOuterTab] = useState<'plans' | 'cross_discounts'>('plans');
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  const [acting, setActing] = useState(false);

  // Cross-product discounts
  const [cross, setCross] = useState<Record<string, number>>({});
  const [crossOriginal, setCrossOriginal] = useState<Record<string, number>>({});
  const [savingCross, setSavingCross] = useState(false);

  // Detail sheet
  const [openId, setOpenId] = useState<string | null>(null);

  // Reject dialog
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState('');

  // Split editor
  const [splitForm, setSplitForm] = useState({ pct_platform: 55, pct_expert: 45, is_active: true, notes: '' });
  const [splitEditing, setSplitEditing] = useState(false);

  const load = async () => {
    setLoading(true);
    const [plansRes, overridesRes, settingsRes, crossRes] = await Promise.all([
      supabase
        .from('expert_plans')
        .select('*, experts:expert_id(name, slug, role)')
        .order('created_at', { ascending: false }),
      supabase
        .from('plan_split_overrides')
        .select('id, plan_id, pct_platform, pct_expert, is_active, notes'),
      supabase.from('payment_settings').select('key, value').eq('key', 'split_standard').maybeSingle(),
      supabase.from('payment_settings').select('value').eq('key', 'cross_discounts').maybeSingle(),
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
    setRows(merged);

    const s = settingsRes.data?.value as any;
    if (s) setDefaultRule({ pct_platform: s.pct_platform ?? 55, pct_expert: s.pct_expert ?? 45 });

    const c = (crossRes.data?.value as Record<string, number>) || {};
    setCross(c);
    setCrossOriginal(c);

    setLoading(false);
  };

  const saveCross = async () => {
    setSavingCross(true);
    const userId = (await supabase.auth.getUser()).data.user?.id;
    const { error } = await supabase.from('payment_settings')
      .upsert({ key: 'cross_discounts', value: cross, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    setSavingCross(false);
    if (error) { toast.error('儲存失敗：' + error.message); return; }
    await logAdminAction({
      action: 'plan.cross_discount_update',
      targetType: 'payment_settings',
      detail: { before: crossOriginal, after: cross },
    });
    setCrossOriginal(cross);
    toast.success('已儲存跨產品折扣');
  };

  useEffect(() => { load(); }, []);

  const current = useMemo(() => rows.find(r => r.id === openId) ?? null, [rows, openId]);

  const filtered = useMemo(() => {
    return tab === 'pending' ? rows.filter(r => r.review_status === 'pending') : rows;
  }, [rows, tab]);

  const pendingCount = rows.filter(r => r.review_status === 'pending').length;

  const refreshAndKeepOpen = async () => {
    await load();
  };

  // ----- Review actions -----
  const approve = async (p: PlanRow) => {
    setActing(true);
    const { error } = await supabase
      .from('expert_plans')
      .update({ review_status: 'approved', review_note: null })
      .eq('id', p.id);
    setActing(false);
    if (error) { toast.error('核准失敗：' + error.message); return; }
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
    refreshAndKeepOpen();
  };

  const submitReject = async () => {
    if (!current) return;
    if (!rejectNote.trim()) { toast.error('請填寫退回原因'); return; }
    setActing(true);
    const { error } = await supabase
      .from('expert_plans')
      .update({ review_status: 'rejected', review_note: rejectNote.trim() })
      .eq('id', current.id);
    setActing(false);
    if (error) { toast.error('退回失敗：' + error.message); return; }
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
    setRejectOpen(false);
    setRejectNote('');
    refreshAndKeepOpen();
  };

  const toggleActive = async (p: PlanRow, next: boolean) => {
    setActing(true);
    const { error } = await supabase
      .from('expert_plans')
      .update({ is_active: next })
      .eq('id', p.id);
    setActing(false);
    if (error) { toast.error('更新失敗：' + error.message); return; }
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
    refreshAndKeepOpen();
  };

  // ----- Split actions -----
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

  const saveSplit = async () => {
    if (!current) return;
    if (splitForm.pct_platform + splitForm.pct_expert !== 100) {
      toast.error('比例錯誤：平台 + 專家需為 100%');
      return;
    }
    setActing(true);
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
    setActing(false);
    if (error) { toast.error('儲存失敗：' + error.message); return; }
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
    setSplitEditing(false);
    refreshAndKeepOpen();
  };

  const removeSplit = async (p: PlanRow) => {
    if (!p.override) return;
    if (!confirm(`確定刪除「${p.name}」的分潤覆寫？刪除後將回退到全站預設 ${defaultRule.pct_platform}/${defaultRule.pct_expert}。`)) return;
    setActing(true);
    const overrideSnapshot = p.override;
    const { error } = await supabase.from('plan_split_overrides').delete().eq('id', p.override.id);
    setActing(false);
    if (error) { toast.error('刪除失敗：' + error.message); return; }
    await logAdminAction({
      action: 'plan.split_override_remove',
      targetType: 'plan_split_overrides',
      targetId: p.id,
      detail: {
        before: overrideSnapshot,
        after: null,
        context: { plan_name: p.name },
      },
    });
    toast.success('已刪除覆寫');
    refreshAndKeepOpen();
  };

  // ----- Render helpers -----
  const renderSplitCell = (p: PlanRow) => {
    if (p.override && p.override.is_active) {
      return (
        <span className="px-2 py-0.5 rounded text-[11px] bg-primary/10 text-primary font-medium">
          {p.override.pct_platform}/{p.override.pct_expert}（覆寫）
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded text-[11px] bg-muted text-muted-foreground">
        {defaultRule.pct_platform}/{defaultRule.pct_expert}（預設）
      </span>
    );
  };

  return (
    <CompanyLayout>
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
          </TabsList>

          <TabsContent value="cross_discounts" className="mt-4 space-y-4">
            <Card>
              <CardContent className="p-5 space-y-4">
                <div>
                  <h3 className="font-semibold">跨產品折扣（NT$）</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    已持有某類商品的會員，購買另一類商品時自動套用的折抵金額。設為 0 表示不折抵。
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {CROSS_FIELDS.map(f => (
                    <div key={f.key} className="space-y-1">
                      <Label className="text-xs font-medium">{f.label}</Label>
                      <p className="text-[11px] text-muted-foreground leading-snug">{f.hint}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">NT$</span>
                        <Input
                          type="number" min={0}
                          value={cross[f.key] ?? 0}
                          onChange={e => setCross(p => ({ ...p, [f.key]: Number(e.target.value) }))}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-3 pt-2">
                  <Button size="sm" onClick={saveCross} disabled={savingCross}>
                    {savingCross ? '儲存中…' : '儲存折扣設定'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setCross(crossOriginal)} disabled={savingCross}>還原</Button>
                </div>
              </CardContent>
            </Card>
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
            <Card>
              <CardContent className="p-0">
                {loading ? (
                  <div className="flex items-center justify-center h-48 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />載入中…
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="p-10 text-center text-muted-foreground">
                    {tab === 'pending' ? '目前沒有待審核的方案' : '尚無方案'}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>分析師</TableHead>
                        <TableHead>方案</TableHead>
                        <TableHead>類型</TableHead>
                        <TableHead className="text-right">月費</TableHead>
                        <TableHead className="text-center">上架</TableHead>
                        <TableHead className="text-center">審核</TableHead>
                        <TableHead className="text-center">分潤</TableHead>
                        <TableHead className="text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map(p => {
                        const status = STATUS_LABEL[p.review_status];
                        return (
                          <TableRow
                            key={p.id}
                            className="cursor-pointer hover:bg-muted/40"
                            onClick={() => setOpenId(p.id)}
                          >
                            <TableCell>
                              <div className="font-medium">{p.experts?.name || '—'}</div>
                              <div className="text-xs text-muted-foreground">/{p.experts?.slug}</div>
                            </TableCell>
                            <TableCell>
                              <div className="font-medium">{p.name}</div>
                              {p.description && (
                                <div className="text-xs text-muted-foreground line-clamp-1 max-w-[260px]">
                                  {p.description}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="text-xs">
                                {PLAN_TYPE_LABEL[p.plan_type] || p.plan_type}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              NT$ {p.price_monthly.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge variant={p.is_active ? 'default' : 'outline'} className="text-[11px]">
                                {p.is_active ? '上架中' : '已下架'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge className={cn('text-[11px] border', status.cls)} variant="outline">
                                {status.label}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-center">
                              {renderSplitCell(p)}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={(e) => { e.stopPropagation(); setOpenId(p.id); }}
                              >
                                管理
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Detail Sheet */}
      <Sheet open={!!openId} onOpenChange={(o) => { if (!o) { setOpenId(null); setSplitEditing(false); } }}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {current && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <span>{current.name}</span>
                  <Badge className={cn('text-[11px] border', STATUS_LABEL[current.review_status].cls)} variant="outline">
                    {STATUS_LABEL[current.review_status].label}
                  </Badge>
                </SheetTitle>
                <SheetDescription>
                  {current.experts?.name} / {PLAN_TYPE_LABEL[current.plan_type] || current.plan_type}
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-6 mt-6">
                {/* Plan content */}
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-muted-foreground">方案內容</h3>
                  <div className="rounded-lg border p-3 space-y-2 text-sm">
                    {current.description && <div className="text-muted-foreground">{current.description}</div>}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">月費</span>
                      <span className="tabular-nums font-medium">NT$ {current.price_monthly.toLocaleString()}</span>
                    </div>
                    {current.price_yearly != null && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">年費</span>
                        <span className="tabular-nums font-medium">NT$ {current.price_yearly.toLocaleString()}</span>
                      </div>
                    )}
                    {Array.isArray(current.features) && current.features.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {current.features.filter((f: any) => typeof f === 'string').map((f: string, i: number) => (
                          <Badge key={i} variant="outline" className="text-[10px] gap-1">
                            <Sparkles className="h-2.5 w-2.5" />{f}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </section>

                {/* Review */}
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-muted-foreground">審核</h3>
                  <div className="rounded-lg border p-3 space-y-3">
                    {current.review_status === 'rejected' && current.review_note && (
                      <div className="text-xs text-destructive bg-destructive/5 rounded p-2">
                        退回原因：{current.review_note}
                      </div>
                    )}
                    {current.reviewed_at && (
                      <div className="text-xs text-muted-foreground">
                        審核時間：{new Date(current.reviewed_at).toLocaleString('zh-TW')}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {current.review_status !== 'approved' && (
                        <Button size="sm" onClick={() => approve(current)} disabled={acting}>
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />核准
                        </Button>
                      )}
                      {current.review_status !== 'rejected' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setRejectNote(current.review_note ?? ''); setRejectOpen(true); }}
                          disabled={acting}
                        >
                          <XCircle className="h-3.5 w-3.5 mr-1" />
                          {current.review_status === 'approved' ? '撤銷核准' : '退回'}
                        </Button>
                      )}
                    </div>
                  </div>
                </section>

                {/* Active toggle */}
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-muted-foreground">上下架</h3>
                  <div className="rounded-lg border p-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">{current.is_active ? '前台顯示中' : '前台隱藏'}</div>
                      <div className="text-xs text-muted-foreground">
                        關閉後該方案不會出現在訂閱選擇頁
                      </div>
                    </div>
                    <Switch
                      checked={current.is_active}
                      disabled={acting}
                      onCheckedChange={(v) => toggleActive(current, v)}
                    />
                  </div>
                </section>

                {/* Split override */}
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-muted-foreground">分潤覆寫</h3>
                  <div className="rounded-lg border p-3 space-y-3">
                    <div className="text-sm">
                      目前生效規則：
                      <span className="ml-2 font-medium">
                        {current.override && current.override.is_active
                          ? `${current.override.pct_platform}/${current.override.pct_expert}（此方案覆寫）`
                          : `${defaultRule.pct_platform}/${defaultRule.pct_expert}（全站預設）`}
                      </span>
                    </div>
                    {current.override && !current.override.is_active && (
                      <div className="text-xs text-muted-foreground">
                        已建立覆寫但目前停用中（{current.override.pct_platform}/{current.override.pct_expert}）
                      </div>
                    )}
                    {current.override?.notes && (
                      <div className="text-xs text-muted-foreground">備註：{current.override.notes}</div>
                    )}

                    {!splitEditing ? (
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => beginEditSplit(current)}>
                          <Pencil className="h-3.5 w-3.5 mr-1" />
                          {current.override ? '編輯覆寫' : '新增覆寫'}
                        </Button>
                        {current.override && (
                          <Button size="sm" variant="ghost" onClick={() => removeSplit(current)} disabled={acting}>
                            <Trash2 className="h-3.5 w-3.5 mr-1" />刪除覆寫
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs">平台（%）</Label>
                            <Input
                              type="number" min={0} max={100}
                              value={splitForm.pct_platform}
                              onChange={e => {
                                const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                                setSplitForm(p => ({ ...p, pct_platform: v, pct_expert: 100 - v }));
                              }}
                            />
                          </div>
                          <div>
                            <Label className="text-xs">專家（%）</Label>
                            <Input
                              type="number" min={0} max={100}
                              value={splitForm.pct_expert}
                              onChange={e => {
                                const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                                setSplitForm(p => ({ ...p, pct_expert: v, pct_platform: 100 - v }));
                              }}
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Switch
                            checked={splitForm.is_active}
                            onCheckedChange={(v) => setSplitForm(p => ({ ...p, is_active: v }))}
                          />
                          <Label className="text-sm">啟用此覆寫</Label>
                        </div>
                        <div>
                          <Label className="text-xs">備註（選填）</Label>
                          <Textarea
                            rows={2}
                            value={splitForm.notes}
                            onChange={e => setSplitForm(p => ({ ...p, notes: e.target.value }))}
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={saveSplit} disabled={acting}>儲存</Button>
                          <Button size="sm" variant="ghost" onClick={() => setSplitEditing(false)}>取消</Button>
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                <section className="text-xs text-muted-foreground">
                  建立於 {new Date(current.created_at).toLocaleString('zh-TW')}
                </section>
              </div>

              <SheetFooter className="mt-6">
                <Button variant="outline" onClick={() => setOpenId(null)}>關閉</Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Reject dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>退回方案</DialogTitle>
            <DialogDescription>
              請填寫退回原因，分析師將在後台看到此說明，並可修改後重新送審。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>退回原因</Label>
            <Textarea
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              rows={4}
              placeholder="例：方案描述不夠清楚 / 價格與類型不符 / 亮點過於誇大"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectOpen(false)}>取消</Button>
            <Button onClick={submitReject} disabled={acting} variant="destructive">
              {acting ? '處理中…' : '確認退回'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CompanyLayout>
  );
}
