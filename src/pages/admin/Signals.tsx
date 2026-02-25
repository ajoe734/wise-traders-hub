import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { Plus, Search, Filter, Eye } from 'lucide-react';
import { toast } from 'sonner';

const actionLabels: Record<string, { label: string; variant: 'default' | 'destructive' | 'secondary' | 'outline' }> = {
  buy: { label: '買進', variant: 'default' },
  sell: { label: '賣出', variant: 'destructive' },
  add: { label: '加碼', variant: 'secondary' },
  trim: { label: '減碼', variant: 'outline' },
  exit: { label: '出場', variant: 'destructive' },
};

const AdminSignals = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const [expert, setExpert] = useState<any>(null);
  const [signals, setSignals] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // Form
  const [instrument, setInstrument] = useState('');
  const [action, setAction] = useState('');
  const [priceHint, setPriceHint] = useState('');
  const [reasonSummary, setReasonSummary] = useState('');
  const [reasonDetail, setReasonDetail] = useState('');
  const [riskNotes, setRiskNotes] = useState('');
  const [planId, setPlanId] = useState('');

  useEffect(() => { fetchData(); }, [expertSlug]);

  const fetchData = async () => {
    if (!expertSlug) return;
    setLoading(true);
    const { data: exp } = await supabase.from('experts').select('*').eq('slug', expertSlug).single();
    setExpert(exp);
    if (exp) {
      const { data: s } = await supabase
        .from('expert_signals')
        .select('*')
        .eq('expert_id', exp.id)
        .order('created_at', { ascending: false });
      // Show taken_down signals for 5 minutes after publish, then auto-hide
      const fiveMinAgo = Date.now() - 5 * 60 * 1000;
      const filtered = (s || []).filter(sig => {
        if (sig.status !== 'taken_down') return true;
        // Use published_at as proxy for visibility window
        const publishedTime = sig.published_at ? new Date(sig.published_at).getTime() : 0;
        return publishedTime > fiveMinAgo;
      });
      setSignals(filtered);
      const { data: p } = await supabase.from('expert_plans').select('id, name').eq('expert_id', exp.id).eq('is_active', true);
      setPlans(p || []);
    }
    setLoading(false);
  };

  const handlePublish = async () => {
    if (!expert) {
      toast.error('找不到分析師資料，請重新整理後再試');
      return;
    }

    if (!instrument.trim() || !action) {
      toast.error('請先填寫「標的」與「操作方向」');
      return;
    }

    const { error } = await supabase.from('expert_signals').insert({
      expert_id: expert.id,
      plan_id: planId || null,
      instrument: instrument.trim(),
      action: action as any,
      price_hint: priceHint ? parseFloat(priceHint) : null,
      reason_summary: reasonSummary,
      reason_detail: reasonDetail,
      risk_notes: riskNotes,
      status: 'published' as any,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('訊號已發布');
    setIsCreateOpen(false);
    setInstrument(''); setAction(''); setPriceHint(''); setReasonSummary(''); setReasonDetail(''); setRiskNotes(''); setPlanId('');
    fetchData();
  };

  const isAdvisor = expert?.role === 'advisor';
  const canPublish = !!expert && !!instrument.trim() && !!action;

  const filtered = signals.filter(s =>
    s.instrument?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.reason_summary?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) return <AdminLayout><div className="flex items-center justify-center h-64 text-muted-foreground">載入中...</div></AdminLayout>;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">訊號管理</h1>
            <p className="text-muted-foreground text-sm mt-1">發布即上線，管理者可事後下架</p>
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className={cn(isAdvisor ? "bg-advisor hover:bg-advisor/90" : "bg-mentor hover:bg-mentor/90")}>
                <Plus className="h-4 w-4 mr-2" />發布新訊號
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
              <DialogHeader><DialogTitle>發布新訊號</DialogTitle></DialogHeader>
              <div className="space-y-4 mt-4 overflow-y-auto flex-1 px-1 -mx-1">
                <div className="space-y-2">
                  <Label>標的（代碼+名稱）</Label>
                  <Input value={instrument} onChange={e => setInstrument(e.target.value)} placeholder="例：2330 台積電" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>操作方向</Label>
                    <Select value={action} onValueChange={setAction}>
                      <SelectTrigger><SelectValue placeholder="選擇" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="buy">買進</SelectItem>
                        <SelectItem value="sell">賣出</SelectItem>
                        <SelectItem value="add">加碼</SelectItem>
                        <SelectItem value="trim">減碼</SelectItem>
                        <SelectItem value="exit">出場</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>參考價位</Label>
                    <Input value={priceHint} onChange={e => setPriceHint(e.target.value)} type="number" placeholder="890" />
                  </div>
                </div>
                {plans.length > 0 && (
                  <div className="space-y-2">
                    <Label>對應方案</Label>
                    <Select value={planId} onValueChange={setPlanId}>
                      <SelectTrigger><SelectValue placeholder="選擇方案（可選）" /></SelectTrigger>
                      <SelectContent>
                        {plans.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>操作理由（摘要）</Label>
                  <Textarea value={reasonSummary} onChange={e => setReasonSummary(e.target.value)} placeholder="簡述操作原因..." rows={2} />
                </div>
                <div className="space-y-2">
                  <Label>詳細分析</Label>
                  <Textarea value={reasonDetail} onChange={e => setReasonDetail(e.target.value)} placeholder="詳細分析..." rows={3} />
                </div>
                <div className="space-y-2">
                  <Label>風險提示</Label>
                  <Textarea value={riskNotes} onChange={e => setRiskNotes(e.target.value)} placeholder="停損點、注意事項..." rows={2} />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <Button variant="outline" onClick={() => setIsCreateOpen(false)}>取消</Button>
                  <Button
                    onClick={handlePublish}
                    disabled={!canPublish}
                    className={cn(isAdvisor ? "bg-advisor hover:bg-advisor/90" : "bg-mentor hover:bg-mentor/90")}
                  >
                    立即發布
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="搜尋標的或理由..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-10" />
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">時間</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">標的</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">方向</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">價位</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">理由</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={6} className="p-8 text-center text-muted-foreground text-sm">尚無訊號</td></tr>
                  ) : (
                    filtered.map((signal) => {
                      const ai = actionLabels[signal.action] || actionLabels.buy;
                      return (
                        <tr key={signal.id} className={cn(
                          "border-b last:border-0 hover:bg-muted/30",
                          signal.status === 'taken_down' && "bg-destructive/5"
                        )}>
                          <td className="p-3 text-sm text-muted-foreground whitespace-nowrap">{signal.published_at ? new Date(signal.published_at).toLocaleString('zh-TW') : '-'}</td>
                          <td className="p-3 text-sm font-medium">{signal.instrument}</td>
                          <td className="p-3"><Badge variant={ai.variant} className="text-xs">{ai.label}</Badge></td>
                          <td className="p-3 text-sm">{signal.price_hint || '-'}</td>
                          <td className="p-3 text-sm text-muted-foreground max-w-[200px] truncate">{signal.reason_summary || '-'}</td>
                          <td className="p-3">
                            {signal.status === 'taken_down' ? (
                              <div className="space-y-1">
                                <Badge variant="destructive" className="text-xs">已下架</Badge>
                                {signal.taken_down_reason && (
                                  <p className="text-xs text-destructive/80 max-w-[180px]">
                                    {signal.taken_down_reason.replace(/^[•·．‧●○◆■□▪▫※☆★→➤➜▸▹►▻‣⁃–—\-]\s*/gm, '')}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <Badge variant="secondary" className="text-xs">已發布</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
};

export default AdminSignals;
