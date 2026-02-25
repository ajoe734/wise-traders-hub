import { useState, useEffect } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { CheckCircle, XCircle, Clock, Eye, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

const actionLabels: Record<string, string> = {
  buy: '買進', sell: '賣出', add: '加碼', trim: '減碼', exit: '出場',
};

const CompanyReview = () => {
  const { user } = useAuth();
  const [tab, setTab] = useState('plans');
  const [pendingPlans, setPendingPlans] = useState<any[]>([]);
  const [signals, setSignals] = useState<any[]>([]);
  const [rejectNote, setRejectNote] = useState('');
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [takedownNote, setTakedownNote] = useState('');
  const [takedownId, setTakedownId] = useState<string | null>(null);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    const { data: plans } = await supabase
      .from('expert_plans')
      .select('*, experts(name, slug, role)')
      .eq('review_status', 'pending')
      .order('created_at', { ascending: false });
    setPendingPlans(plans || []);

    const { data: sigs } = await supabase
      .from('expert_signals')
      .select('*, experts(name, slug)')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(30);
    setSignals(sigs || []);
  };

  const approvePlan = async (id: string) => {
    await supabase.from('expert_plans').update({
      review_status: 'approved' as any,
      is_active: true,
      reviewed_by: user?.id,
      reviewed_at: new Date().toISOString(),
    }).eq('id', id);
    toast.success('方案已核准');
    fetchData();
  };

  const rejectPlan = async () => {
    if (!rejectingId) return;
    await supabase.from('expert_plans').update({
      review_status: 'rejected' as any,
      review_note: rejectNote,
      reviewed_by: user?.id,
      reviewed_at: new Date().toISOString(),
    }).eq('id', rejectingId);
    toast.success('方案已退回');
    setRejectingId(null);
    setRejectNote('');
    fetchData();
  };

  const takedownSignal = async () => {
    if (!takedownId) return;
    await supabase.from('expert_signals').update({
      status: 'taken_down' as any,
      taken_down_reason: takedownNote,
      taken_down_by: user?.id,
    }).eq('id', takedownId);
    toast.success('訊號已下架');
    setTakedownId(null);
    setTakedownNote('');
    fetchData();
  };

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">內容審核</h1>
          <p className="text-muted-foreground text-sm mt-1">方案審核與訊號監管</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <Clock className="h-5 w-5 text-yellow-500" />
              <div>
                <div className="text-2xl font-bold">{pendingPlans.length}</div>
                <div className="text-xs text-muted-foreground">待審核方案</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-2xl font-bold">{signals.length}</div>
                <div className="text-xs text-muted-foreground">已發布訊號</div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="plans">
              方案審核 {pendingPlans.length > 0 && <Badge variant="destructive" className="ml-1.5 h-4 px-1.5 text-[10px]">{pendingPlans.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="signals">內容監管</TabsTrigger>
          </TabsList>

          <TabsContent value="plans" className="mt-4">
            <Card>
              <CardContent className="pt-4">
                {pendingPlans.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground text-sm">無待審核方案</div>
                ) : (
                  <div className="space-y-3">
                    {pendingPlans.map(plan => (
                      <div key={plan.id} className="flex items-start justify-between py-3 border-b last:border-0">
                        <div className="min-w-0">
                          <p className="font-medium text-sm">{plan.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {plan.experts?.name} · {plan.experts?.role === 'advisor' ? '投顧分析師' : '實戰導師'}
                          </p>
                          <p className="text-xs text-muted-foreground">月費 NT${plan.price_monthly?.toLocaleString()}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-3">
                          <Button size="sm" variant="outline" className="text-green-600 border-green-600/30 hover:bg-green-500/10 h-7 text-xs" onClick={() => approvePlan(plan.id)}>
                            <CheckCircle className="h-3 w-3 mr-1" />通過
                          </Button>
                          <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10 h-7 text-xs" onClick={() => setRejectingId(plan.id)}>
                            <XCircle className="h-3 w-3 mr-1" />退回
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="signals" className="mt-4">
            <Card>
              <CardContent className="pt-4">
                {signals.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground text-sm">無已發布訊號</div>
                ) : (
                  <div className="space-y-3">
                    {signals.map(sig => (
                      <div key={sig.id} className="flex items-start justify-between py-3 border-b last:border-0">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">{actionLabels[sig.action] || sig.action}</Badge>
                            <span className="font-medium text-sm">{sig.instrument}</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{sig.reason_summary}</p>
                          <p className="text-xs text-muted-foreground">
                            {sig.experts?.name} · {sig.published_at ? new Date(sig.published_at).toLocaleString('zh-TW') : ''}
                          </p>
                        </div>
                        <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10 h-7 text-xs shrink-0 ml-3" onClick={() => setTakedownId(sig.id)}>
                          下架
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Reject Dialog */}
      <Dialog open={!!rejectingId} onOpenChange={() => setRejectingId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>退回方案</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <Textarea value={rejectNote} onChange={e => setRejectNote(e.target.value)} placeholder="請填寫退回理由..." rows={3} />
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setRejectingId(null)}>取消</Button>
              <Button variant="destructive" onClick={rejectPlan}>確認退回</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Takedown Dialog */}
      <Dialog open={!!takedownId} onOpenChange={() => setTakedownId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>下架訊號</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <Textarea value={takedownNote} onChange={e => setTakedownNote(e.target.value)} placeholder="請填寫下架理由..." rows={3} />
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setTakedownId(null)}>取消</Button>
              <Button variant="destructive" onClick={takedownSignal}>確認下架</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </CompanyLayout>
  );
};

export default CompanyReview;
