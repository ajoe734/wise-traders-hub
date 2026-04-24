import { useEffect, useState } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Wallet, CheckCircle2, XCircle, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

type ReviewStatus = 'draft' | 'pending' | 'approved' | 'rejected';

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
}

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

const PlanReview = () => {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'pending' | 'all'>('pending');

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<PlanRow | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [acting, setActing] = useState(false);

  useEffect(() => { fetchPlans(); }, []);

  const fetchPlans = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('expert_plans')
      .select('*, experts:expert_id(name, slug, role)')
      .order('created_at', { ascending: false });
    if (error) { toast.error('載入失敗：' + error.message); }
    setPlans((data || []) as any);
    setLoading(false);
  };

  const approve = async (p: PlanRow) => {
    setActing(true);
    const { error } = await supabase
      .from('expert_plans')
      .update({ review_status: 'approved', review_note: null })
      .eq('id', p.id);
    setActing(false);
    if (error) { toast.error('核准失敗：' + error.message); return; }
    toast.success('已核准方案');
    fetchPlans();
  };

  const openReject = (p: PlanRow) => {
    setRejectTarget(p);
    setRejectNote('');
    setRejectOpen(true);
  };

  const submitReject = async () => {
    if (!rejectTarget) return;
    if (!rejectNote.trim()) { toast.error('請填寫退回原因'); return; }
    setActing(true);
    const { error } = await supabase
      .from('expert_plans')
      .update({ review_status: 'rejected', review_note: rejectNote.trim() })
      .eq('id', rejectTarget.id);
    setActing(false);
    if (error) { toast.error('退回失敗：' + error.message); return; }
    toast.success('已退回方案');
    setRejectOpen(false);
    setRejectTarget(null);
    fetchPlans();
  };

  const filtered = tab === 'pending'
    ? plans.filter(p => p.review_status === 'pending')
    : plans;

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Wallet className="h-6 w-6" /> 方案審核
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            分析師建立或修改的訂閱方案需經審核後才會在前台上架
          </p>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList>
            <TabsTrigger value="pending">
              待審核
              <Badge variant="secondary" className="ml-2">
                {plans.filter(p => p.review_status === 'pending').length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="all">全部</TabsTrigger>
          </TabsList>

          <TabsContent value={tab} className="mt-4">
            <Card>
              <CardContent className="p-0">
                {loading ? (
                  <div className="flex items-center justify-center h-48 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />載入中...
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
                        <TableHead>亮點</TableHead>
                        <TableHead className="text-center">狀態</TableHead>
                        <TableHead className="text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map(p => {
                        const features: string[] = Array.isArray(p.features)
                          ? p.features.filter((f: any) => typeof f === 'string')
                          : [];
                        const status = STATUS_LABEL[p.review_status];
                        return (
                          <TableRow key={p.id}>
                            <TableCell>
                              <div className="font-medium">{p.experts?.name || '—'}</div>
                              <div className="text-xs text-muted-foreground">/{p.experts?.slug}</div>
                            </TableCell>
                            <TableCell>
                              <div className="font-medium">{p.name}</div>
                              {p.description && (
                                <div className="text-xs text-muted-foreground line-clamp-1 max-w-[280px]">
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
                            <TableCell>
                              {features.length === 0 ? (
                                <span className="text-xs text-muted-foreground">（使用預設）</span>
                              ) : (
                                <div className="flex flex-wrap gap-1 max-w-[260px]">
                                  {features.slice(0, 3).map((f, i) => (
                                    <Badge key={i} variant="outline" className="text-[10px] gap-1">
                                      <Sparkles className="h-2.5 w-2.5" />{f}
                                    </Badge>
                                  ))}
                                  {features.length > 3 && (
                                    <span className="text-[10px] text-muted-foreground self-center">
                                      +{features.length - 3}
                                    </span>
                                  )}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge className={cn('text-[11px] border', status.cls)} variant="outline">
                                {status.label}
                              </Badge>
                              {p.review_status === 'rejected' && p.review_note && (
                                <div className="text-[10px] text-destructive mt-1 max-w-[180px] mx-auto line-clamp-2">
                                  {p.review_note}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {p.review_status === 'pending' && (
                                <div className="flex items-center justify-end gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => openReject(p)}
                                    disabled={acting}
                                  >
                                    <XCircle className="h-3.5 w-3.5 mr-1" />退回
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={() => approve(p)}
                                    disabled={acting}
                                  >
                                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" />核准
                                  </Button>
                                </div>
                              )}
                              {p.review_status === 'rejected' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => approve(p)}
                                  disabled={acting}
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" />改判核准
                                </Button>
                              )}
                              {p.review_status === 'approved' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openReject(p)}
                                  disabled={acting}
                                >
                                  <XCircle className="h-3.5 w-3.5 mr-1" />撤銷
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
          </TabsContent>
        </Tabs>
      </div>

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
              {acting ? '處理中...' : '確認退回'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CompanyLayout>
  );
};

export default PlanReview;
