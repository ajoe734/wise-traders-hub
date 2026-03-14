import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import { Plus, Search, Filter, Eye, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

const stripDotPrefix = (text: string) => text.replace(/^[•·．‧●○◆■□▪▫※☆★→➤➜▸▹►▻‣⁃–—\-]\s*/gm, '');

const actionLabels: Record<string, { label: string; variant: 'default' | 'destructive' | 'secondary' | 'outline' }> = {
  buy: { label: '買進', variant: 'default' },
  sell: { label: '賣出', variant: 'destructive' },
  add: { label: '加碼', variant: 'secondary' },
  trim: { label: '減碼', variant: 'outline' },
  exit: { label: '平損', variant: 'destructive' },
};

const AdminSignals = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const { hasRole } = useAuth();
  const isReadOnly = hasRole('company_admin');
  const [expert, setExpert] = useState<any>(null);
  const [signals, setSignals] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [signalTemplates, setSignalTemplates] = useState<{ id: string; title: string; action: string; reason: string; risk_note: string; strategy_note: string }[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Form
  const [stockCode, setStockCode] = useState('');
  const [stockName, setStockName] = useState('');
  const [action, setAction] = useState('');
  const [priceHint, setPriceHint] = useState('');
  const [reasonSummary, setReasonSummary] = useState('');
  const [reasonDetail, setReasonDetail] = useState('');
  const [riskNotes, setRiskNotes] = useState('');
  const [learningPoints, setLearningPoints] = useState('');
  const handleStockCodeChange = (value: string) => {
    setStockCode(value);
  };

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
      const { data: tpl } = await supabase
        .from('expert_signal_templates' as any)
        .select('id, title, action, reason, risk_note, strategy_note')
        .eq('expert_id', exp.id)
        .order('sort_order', { ascending: true });
      setSignalTemplates((tpl as any) || []);
    }
    setLoading(false);
  };

  const handlePublish = async () => {
    if (!expert) {
      toast.error('找不到分析師資料，請重新整理後再試');
      return;
    }

    if (!stockCode.trim() || !action) {
      toast.error('請先填寫「代碼」與「操作方向」');
      return;
    }

    const latestName = stockName.trim();
    const latestPrice = priceHint;

    const instrument = latestName ? `${stockCode.trim()} ${latestName}` : stockCode.trim();
    const { data: inserted, error } = await supabase.from('expert_signals').insert({
      expert_id: expert.id,
      plan_id: null,
      instrument,
      action: action as any,
      price_hint: latestPrice ? parseFloat(latestPrice) : null,
      reason_summary: reasonSummary,
      reason_detail: reasonDetail,
      risk_notes: riskNotes,
      learning_points: learningPoints || null,
      status: 'published' as any,
    }).select('id').single();
    if (error) { toast.error(error.message); return; }

    // 同步寫入 trade_signals + user_performances
    if (expert.user_id) {
      const entryPrice = latestPrice ? parseFloat(latestPrice) : 0;

      if (action === 'sell' || action === 'trim' || action === 'exit') {
        // 賣出/減碼/平損：將該股票的 open 狀態更新為 closed
        const { error: tsError } = await supabase
          .from('trade_signals')
          .update({ status: 'closed' } as any)
          .eq('user_id', expert.user_id)
          .eq('symbol', stockCode.trim())
          .eq('status', 'open');
        if (tsError) {
          console.error('trade_signals update failed:', tsError);
          toast.error('持倉狀態更新失敗');
        }

        // 移除 user_performances 中的對應紀錄
        await supabase
          .from('user_performances')
          .delete()
          .eq('user_id', expert.user_id)
          .eq('symbol', stockCode.trim());
      } else {
        // 買進/加碼：新增一筆 open 紀錄
        const { data: tsData, error: tsError } = await supabase.from('trade_signals').insert({
          user_id: expert.user_id,
          symbol: stockCode.trim(),
          name: latestName || null,
          entry_price: entryPrice,
          status: 'open',
        } as any).select('id').single();
        if (tsError) {
          console.error('trade_signals insert failed:', tsError);
          toast.error('持倉記錄寫入失敗');
        }

        // 同步寫入 user_performances 讓績效頁面立即顯示
        if (tsData) {
          await supabase.from('user_performances').insert({
            user_id: expert.user_id,
            signal_id: (tsData as any).id,
            symbol: stockCode.trim(),
            name: latestName || null,
            entry_price: entryPrice,
            current_price: entryPrice,
            pnl: 0,
            pnl_percent: 0,
          } as any);
        }
      }
    }

    toast.success(isMentor ? '週記已發布' : '訊號已發布');
    setIsCreateOpen(false);
    setStockCode(''); setStockName(''); setAction(''); setPriceHint(''); setReasonSummary(''); setReasonDetail(''); setRiskNotes(''); setLearningPoints('');

    // Trigger LINE push notification (non-blocking)
    if (inserted?.id) {
      supabase.functions.invoke('line-push-signal', {
        body: { signal_id: inserted.id, expert_id: expert.id },
      }).then(({ data: pushData, error: pushError }) => {
        console.log('LINE push response:', pushData, pushError);
        if (pushError) {
          toast.error(`LINE 推播失敗：${pushError.message}`);
        } else if (pushData?.pushed) {
          toast.success(`已推播給 ${pushData.count} 位訂閱者`);
      } else if (pushData?.reason) {
          toast.info(`LINE 推播略過：${pushData.reason}`);
        }
      }).catch((err) => {
        console.error('LINE push invoke error:', err);
        toast.error('LINE 推播呼叫失敗');
      });
    }

    fetchData();
  };

  const isAdvisor = expert?.role === 'advisor';
  const isMentor = expert?.role === 'mentor';
  const contentLabel = isMentor ? '週記' : '訊號';
  const canPublish = !!expert && !!stockCode.trim() && !!action;

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
            <h1 className="text-2xl font-bold">{contentLabel}管理</h1>
            <p className="text-muted-foreground text-sm mt-1">{isMentor ? '每週發布，管理者可事後下架' : '發布即上線，管理者可事後下架'}</p>
          </div>
          {!isReadOnly && (
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className={cn(isAdvisor ? "bg-advisor hover:bg-advisor/90" : "bg-mentor hover:bg-mentor/90")}>
                <Plus className="h-4 w-4 mr-2" />發布新{contentLabel}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
              <DialogHeader><DialogTitle>發布新{contentLabel}</DialogTitle></DialogHeader>
              <div className="space-y-4 mt-4 overflow-y-auto flex-1 px-1 -mx-1">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>股票代碼</Label>
                    <div>
                      <Input value={stockCode} onChange={e => handleStockCodeChange(e.target.value)} placeholder="例：2330" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>股票名稱</Label>
                    <Input value={stockName} onChange={e => setStockName(e.target.value)} placeholder="例：台積電" />
                  </div>
                </div>
                {signalTemplates.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">訊號模板</Label>
                    <div className="flex flex-wrap gap-1.5 max-h-16 overflow-y-auto">
                      {signalTemplates.map(tpl => {
                        const actionColor: Record<string, string> = {
                          buy: 'border-success text-success hover:bg-success/10',
                          sell: 'border-destructive text-destructive hover:bg-destructive/10',
                          add: 'border-blue-500 text-blue-500 hover:bg-blue-500/10',
                          trim: 'border-amber-500 text-amber-500 hover:bg-amber-500/10',
                          exit: 'border-slate-500 text-slate-500 hover:bg-slate-500/10',
                        };
                        return (
                          <Button
                            key={tpl.id}
                            type="button"
                            variant="outline"
                            size="sm"
                            className={cn("h-6 text-xs px-2", actionColor[tpl.action] || '')}
                            onClick={() => {
                              if (!action) setAction(tpl.action);
                              if (!reasonSummary) setReasonSummary(tpl.reason);
                              if (!riskNotes) setRiskNotes(tpl.risk_note);
                              if (!reasonDetail) setReasonDetail(tpl.strategy_note);
                            }}
                          >
                            {tpl.title}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                )}
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
                        <SelectItem value="exit">平損</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>參考價位</Label>
                    <Input value={priceHint} onChange={e => setPriceHint(e.target.value)} type="number" placeholder="890" />
                  </div>
                </div>
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
                {isMentor && (
                  <div className="space-y-2">
                    <Label>教學重點</Label>
                    <Textarea value={learningPoints} onChange={e => setLearningPoints(e.target.value)} placeholder="本週學習要點..." rows={3} />
                  </div>
                )}
                {canPublish && (
                  <Card className="bg-muted/50">
                    <CardContent className="p-4 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">📋 訂閱者預覽</p>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs">{actionLabels[action]?.label || action}</Badge>
                        <span className="font-medium text-sm">{stockCode} {stockName}</span>
                        {priceHint && <span className="text-sm text-muted-foreground">@ {priceHint}</span>}
                      </div>
                      {reasonSummary && <p className="text-sm">{reasonSummary}</p>}
                      {reasonDetail && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{reasonDetail}</p>}
                      {riskNotes && <p className="text-xs text-destructive">⚠️ {riskNotes}</p>}
                      {isMentor && learningPoints && <p className="text-xs text-primary">📌 {learningPoints}</p>}
                    </CardContent>
                  </Card>
                )}
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
          )}
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
                     <th className="text-left p-3 text-xs font-medium text-muted-foreground"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                     <tr><td colSpan={7} className="p-8 text-center text-muted-foreground text-sm">尚無{contentLabel}</td></tr>
                  ) : (
                     filtered.map((signal) => {
                       const ai = actionLabels[signal.action] || actionLabels.buy;
                       const isExpanded = expandedId === signal.id;
                       const isTakenDown = signal.status === 'taken_down';
                       const hasDetail = signal.reason_detail || signal.risk_notes || signal.reason_summary || (isTakenDown && signal.taken_down_reason);
                       return (
                         <React.Fragment key={signal.id}>
                           <tr className={cn(
                             "border-b last:border-0 hover:bg-muted/30"
                           )}>
                             <td className="p-3 text-sm text-muted-foreground whitespace-nowrap">{signal.published_at ? new Date(signal.published_at).toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                             <td className="p-3 text-sm font-medium">{signal.instrument}</td>
                             <td className="p-3"><Badge variant={ai.variant} className="text-xs">{ai.label}</Badge></td>
                             <td className="p-3 text-sm">{signal.price_hint || '-'}</td>
                             <td className="p-3 text-sm max-w-[240px]">
                               {isTakenDown && signal.taken_down_reason ? (
                                 <p className="text-primary truncate text-xs">
                                   <span className="font-medium">下架理由：</span>{stripDotPrefix(signal.taken_down_reason)}
                                 </p>
                               ) : (
                                 <p className="text-muted-foreground truncate">{stripDotPrefix(signal.reason_summary || '-')}</p>
                               )}
                             </td>
                             <td className="p-3">
                               {isTakenDown ? (
                                 <Badge className="text-xs border border-primary/40 bg-primary/10 text-primary">已下架</Badge>
                               ) : (
                                 <Badge variant="secondary" className="text-xs">已發布</Badge>
                               )}
                             </td>
                             <td className="p-3">
                               {hasDetail && (
                                 <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setExpandedId(isExpanded ? null : signal.id)}>
                                   {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                   {isExpanded ? '收起' : '展開'}
                                 </Button>
                               )}
                             </td>
                           </tr>
                           {isExpanded && (
                             <tr className="border-b last:border-0">
                               <td colSpan={7} className="p-0">
                                 <div className="bg-muted/30 px-6 py-3 text-xs space-y-2">
                                    {isTakenDown && signal.taken_down_reason && (
                                      <div>
                                        <span className="font-medium text-primary">下架理由</span>
                                        <p className="text-primary/90 mt-0.5 whitespace-pre-wrap">{stripDotPrefix(signal.taken_down_reason)}</p>
                                      </div>
                                    )}
                                    {signal.reason_summary && (
                                      <div>
                                        <span className="font-medium text-foreground">摘要</span>
                                        <p className="text-muted-foreground mt-0.5 whitespace-pre-wrap">{stripDotPrefix(signal.reason_summary)}</p>
                                      </div>
                                    )}
                                    {signal.reason_detail && (
                                      <div>
                                        <span className="font-medium text-foreground">詳細分析</span>
                                        <p className="text-muted-foreground mt-0.5 whitespace-pre-wrap">{stripDotPrefix(signal.reason_detail)}</p>
                                      </div>
                                    )}
                                    {signal.risk_notes && (
                                      <div>
                                        <span className="font-medium text-foreground">風險提示</span>
                                        <p className="text-muted-foreground mt-0.5 whitespace-pre-wrap">{stripDotPrefix(signal.risk_notes)}</p>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                         </React.Fragment>
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
