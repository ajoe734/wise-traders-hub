import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
import { Plus, Search, Filter, Eye, ChevronDown, ChevronUp, Loader2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

const stripDotPrefix = (text: string) => text.replace(/^[•·．‧●○◆■□▪▫※☆★→➤➜▸▹►▻‣⁃–—\-]\s*/gm, '');

const actionLabels: Record<string, { label: string; className: string }> = {
  buy: { label: '買進', className: 'bg-success text-white border-success' },
  sell: { label: '賣出', className: 'bg-destructive text-white border-destructive' },
};

const AdminSignals = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const { hasRole } = useAuth();
  const isReadOnly = hasRole('company_admin');
  const [expert, setExpert] = useState<any>(null);
  const [signals, setSignals] = useState<any[]>([]);
  const [openInstruments, setOpenInstruments] = useState<Set<string>>(new Set());
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
  const [quantity, setQuantity] = useState('');
  const [quantityUnit, setQuantityUnit] = useState('張');
  const [fetchingQuote, setFetchingQuote] = useState(false);
  const [linePushing, setLinePushing] = useState(false);
  const [linePushed, setLinePushed] = useState(false);
  const [recalling, setRecalling] = useState(false);
  const [lastPublishedId, setLastPublishedId] = useState<string | null>(null);
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 判斷是否為休市時段（週五 13:30 ~ 週一 09:00，台灣時間 UTC+8）
  const isMarketClosed = useCallback(() => {
    const now = new Date();
    // Convert to Taiwan time (UTC+8)
    const twOffset = 8 * 60; // minutes
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const tw = new Date(utcMs + twOffset * 60000);
    const day = tw.getDay(); // 0=Sun, 6=Sat
    const hhmm = tw.getHours() * 100 + tw.getMinutes();

    if (day === 0) return true; // Sunday
    if (day === 6) return true; // Saturday
    if (day === 5 && hhmm >= 1330) return true; // Friday after 13:30
    if (day === 1 && hhmm < 900) return true;  // Monday before 09:00
    return false;
  }, []);

  const fetchStockInfo = useCallback(async (code: string) => {
    if (!code.trim() || code.trim().length < 4) return;
    setFetchingQuote(true);
    try {
      if (isMarketClosed() && expert?.user_id) {
        // 休市期間：從 user_performances 取最後收盤價
        const { data: perf } = await supabase
          .from('user_performances')
          .select('name, current_price')
          .eq('user_id', expert.user_id)
          .eq('symbol', code.trim())
          .limit(1)
          .maybeSingle();

        if (perf) {
          if (perf.name) setStockName(perf.name);
          if (perf.current_price != null) setPriceHint(String(perf.current_price));
          setFetchingQuote(false);
          return;
        }
        // 如果 user_performances 沒有該股票，fallback 到 API
      }

      const res = await fetch(`https://subsystem-production.up.railway.app/stock_info?symbol=${code.trim()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.name) setStockName(data.name);
      }
    } catch (e) {
      console.error('stock_info fetch error:', e);
    }
    setFetchingQuote(false);
  }, [isMarketClosed, expert?.user_id]);

  const handleStockCodeChange = (value: string) => {
    setStockCode(value);
    if (fetchTimer.current) clearTimeout(fetchTimer.current);
    if (value.trim().length >= 4) {
      fetchTimer.current = setTimeout(() => fetchStockInfo(value), 500);
    }
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
      // Fetch open trade_records to determine position status
      const { data: openTrades } = await supabase
        .from('trade_records')
        .select('instrument')
        .eq('expert_id', exp.id)
        .eq('status', 'open');
      setOpenInstruments(new Set((openTrades || []).map(t => t.instrument)));
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

    if (!quantity || parseInt(quantity) <= 0) {
      toast.error('請輸入數量');
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
      quantity: quantity ? parseInt(quantity) : null,
      quantity_unit: quantityUnit,
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

      if (action === 'exit') {
        // 平損：全部關閉
        await supabase
          .from('trade_signals')
          .update({ status: 'closed' } as any)
          .eq('user_id', expert.user_id)
          .eq('symbol', stockCode.trim())
          .eq('status', 'open');

        await supabase
          .from('user_performances')
          .delete()
          .eq('user_id', expert.user_id)
          .eq('symbol', stockCode.trim());

      } else if (action === 'sell' || action === 'trim') {
        // 賣出/減碼：檢查 trade_records 是否仍有 open 持倉
        // trigger 已先更新 trade_records，這裡查詢結果即為最新狀態
        const { data: remainingTrade } = await supabase
          .from('trade_records')
          .select('id')
          .eq('expert_id', expert.id)
          .eq('instrument', `${stockCode.trim()} ${latestName || ''}`.trim())
          .eq('status', 'open')
          .limit(1);

        if (!remainingTrade || remainingTrade.length === 0) {
          // 全部賣完，關閉 trade_signals 並移除 user_performances
          await supabase
            .from('trade_signals')
            .update({ status: 'closed' } as any)
            .eq('user_id', expert.user_id)
            .eq('symbol', stockCode.trim())
            .eq('status', 'open');

          await supabase
            .from('user_performances')
            .delete()
            .eq('user_id', expert.user_id)
            .eq('symbol', stockCode.trim());
        }
        // 部分賣出：trade_signals 維持 open
      } else if (action === 'add') {
        // 加碼：若已有 open 紀錄則不重複新增
        const { data: existing } = await supabase
          .from('trade_signals')
          .select('id')
          .eq('user_id', expert.user_id)
          .eq('symbol', stockCode.trim())
          .eq('status', 'open')
          .limit(1);

        if (!existing || existing.length === 0) {
          const { data: tsData } = await supabase.from('trade_signals').insert({
            user_id: expert.user_id,
            symbol: stockCode.trim(),
            name: latestName || null,
            entry_price: entryPrice,
            status: 'open',
          } as any).select('id').single();

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
      } else {
        // 買進：新增一筆 open 紀錄
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
    setLastPublishedId(null);
    setStockCode(''); setStockName(''); setAction(''); setPriceHint(''); setQuantity(''); setQuantityUnit('張'); setReasonSummary(''); setReasonDetail(''); setRiskNotes(''); setLearningPoints('');
    setLinePushed(false); setLinePushing(false);

    // Trigger LINE push notification (non-blocking) — skip if advisor already did preview push
    const skipLinePush = isAdvisor && linePushed;
    if (inserted?.id && !skipLinePush) {
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

  const handleRecall = async (signalId: string) => {
    if (!expert || recalling) return;
    setRecalling(true);
    try {
      // Fetch signal data before deleting for LINE push
      const { data: signal } = await supabase
        .from('expert_signals')
        .select('*')
        .eq('id', signalId)
        .single();

      if (!signal) {
        toast.error('找不到該訊號');
        setRecalling(false);
        return;
      }

      // Push recall notification via LINE using preview mode with signal data
      supabase.functions.invoke('line-push-signal', {
        body: {
          expert_id: expert.id,
          mode: 'preview',
          signal_data: {
            action: signal.action,
            instrument: signal.instrument,
            price_hint: signal.price_hint,
          },
          type: 'takedown',
        },
      }).then(({ data: pushData }) => {
        if (pushData?.pushed) {
          toast.success(`已推播收回通知給 ${pushData.count} 位訂閱者`);
        }
      }).catch(() => {});

      // Clean up related trade data BEFORE deleting the signal (FK constraint)
      const symbol = signal.instrument.split(' ')[0];

      if (expert.user_id && symbol) {
        // Check if there are other published signals for same instrument (excluding this one)
        const { data: otherSignals } = await supabase
          .from('expert_signals')
          .select('id')
          .eq('expert_id', expert.id)
          .eq('status', 'published' as any)
          .ilike('instrument', `${symbol}%`)
          .neq('id', signalId)
          .limit(1);

        // If no other signals remain, clean up all related trade data
        if (!otherSignals || otherSignals.length === 0) {
          await Promise.all([
            supabase.from('trade_records').delete().eq('expert_id', expert.id).ilike('instrument', `${symbol}%`),
            supabase.from('trade_signals').delete().eq('user_id', expert.user_id).eq('symbol', symbol),
            supabase.from('user_performances').delete().eq('user_id', expert.user_id).eq('symbol', symbol),
          ]);
        } else {
          // Still has other signals — only delete trade_records linked to THIS signal
          await supabase.from('trade_records').delete().eq('signal_id', signalId);
        }
      }

      // Now safe to delete the signal itself
      await supabase.from('expert_signals').delete().eq('id', signalId);

      toast.success('訊號已收回');
      setSignals(prev => prev.filter(s => s.id !== signalId));
      setLastPublishedId(null);
      fetchData();
    } catch (err) {
      console.error('Recall failed:', err);
      toast.error('收回失敗，請重試');
    }
    setRecalling(false);
  };

  const isAdvisor = expert?.role === 'advisor';
  const isMentor = expert?.role === 'mentor';
  const contentLabel = isMentor ? '週記' : '訊號';
  const canPublish = !!expert && !!stockCode.trim() && !!action;

  // Determine which buy signals are actually "加碼" (subsequent buys for same instrument)
  const addBuySignalIds = useMemo(() => {
    const ids = new Set<string>();
    const sorted = [...signals].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const openPositions = new Map<string, boolean>();
    for (const s of sorted) {
      if (s.status === 'taken_down') continue;
      const inst = s.instrument;
      if (s.action === 'buy') {
        if (openPositions.get(inst)) {
          ids.add(s.id);
        } else {
          openPositions.set(inst, true);
        }
      } else if (s.action === 'add') {
        openPositions.set(inst, true);
      } else if (s.action === 'exit') {
        openPositions.set(inst, false);
      } else if (s.action === 'sell' || s.action === 'trim') {
        if (!openInstruments.has(inst)) {
          openPositions.set(inst, false);
        }
      }
    }
    return ids;
  }, [signals, openInstruments]);

  // Multi-condition search: conditions separated by "、"
  const actionLabelMap: Record<string, string> = { '買進': 'buy', '賣出': 'sell', '平損': 'exit' };
  const statusOnlyKeywords = ['持有中', '已平倉', '已收回'];

  const getDisplayStatus = (s: any) => {
    if (s.status === 'taken_down') return '已收回';
    if (s.action === 'exit') return '已平倉';
    if (['sell', 'trim'].includes(s.action)) return openInstruments.has(s.instrument) ? '減碼' : '已平倉';
    if (s.action === 'add') return '加碼';
    if (s.action === 'buy' && addBuySignalIds.has(s.id)) return '加碼';
    return '持有中';
  };

  const filtered = signals.filter(s => {
    if (!searchQuery.trim()) return true;
    const conditions = searchQuery.split('、').map(c => c.trim()).filter(Boolean);
    const sigDateFull = s.published_at ? new Date(s.published_at).toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    const displayStatus = getDisplayStatus(s);

    return conditions.every(cond => {
      const lower = cond.toLowerCase();
      if (actionLabelMap[cond]) return s.action === actionLabelMap[cond];
      if (statusOnlyKeywords.includes(cond)) return displayStatus === cond;
      if (cond === '加碼') return s.action === 'add' || displayStatus === '加碼';
      if (cond === '減碼') return s.action === 'trim' || displayStatus === '減碼';
      return (
        s.instrument?.toLowerCase().includes(lower) ||
        sigDateFull.includes(cond) ||
        s.reason_summary?.toLowerCase().includes(lower)
      );
    });
  });

  // Calculate current holding quantity for the searched instrument
  const holdingSummary = useMemo(() => {
    if (!searchQuery.trim()) return null;
    // Group filtered published signals by instrument and compute net quantity
    const instrumentMap = new Map<string, { qty: number; unit: string }>();
    for (const s of filtered) {
      if (s.status === 'taken_down') continue;
      const inst = s.instrument;
      const qty = s.quantity || 1;
      const unit = s.quantity_unit || '張';
      const current = instrumentMap.get(inst) || { qty: 0, unit };
      if (s.action === 'buy' || s.action === 'add') {
        instrumentMap.set(inst, { qty: current.qty + qty, unit });
      } else if (s.action === 'sell' || s.action === 'trim') {
        instrumentMap.set(inst, { qty: current.qty - qty, unit });
      } else if (s.action === 'exit') {
        instrumentMap.set(inst, { qty: 0, unit });
      }
    }
    const entries = Array.from(instrumentMap.entries()).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return null;
    return entries.map(([inst, v]) => ({ instrument: inst, quantity: Math.max(0, v.qty), unit: v.unit }));
  }, [filtered, searchQuery]);

  if (loading) return <AdminLayout><div className="flex items-center justify-center h-64 text-muted-foreground">載入中...</div></AdminLayout>;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{contentLabel}管理</h1>
            <p className="text-muted-foreground text-sm mt-1">{isMentor ? '每週發布，可自行收回' : '發布即上線，可自行收回'}</p>
          </div>
          {!isReadOnly && (
          <Dialog open={isCreateOpen} onOpenChange={(open) => { setIsCreateOpen(open); if (!open) { setLinePushed(false); setLinePushing(false); setLastPublishedId(null); } }}>
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
                    <Input value={stockCode} onChange={e => handleStockCodeChange(e.target.value)} placeholder="例：2330" />
                  </div>
                  <div className="space-y-2">
                    <Label>股票名稱 {fetchingQuote && <Loader2 className="inline h-3 w-3 animate-spin text-muted-foreground" />}</Label>
                    <Input value={stockName} onChange={e => setStockName(e.target.value)} placeholder="" />
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
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>參考價位</Label>
                    <Input value={priceHint} onChange={e => setPriceHint(e.target.value)} type="number" placeholder="890" />
                  </div>
                </div>
                {action && (
                  <div className="space-y-2">
                    <Label>數量</Label>
                    <div className="flex items-center gap-2">
                      <Input value={quantity} onChange={e => setQuantity(e.target.value)} type="number" placeholder="1" className="w-32" />
                      <Select value={quantityUnit} onValueChange={setQuantityUnit}>
                        <SelectTrigger className="w-20">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="張">張</SelectItem>
                          <SelectItem value="股">股</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>操作理由（摘要）</Label>
                  <Textarea value={reasonSummary} onChange={e => setReasonSummary(e.target.value)} placeholder="簡述操作原因..." rows={2} />
                  {isAdvisor && canPublish && (
                    <div className="flex gap-2 mt-1">
                      <Button
                        type="button"
                        variant="outline"
                        className={cn("flex-1 border-advisor text-advisor hover:bg-advisor/10", linePushed && "opacity-60 cursor-default")}
                        disabled={linePushing || linePushed || !reasonSummary.trim()}
                        onClick={async () => {
                          if (!expert) return;
                          if (!quantity || parseInt(quantity) <= 0) {
                            toast.error('請輸入數量');
                            return;
                          }
                          setLinePushing(true);
                          try {
                            const instrument = stockName.trim() ? `${stockCode.trim()} ${stockName.trim()}` : stockCode.trim();
                            const { data: pushData, error: pushError } = await supabase.functions.invoke('line-push-signal', {
                              body: {
                                expert_id: expert.id,
                                mode: 'preview',
                                signal_data: {
                                  action,
                                  instrument,
                                  price_hint: priceHint ? parseFloat(priceHint) : null,
                                  quantity: quantity ? parseInt(quantity) : null,
                                  quantity_unit: quantityUnit,
                                  reason_summary: reasonSummary,
                                },
                              },
                            });
                            if (pushError) {
                              toast.error(`LINE 推播失敗：${pushError.message}`);
                            } else if (pushData?.pushed) {
                              toast.success(`已推播給 ${pushData.count} 位訂閱者`);
                              setLinePushed(true);
                              // Store preview signal data for potential recall
                              setLastPublishedId('preview');
                            } else if (pushData?.reason) {
                              toast.info(`LINE 推播略過：${pushData.reason}`);
                              setLinePushed(true);
                            }
                          } catch (err) {
                            console.error('LINE preview push error:', err);
                            toast.error('LINE 推播呼叫失敗');
                          }
                          setLinePushing(false);
                        }}
                      >
                        {linePushing ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />推播中...</> : linePushed ? '✅ 已成功發布' : '優先發布(Line推播)'}
                      </Button>
                      {linePushed && (
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          className="shrink-0"
                          disabled={recalling}
                          onClick={async () => {
                            if (!expert) return;
                            setRecalling(true);
                            try {
                              // Push recall notification via LINE for the preview signal
                              const instrument = stockName.trim() ? `${stockCode.trim()} ${stockName.trim()}` : stockCode.trim();
                              await supabase.functions.invoke('line-push-signal', {
                                body: {
                                  expert_id: expert.id,
                                  mode: 'preview',
                                  signal_data: {
                                    action,
                                    instrument,
                                    price_hint: priceHint ? parseFloat(priceHint) : null,
                                    
                                  },
                                  type: 'takedown',
                                },
                              });
                              toast.success('已推播收回通知');
                              setIsCreateOpen(false);
                              setLastPublishedId(null);
                              setLinePushed(false);
                              setStockCode(''); setStockName(''); setAction(''); setPriceHint(''); setQuantity(''); setQuantityUnit('張'); setReasonSummary(''); setReasonDetail(''); setRiskNotes(''); setLearningPoints('');
                            } catch (err) {
                              console.error('Recall preview push error:', err);
                              toast.error('收回推播失敗');
                            }
                            setRecalling(false);
                          }}
                        >
                          {recalling ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Undo2 className="h-4 w-4 mr-1" />收回</>}
                        </Button>
                      )}
                    </div>
                  )}
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
                        {quantity && <span className="text-sm text-muted-foreground">{quantity} {quantityUnit}</span>}
                      </div>
                      {reasonSummary && <p className="text-sm">{reasonSummary}</p>}
                      {reasonDetail && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{reasonDetail}</p>}
                      {riskNotes && <p className="text-xs text-destructive">⚠️ {riskNotes}</p>}
                      {isMentor && learningPoints && <p className="text-xs text-primary">📌 {learningPoints}</p>}
                    </CardContent>
                  </Card>
                )}
                <div className="flex justify-end gap-3 pt-2">
                  <Button variant="outline" onClick={() => { setIsCreateOpen(false); setLastPublishedId(null); }}>取消</Button>
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
            <Input placeholder="搜尋：標的、日期、方向、狀態（用「、」分隔）" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-10" />
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
                              "border-b last:border-0 hover:bg-muted/30",
                              isTakenDown && "opacity-40"
                            )}>
                             <td className="p-3 text-sm text-muted-foreground whitespace-nowrap">{signal.published_at ? new Date(signal.published_at).toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                             <td className="p-3 text-sm font-medium">{signal.instrument}</td>
                             <td className="p-3"><Badge className={`${ai.className} text-xs`}>{ai.label}</Badge></td>
                             <td className="p-3 text-sm">
                               {signal.price_hint ? (
                                 <>
                                   {signal.price_hint}
                                   {signal.quantity && (
                                     <span className="text-muted-foreground">({signal.quantity}{signal.quantity_unit || '張'})</span>
                                   )}
                                 </>
                               ) : '-'}
                             </td>
                             <td className="p-3 text-sm max-w-[240px]">
                                {isTakenDown && signal.taken_down_reason ? (
                                  <p className="text-primary truncate text-xs">
                                    <span className="font-medium">收回理由：</span>{stripDotPrefix(signal.taken_down_reason)}
                                 </p>
                               ) : (
                                 <p className="text-muted-foreground truncate">{stripDotPrefix(signal.reason_summary || '-')}</p>
                               )}
                             </td>
                               <td className="p-3">
                                  {isTakenDown ? (
                                    <Badge className="text-xs border border-primary/40 bg-primary/10 text-primary">已收回</Badge>
                                 ) : signal.action === 'exit' ? (
                                   <Badge className="text-xs border border-muted-foreground/40 bg-muted text-muted-foreground">已平倉</Badge>
                                 ) : ['sell', 'trim'].includes(signal.action) ? (
                                   openInstruments.has(signal.instrument) ? (
                                     <Badge className="text-xs border border-amber-400/40 bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700">減碼</Badge>
                                   ) : (
                                     <Badge className="text-xs border border-muted-foreground/40 bg-muted text-muted-foreground">已平倉</Badge>
                                   )
                                 ) : signal.action === 'add' ? (
                                   <Badge className="text-xs border border-blue-400/40 bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-700">加碼</Badge>
                                  ) : signal.action === 'buy' && addBuySignalIds.has(signal.id) ? (
                                    <Badge className="text-xs border border-blue-400/40 bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-700">加碼</Badge>
                                  ) : (
                                    <Badge className="text-xs border border-border bg-white text-foreground dark:bg-white dark:text-black">持有中</Badge>
                                   )}
                                </td>
                               <td className="p-3">
                                <div className="flex items-center gap-1">
                                  {hasDetail && (
                                    <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setExpandedId(isExpanded ? null : signal.id)}>
                                      {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                      {isExpanded ? '收起' : '展開'}
                                    </Button>
                                  )}
                                  {!isTakenDown && !isReadOnly && (
                                    <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-destructive hover:text-destructive" onClick={() => handleRecall(signal.id)} disabled={recalling}>
                                      <Undo2 className="h-3 w-3" />收回
                                    </Button>
                                  )}
                                </div>
                              </td>
                           </tr>
                           {isExpanded && (
                             <tr className="border-b last:border-0">
                               <td colSpan={7} className="p-0">
                                 <div className="bg-muted/30 px-6 py-3 text-xs space-y-2">
                                     {isTakenDown && signal.taken_down_reason && (
                                       <div>
                                         <span className="font-medium text-primary">收回理由</span>
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
                {holdingSummary && holdingSummary.length > 0 && (
                  <tfoot>
                    {holdingSummary.map(({ instrument, quantity, unit }) => (
                      <tr key={instrument} className="border-t bg-muted/40">
                        <td colSpan={3} className="p-3 text-sm font-medium text-muted-foreground">
                          {instrument} 目前持有
                        </td>
                        <td className="p-3 text-sm font-bold text-foreground">
                          {quantity} {unit}
                        </td>
                        <td colSpan={3}></td>
                      </tr>
                    ))}
                  </tfoot>
                )}
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
};

export default AdminSignals;
