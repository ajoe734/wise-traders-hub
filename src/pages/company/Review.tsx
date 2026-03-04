import { useState, useEffect, useRef } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

const actionLabels: Record<string, string> = {
  buy: '買進', sell: '賣出', add: '加碼', trim: '減碼', exit: '平損',
};

const stripDotPrefix = (text: string) => text.replace(/^[•·．‧●○◆■□▪▫※☆★→➤➜▸▹►▻‣⁃–—\-]\s*/gm, '');

const CompanyReview = () => {
  const { user } = useAuth();
  const [signals, setSignals] = useState<any[]>([]);
  const [takedownNote, setTakedownNote] = useState('');
  const [takedownId, setTakedownId] = useState<string | null>(null);
  const [viewReasonId, setViewReasonId] = useState<string | null>(null);
  const [isTakingDown, setIsTakingDown] = useState(false);
  const takedownInProgress = useRef(false);

  useEffect(() => { fetchSignals(); }, []);

  const fetchSignals = async () => {
    const { data } = await supabase
      .from('expert_signals')
      .select('*, experts(name, slug)')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(50);
    setSignals(data || []);
  };

  const takedownSignal = async () => {
    if (!takedownId || takedownInProgress.current) return;
    takedownInProgress.current = true;
    setIsTakingDown(true);

    try {
      const target = signals.find(s => s.id === takedownId);

      // Check fresh status to prevent duplicate
      const { data: fresh } = await supabase
        .from('expert_signals')
        .select('status')
        .eq('id', takedownId)
        .single();

      if (fresh?.status === 'taken_down') {
        toast.info('此訊號已被下架');
        setTakedownId(null);
        setTakedownNote('');
        fetchSignals();
        return;
      }

      const { error: updateError } = await supabase.from('expert_signals').update({
        status: 'taken_down' as any,
        taken_down_reason: takedownNote,
        taken_down_by: user?.id,
      }).eq('id', takedownId);

      if (updateError) {
        toast.error('下架失敗：' + updateError.message);
        return;
      }

      toast.success('訊號已下架');

      // Optimistically remove from local state immediately
      setSignals(prev => prev.filter(s => s.id !== takedownId));

      // Close dialog immediately to prevent re-click
      setTakedownId(null);
      setTakedownNote('');

      // Push takedown notification via LINE (non-blocking)
      if (target) {
        supabase.functions.invoke('line-push-signal', {
          body: { signal_id: target.id, expert_id: target.expert_id, type: 'takedown' },
        }).then(({ data }) => {
          if (data?.pushed) {
            toast.success(`已推播下架通知給 ${data.count} 位訂閱者`);
          }
        }).catch(() => {});
      }
    } catch (error) {
      console.error('Takedown failed:', error);
      toast.error('下架失敗，請重試');
    } finally {
      takedownInProgress.current = false;
      setIsTakingDown(false);
    }
  };

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">內容監管</h1>
          <p className="text-muted-foreground text-sm mt-1">監控已發布訊號，可下架違規內容</p>
        </div>

        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-muted-foreground" />
            <div>
              <div className="text-2xl font-bold">{signals.length}</div>
              <div className="text-xs text-muted-foreground">已發布訊號</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            {signals.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground text-sm">無已發布訊號</div>
            ) : (
              <div className="space-y-3">
                  {signals.map(sig => (
                  <div key={sig.id} className="py-3 border-b last:border-0 space-y-1">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">{actionLabels[sig.action] || sig.action}</Badge>
                          <span className="font-medium text-sm">{sig.instrument}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{stripDotPrefix(sig.reason_summary || '')}</p>
                        <p className="text-xs text-muted-foreground">
                          {sig.experts?.name} · {sig.published_at ? new Date(sig.published_at).toLocaleString('zh-TW') : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-3">
                        {(sig.reason_detail || sig.risk_notes) && (
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setViewReasonId(viewReasonId === sig.id ? null : sig.id)}>
                            {viewReasonId === sig.id ? '收起' : '查看理由'}
                          </Button>
                        )}
                         <Button size="sm" className="bg-company hover:bg-company/90 text-white h-7 text-xs" onClick={() => setTakedownId(sig.id)}>
                           下架
                         </Button>
                      </div>
                    </div>
                    {viewReasonId === sig.id && (
                      <div className="bg-muted/50 rounded-md p-3 text-xs space-y-2">
                        {sig.reason_summary && (
                          <div>
                            <span className="font-medium text-foreground">摘要</span>
                            <p className="text-muted-foreground mt-0.5 whitespace-pre-wrap">{stripDotPrefix(sig.reason_summary)}</p>
                          </div>
                        )}
                        {sig.reason_detail && (
                          <div>
                            <span className="font-medium text-foreground">詳細分析</span>
                            <p className="text-muted-foreground mt-0.5 whitespace-pre-wrap">{stripDotPrefix(sig.reason_detail)}</p>
                          </div>
                        )}
                        {sig.risk_notes && (
                          <div>
                            <span className="font-medium text-foreground">風險提示</span>
                            <p className="text-muted-foreground mt-0.5 whitespace-pre-wrap">{stripDotPrefix(sig.risk_notes)}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!takedownId} onOpenChange={() => setTakedownId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>下架訊號</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <Textarea value={takedownNote} onChange={e => setTakedownNote(e.target.value)} placeholder="請填寫下架理由..." rows={3} />
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setTakedownId(null)}>取消</Button>
              <Button variant="destructive" onClick={takedownSignal} disabled={isTakingDown}>
                {isTakingDown ? '下架中...' : '確認下架'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </CompanyLayout>
  );
};

export default CompanyReview;
