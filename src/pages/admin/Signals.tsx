import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
import { Plus, Search, Filter, Eye, ChevronDown, ChevronUp, Loader2, Undo2, Lightbulb, Target, AlertTriangle, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { isPublishingWindowOpen, canRecallSignal } from '@/lib/publishingWindow';
import { fetchAnalystSignals } from '@/lib/analystDataAccess';
import { PermissionTooltip } from '@/components/admin/PermissionTooltip';
import { useFormDraft } from '@/hooks/useFormDraft';
import { SafeRichHtml, richHtmlPreview } from '@/components/SafeRichHtml';

const stripDotPrefix = (text: string) => text.replace(/^[•·．‧●○◆■□▪▫※☆★→➤➜▸▹►▻‣⁃–—\-]\s*/gm, '');

const actionLabels: Record<string, { label: string; className: string }> = {
  buy: { label: '買進', className: 'bg-success text-white border-success' },
  sell: { label: '賣出', className: 'bg-destructive text-white border-destructive' },
  add: { label: '加碼', className: 'bg-blue-500 text-blue-50 border-blue-500' },
  trim: { label: '減碼', className: 'bg-amber-500 text-amber-50 border-amber-500' },
  exit: { label: '平損', className: 'bg-slate-500 text-slate-50 border-slate-500' },
};

const PreviewTradeItem = ({ action, instrument, priceHint, reasonSummary, reasonDetail, riskNotes }: {
  action: string; instrument: string; priceHint?: number | null; reasonSummary: string; reasonDetail: string; riskNotes: string;
}) => {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = reasonSummary || reasonDetail || riskNotes;
  const ai = actionLabels[action] || actionLabels.buy;
  return (
    <div className="px-4 py-3">
      <div className={`flex items-center gap-3 ${hasDetails ? 'cursor-pointer' : ''}`} onClick={() => hasDetails && setExpanded(!expanded)}>
        <Badge className={cn(ai.className, 'text-[10px] px-1.5 py-0')}>{ai.label}</Badge>
        <div className="flex-1 min-w-0">
          <span className="font-medium text-sm">{instrument}</span>
          {priceHint != null && <span className="text-xs text-muted-foreground ml-1">@{priceHint}</span>}
        </div>
        {hasDetails && (
          <button className="text-muted-foreground shrink-0">
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        )}
      </div>
      {expanded && hasDetails && (
        <div className="mt-3 ml-9 space-y-3">
          {reasonSummary && (
            <div>
              <h3 className="text-xs font-semibold flex items-center gap-1.5 mb-1">
                <Lightbulb className="h-3.5 w-3.5 text-primary" /> 為什麼這樣操作？
              </h3>
              <p className="text-xs text-muted-foreground whitespace-pre-line">{reasonSummary}</p>
            </div>
          )}
          {reasonDetail && (
            <div>
              <h3 className="text-xs font-semibold flex items-center gap-1.5 mb-1">
                <Target className="h-3.5 w-3.5 text-primary" /> 部位控管想法
              </h3>
              <p className="text-xs text-muted-foreground whitespace-pre-line">{reasonDetail}</p>
            </div>
          )}
          {riskNotes && (
            <div>
              <h3 className="text-xs font-semibold flex items-center gap-1.5 mb-1 text-warning">
                <AlertTriangle className="h-3.5 w-3.5" /> 風險提醒
              </h3>
              <p className="text-xs text-muted-foreground whitespace-pre-line">{riskNotes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const AdminSignals = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();
  // company_admin 與分析師本人皆有完整寫入權；其他人為唯讀
  const isCompanyAdmin = hasRole('company_admin');
  const isOwner = !!user?.expertSlug && user.expertSlug === expertSlug;
  const isReadOnly = !isCompanyAdmin && !isOwner;
  const [expert, setExpert] = useState<any>(null);
  const [signals, setSignals] = useState<any[]>([]);
  const [openInstruments, setOpenInstruments] = useState<Set<string>>(new Set());
  const [plans, setPlans] = useState<any[]>([]);
  const [signalTemplates, setSignalTemplates] = useState<{ id: string; title: string; action: string; reason: string; risk_note: string; strategy_note: string }[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  // Only persist dialog open state across navigation (not form content)
  const FORM_KEY = `signal-form-${expertSlug}`;
  const getSavedOpen = () => {
    try { return !!JSON.parse(sessionStorage.getItem(FORM_KEY) || '{}')?._open; } catch { return false; }
  };

  const [isCreateOpen, setIsCreateOpen] = useState(getSavedOpen);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Form — always start blank
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
  const [teachingTopic, setTeachingTopic] = useState('');
  const [overallSummary, setOverallSummary] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [fetchingQuote, setFetchingQuote] = useState(false);
  const [linePushing, setLinePushing] = useState(false);
  const [linePushed, setLinePushed] = useState(false);
  const [recalling, setRecalling] = useState(false);
  const [repushingId, setRepushingId] = useState<string | null>(null);
  const [lastPublishedId, setLastPublishedId] = useState<string | null>(null);
  const [collapsedBatches, setCollapsedBatches] = useState<Set<string>>(new Set());
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist only dialog open state
  useEffect(() => {
    if (isCreateOpen) {
      sessionStorage.setItem(FORM_KEY, JSON.stringify({ _open: true }));
    } else {
      sessionStorage.removeItem(FORM_KEY);
    }
  }, [isCreateOpen, FORM_KEY]);

  // 草稿自動暫存（含 mentor 周記三欄：teachingTopic / overallSummary / learningPoints）
  // 規範：mem://management/form-persistence-rules
  const DRAFT_KEY = `signal-draft-${expertSlug}`;
  const draftValue = useMemo(() => ({
    stockCode, stockName, action, priceHint, quantity, quantityUnit,
    reasonSummary, reasonDetail, riskNotes, learningPoints,
    teachingTopic, overallSummary,
  }), [
    stockCode, stockName, action, priceHint, quantity, quantityUnit,
    reasonSummary, reasonDetail, riskNotes, learningPoints,
    teachingTopic, overallSummary,
  ]);
  const { discard: discardDraft } = useFormDraft(
    DRAFT_KEY,
    draftValue,
    (saved) => {
      if (typeof saved.stockCode === 'string') setStockCode(saved.stockCode);
      if (typeof saved.stockName === 'string') setStockName(saved.stockName);
      if (typeof saved.action === 'string') setAction(saved.action);
      if (typeof saved.priceHint === 'string') setPriceHint(saved.priceHint);
      if (typeof saved.quantity === 'string') setQuantity(saved.quantity);
      if (typeof saved.quantityUnit === 'string') setQuantityUnit(saved.quantityUnit);
      if (typeof saved.reasonSummary === 'string') setReasonSummary(saved.reasonSummary);
      if (typeof saved.reasonDetail === 'string') setReasonDetail(saved.reasonDetail);
      if (typeof saved.riskNotes === 'string') setRiskNotes(saved.riskNotes);
      if (typeof saved.learningPoints === 'string') setLearningPoints(saved.learningPoints);
      if (typeof saved.teachingTopic === 'string') setTeachingTopic(saved.teachingTopic);
      if (typeof saved.overallSummary === 'string') setOverallSummary(saved.overallSummary);
    },
    { enabled: isCreateOpen }
  );

  const clearForm = useCallback(() => {
    setStockCode(''); setStockName(''); setAction(''); setPriceHint(''); setQuantity(''); setQuantityUnit('張');
    setReasonSummary(''); setReasonDetail(''); setRiskNotes(''); setLearningPoints('');
    setTeachingTopic(''); setOverallSummary('');
    setLinePushed(false); setLinePushing(false); setLastPublishedId(null);
    setShowPreview(false);
    sessionStorage.removeItem(FORM_KEY);
    discardDraft();
  }, [FORM_KEY, discardDraft]);

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

      // Use stockNameResolver: cache-first → DB → batched TWSE API
      const { resolveStockName } = await import('@/lib/stockNameResolver');
      const name = await resolveStockName(code.trim());
      if (name) setStockName(name);
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

  const lastFetchRef = useRef<number>(0);
  const fetchData = useCallback(async (force = false) => {
    if (!expertSlug) return;
    // Skip refetch if data was loaded recently (within 30s) unless forced
    const now = Date.now();
    if (!force && expert && lastFetchRef.current && now - lastFetchRef.current < 30_000) return;
    // Only show loading spinner on first load (no existing data)
    if (!expert) setLoading(true);
    const { data: exp } = await supabase.from('experts').select('*').eq('slug', expertSlug).single();
    setExpert(exp);
    if (exp) {
      const { signals: fetchedSignals } = await fetchAnalystSignals(supabase, exp.id);
      setSignals(fetchedSignals);
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
    lastFetchRef.current = Date.now();
    setLoading(false);
  }, [expertSlug, expert]);

  useEffect(() => { fetchData(); }, [expertSlug]);

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

    if (!priceHint || parseFloat(priceHint) <= 0) {
      toast.error('請輸入參考價格');
      return;
    }

    const latestName = stockName.trim();

    // ISSUE-014: Validate open position exists for ADD/TRIM/EXIT actions
    if (['add', 'trim', 'sell', 'exit'].includes(action)) {
      const instrumentSearch = latestName ? `${stockCode.trim()} ${latestName}` : stockCode.trim();
      const { data: openPos } = await supabase
        .from('trade_records')
        .select('id, quantity')
        .eq('expert_id', expert.id)
        .ilike('instrument', `${stockCode.trim()}%`)
        .eq('status', 'open')
        .limit(1)
        .maybeSingle();

      if (!openPos) {
        toast.error(`尚無 ${stockCode.trim()} 的未平倉部位，無法執行${action === 'add' ? '加碼' : action === 'exit' ? '平損' : '減碼'}操作`);
        return;
      }

      // Check trim/sell quantity doesn't exceed holding
      if (['trim', 'sell'].includes(action) && parseInt(quantity) > openPos.quantity) {
        toast.error(`減碼數量 (${quantity}) 超過持倉量 (${openPos.quantity})`);
        return;
      }
    }
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
      teaching_topic: teachingTopic || null,
      overall_summary: overallSummary || null,
      status: (isMentor ? 'pending' : 'published') as any,
    } as any).select('id').single();
    if (error) { toast.error(error.message); return; }

    // 同步寫入 trade_signals + user_performances（跟單派＋修煉派皆同步）
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

    toast.success(isMentor ? '週記已儲存，將於本週五 20:00 統一發布' : '訊號已發布');
    setIsCreateOpen(false);
    clearForm();

    // Trigger LINE push notification (non-blocking) — skip for mentors (batch on Friday) and if advisor already did preview push
    const skipLinePush = isMentor || (isAdvisor && linePushed);
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

    fetchData(true);
  };

  const handleRecall = async (signalId: string) => {
    if (!expert || recalling) return;

    // 若屬於批次（同篇週記），預設整批一起收回
    const target = signals.find((s: any) => s.id === signalId) as any;
    const batchId = target?.batch_id || null;
    const batchSiblings = batchId ? signals.filter((s: any) => s.batch_id === batchId) : [];
    const isBatch = batchSiblings.length > 1;

    if (isBatch) {
      const ok = window.confirm(
        `這是同一篇週記的批次發布，共 ${batchSiblings.length} 檔（${batchSiblings.map((s: any) => s.instrument).join('、')}）。要一起收回嗎？`,
      );
      if (!ok) return;
    }

    setRecalling(true);
    try {
      const idsToRecall = isBatch ? batchSiblings.map((s: any) => s.id) : [signalId];

      const { data: signalsToRecall } = await supabase
        .from('expert_signals')
        .select('*')
        .in('id', idsToRecall);

      if (!signalsToRecall || signalsToRecall.length === 0) {
        toast.error('找不到該訊號');
        setRecalling(false);
        return;
      }

      // LINE 收回通知（pending 的 mentor 訊號不推）
      const pushable = signalsToRecall.filter((s: any) => !(isMentor && s.status === 'pending'));
      if (pushable.length > 0) {
        // 每筆推一則（既有 line-push-signal 對 recall 是單筆）
        await Promise.all(
          pushable.map((s: any) =>
            supabase.functions
              .invoke('line-push-signal', {
                body: {
                  expert_id: expert.id,
                  mode: 'preview',
                  signal_data: { action: s.action, instrument: s.instrument, price_hint: s.price_hint },
                  type: 'recall',
                },
              })
              .catch(() => {}),
          ),
        );
      }

      // 清交易紀錄並刪訊號
      for (const sig of signalsToRecall) {
        const symbol = sig.instrument.split(' ')[0];
        if (expert.user_id && symbol) {
          const { data: otherSignals } = await supabase
            .from('expert_signals')
            .select('id')
            .eq('expert_id', expert.id)
            .eq('status', 'published' as any)
            .ilike('instrument', `${symbol}%`)
            .not('id', 'in', `(${idsToRecall.map((x) => `"${x}"`).join(',')})`)
            .limit(1);

          if (!otherSignals || otherSignals.length === 0) {
            await Promise.all([
              supabase.from('trade_records').delete().eq('expert_id', expert.id).ilike('instrument', `${symbol}%`),
              supabase.from('trade_signals').delete().eq('user_id', expert.user_id).eq('symbol', symbol),
              supabase.from('user_performances').delete().eq('user_id', expert.user_id).eq('symbol', symbol),
            ]);
          } else {
            await supabase.from('trade_records').delete().eq('signal_id', sig.id);
          }
        }
      }

      await supabase.from('expert_signals').delete().in('id', idsToRecall);

      toast.success(isBatch ? `已收回批次 ${idsToRecall.length} 筆訊號` : '訊號已收回');
      setSignals((prev) => prev.filter((s) => !idsToRecall.includes(s.id)));
      setLastPublishedId(null);
      fetchData(true);
    } catch (err) {
      console.error('Recall failed:', err);
      toast.error('收回失敗，請重試');
    }
    setRecalling(false);
  };

  const handleRepush = async (signalId: string) => {
    if (!expert || repushingId) return;
    setRepushingId(signalId);
    try {
      const { data, error } = await supabase.functions.invoke('line-push-signal', {
        body: { signal_id: signalId, expert_id: expert.id, is_update: true },
      });
      if (error) {
        toast.error(`重推失敗：${error.message}`);
      } else if (data?.pushed) {
        toast.success(`已重推給 ${data.count} 位 LINE 訂閱者（標記為「已更新」）`);
      } else if (data?.reason) {
        toast.info(`未推播：${data.reason}`);
      } else {
        toast.info('未推播：無有效收件者');
      }
    } catch (err: any) {
      console.error('Repush failed:', err);
      toast.error('重推失敗，請重試');
    }
    setRepushingId(null);
  };

  const isAdvisor = expert?.role === 'advisor';
  const isMentor = expert?.role === 'mentor';
  const contentLabel = isMentor ? '週記' : '訊號';
  const publishWindow = isPublishingWindowOpen();
  const canPublish = isMentor
    ? !!expert && !!stockCode.trim() && !!action && !!teachingTopic.trim()
    : !!expert && !!stockCode.trim() && !!action;

  // Count pending signals for mentor
  const pendingCount = useMemo(() => {
    if (!isMentor) return 0;
    return signals.filter(s => s.status === 'pending').length;
  }, [signals, isMentor]);

  // Determine which buy signals are actually "加碼" (subsequent buys for same instrument)
  const addBuySignalIds = useMemo(() => {
    const ids = new Set<string>();
    const sorted = [...signals].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const openPositions = new Map<string, boolean>();
    for (const s of sorted) {
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
  const statusOnlyKeywords = ['持有中', '已平倉', '待發布'];

  const getDisplayStatus = (s: any) => {
    if (s.status === 'pending') return '待發布';
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
        (typeof s.reason_summary === 'string' && s.reason_summary.toLowerCase().includes(lower))
      );
    });
  });

  // 同批次（同一篇週記/同次發送）統計
  const batchInfo = useMemo(() => {
    const m = new Map<string, { count: number; instruments: string[] }>();
    signals.forEach((s: any) => {
      if (!s.batch_id) return;
      const cur = m.get(s.batch_id) || { count: 0, instruments: [] };
      cur.count += 1;
      if (!cur.instruments.includes(s.instrument)) cur.instruments.push(s.instrument);
      m.set(s.batch_id, cur);
    });
    return m;
  }, [signals]);

  // Calculate current holding quantity and cost for the searched instrument
  const holdingSummary = useMemo(() => {
    if (!searchQuery.trim()) return null;

    // Track per instrument: separate 張 / 股 quantities and their own costs
    const instrumentMap = new Map<string, { zhangQty: number; guQty: number; zhangCost: number; guCost: number }>();

    // Process signals in chronological order
    const sorted = [...filtered].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    for (const s of sorted) {

      const inst = s.instrument;
      const qty = s.quantity || 1;
      const unit = s.quantity_unit || '張';
      const price = s.price_hint || 0;
      const current = instrumentMap.get(inst) || { zhangQty: 0, guQty: 0, zhangCost: 0, guCost: 0 };
      const lineCost = unit === '張' ? price * qty * 1000 : price * qty;

      if (s.action === 'buy' || s.action === 'add') {
        if (unit === '張') {
          current.zhangQty += qty;
          current.zhangCost += lineCost;
        } else {
          current.guQty += qty;
          current.guCost += lineCost;
        }
        instrumentMap.set(inst, current);
      } else if (s.action === 'sell' || s.action === 'trim') {
        if (unit === '張') {
          current.zhangQty = Math.max(0, current.zhangQty - qty);
          current.zhangCost = Math.max(0, current.zhangCost - lineCost);
        } else {
          current.guQty = Math.max(0, current.guQty - qty);
          current.guCost = Math.max(0, current.guCost - lineCost);
        }
        instrumentMap.set(inst, current);
      } else if (s.action === 'exit') {
        instrumentMap.set(inst, { zhangQty: 0, guQty: 0, zhangCost: 0, guCost: 0 });
      }
    }

    const entries = Array.from(instrumentMap.entries()).filter(([, v]) => v.zhangQty > 0 || v.guQty > 0);
    if (entries.length === 0) return null;

    return entries.map(([inst, v]) => ({
      instrument: inst,
      zhangQty: v.zhangQty,
      guQty: v.guQty,
      cost: v.zhangCost + v.guCost,
    }));
  }, [filtered, searchQuery]);

  if (loading) return <AdminLayout><div className="flex items-center justify-center h-64 text-muted-foreground">載入中...</div></AdminLayout>;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{contentLabel}管理</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {isMentor
                ? `週一~五發布，週五 20:00 統一推播${pendingCount > 0 ? `（本週待發布 ${pendingCount} 筆）` : ''}`
                : '發布即上線，可自行收回'}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            {!publishWindow.open && !isReadOnly && (
              <p className="text-xs text-destructive">{publishWindow.reason}</p>
            )}
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <PermissionTooltip disabled={isReadOnly}>
              <Button
                disabled={!publishWindow.open || isReadOnly}
                className={cn(isAdvisor ? "bg-advisor hover:bg-advisor/90" : "bg-mentor hover:bg-mentor/90")}
                onClick={() => navigate(`/admin/${expertSlug}/signals/new`)}
              >
                <Plus className="h-4 w-4 mr-2" />發布新{contentLabel}
              </Button>
            </PermissionTooltip>
            <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
              <DialogHeader><DialogTitle>發布新{contentLabel}</DialogTitle></DialogHeader>
              <div className="space-y-4 mt-4 overflow-y-auto flex-1 px-1 -mx-1">
                {isMentor && (
                  <div className="space-y-2">
                    <Label>教學主題</Label>
                    <Input value={teachingTopic} onChange={e => setTeachingTopic(e.target.value)} />
                  </div>
                )}
                {isMentor && (
                  <div className="space-y-2">
                    <Label>整體摘要</Label>
                    <Textarea value={overallSummary} onChange={e => setOverallSummary(e.target.value)} rows={2} />
                  </div>
                )}
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
                      <Input value={quantity} onChange={e => { const v = e.target.value; if (v === '' || Number(v) >= 0) setQuantity(v); }} type="number" min="0" placeholder="1" className="w-32" />
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
                  <Label>為什麼這樣操作？</Label>
                  <Textarea value={reasonSummary} onChange={e => setReasonSummary(e.target.value)} rows={2} />
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
                           if (!priceHint || parseFloat(priceHint) <= 0) {
                             toast.error('請輸入參考價格');
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
                                  type: 'recall',
                                },
                              });
                              toast.success('已推播收回通知');
                              setLastPublishedId(null);
                              setLinePushed(false);
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
                  <Label>部位控管想法</Label>
                  <Textarea value={reasonDetail} onChange={e => setReasonDetail(e.target.value)} rows={3} />
                </div>
                <div className="space-y-2">
                  <Label>風險提醒</Label>
                  <Textarea value={riskNotes} onChange={e => setRiskNotes(e.target.value)} rows={2} />
                </div>
                {isMentor && (
                  <div className="space-y-2">
                    <Label>教學重點</Label>
                    <Textarea value={learningPoints} onChange={e => setLearningPoints(e.target.value)} rows={3} />
                  </div>
                )}
                {/* Mentor: preview as modal button */}
                {isMentor && canPublish && (
                  <>
                    <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => setShowPreview(true)}>
                      <Eye className="h-4 w-4 mr-2" />訂閱者預覽
                    </Button>
                    <Dialog open={showPreview} onOpenChange={setShowPreview}>
                      <DialogContent className="max-w-[80vw] max-h-[80vh] overflow-y-auto p-0">
                        <div className="p-4 space-y-4">
                          {/* Header: avatar + name + role badge (mirrors JournalDetail) */}
                          <div className="flex items-center gap-3">
                            <img src={expert?.avatar_url || '/placeholder.svg'} alt={expert?.name} className="h-10 w-10 rounded-full object-cover" />
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold">{expert?.name}</span>
                                <Badge variant="secondary" className="text-[10px]">實戰導師</Badge>
                              </div>
                            </div>
                          </div>

                          {/* Date range + T+7 badge */}
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span>📅 本週週記預覽</span>
                            <Badge variant="outline" className="text-[10px] bg-mentor/10 text-mentor border-mentor/20">T+7 歷史</Badge>
                          </div>

                          {/* Title: teaching topic or overall summary */}
                          {teachingTopic && <h1 className="text-xl font-bold">📚 {teachingTopic}</h1>}

                          {/* Overall summary card */}
                          {overallSummary && (
                            <Card>
                              <CardContent className="p-4">
                                <h2 className="font-semibold mb-2">本週整體摘要</h2>
                                <p className="text-sm text-muted-foreground whitespace-pre-line">{overallSummary}</p>
                              </CardContent>
                            </Card>
                          )}

                          {/* Trade list with expandable details */}
                          <div>
                            <h2 className="font-semibold mb-3">本週操作列表</h2>
                            <Card>
                              <CardContent className="p-0">
                                <div className="divide-y divide-border">
                                  <PreviewTradeItem
                                    action={action}
                                    instrument={`${stockCode} ${stockName}`}
                                    priceHint={priceHint ? parseFloat(priceHint) : null}
                                    reasonSummary={reasonSummary}
                                    reasonDetail={reasonDetail}
                                    riskNotes={riskNotes}
                                  />
                                </div>
                              </CardContent>
                            </Card>
                          </div>

                          {/* Learning points */}
                          {learningPoints && (
                            <Card>
                              <CardContent className="p-4">
                                <h2 className="font-semibold mb-2 flex items-center gap-2">
                                  <span className="text-mentor">📖</span> 本週教學重點
                                </h2>
                                <ul className="space-y-2">
                                  {learningPoints.split('\n').filter(l => l.trim()).map((point, idx) => (
                                    <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                                      <span className="text-mentor">•</span> {point.replace(/^[•·．‧●○◆■□▪▫※☆★→➤➜▸▹►▻‣⁃–—\-]\s*/gm, '')}
                                    </li>
                                  ))}
                                </ul>
                              </CardContent>
                            </Card>
                          )}

                          {/* Disclaimer */}
                          <Card className="bg-muted/30">
                            <CardContent className="p-4 flex items-start gap-2">
                              <span className="text-muted-foreground mt-0.5 flex-shrink-0">🛡️</span>
                              <p className="text-xs text-muted-foreground">
                                本頁內容為一週前之操作回顧（T+7），僅供教學用途，不構成任何即時投資建議。
                              </p>
                            </CardContent>
                          </Card>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </>
                )}
                {/* Advisor: inline preview */}
                {isAdvisor && canPublish && (
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
                    </CardContent>
                  </Card>
                )}
                <div className="flex justify-end gap-3 pt-2">
                  <Button variant="outline" onClick={() => { setIsCreateOpen(false); clearForm(); }}>取消</Button>
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
                     {isMentor && <th className="text-left p-3 text-xs font-medium text-muted-foreground">發布狀態</th>}
                     <th className="text-left p-3 text-xs font-medium text-muted-foreground">狀態</th>
                     <th className="text-left p-3 text-xs font-medium text-muted-foreground"></th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    // 折疊：每個 collapsed batch 只保留排序最早的那一筆作為「代表列」
                    const seenBatchHead = new Set<string>();
                    const visibleSignals = filtered.filter((s: any) => {
                      if (!s.batch_id || !collapsedBatches.has(s.batch_id)) return true;
                      if (seenBatchHead.has(s.batch_id)) return false;
                      seenBatchHead.add(s.batch_id);
                      return true;
                    });
                    if (visibleSignals.length === 0) {
                      return (<tr><td colSpan={isMentor ? 8 : 7} className="p-8 text-center text-muted-foreground text-sm">尚無{contentLabel}</td></tr>);
                    }
                    return visibleSignals.map((signal) => {
                       const ai = actionLabels[signal.action] || actionLabels.buy;
                       const isExpanded = expandedId === signal.id;
                       const hasDetail = signal.reason_detail || signal.risk_notes || signal.reason_summary || signal.learning_points;
                       const isBatchCollapsed = signal.batch_id && collapsedBatches.has(signal.batch_id) && (batchInfo.get(signal.batch_id)?.count || 0) > 1;
                       return (
                         <React.Fragment key={signal.id}>
                            <tr className="border-b last:border-0 hover:bg-muted/30">
                             <td className="p-3 text-sm text-muted-foreground whitespace-nowrap">{signal.published_at ? new Date(signal.published_at).toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                              <td className="p-3 text-sm font-medium">
                                <div className="flex items-center gap-1.5">
                                  <span>{signal.instrument}{isBatchCollapsed ? ` 等 ${batchInfo.get(signal.batch_id)!.count} 檔` : ''}</span>
                                  {signal.batch_id && batchInfo.get(signal.batch_id) && batchInfo.get(signal.batch_id)!.count > 1 && (
                                    <Badge
                                      variant="secondary"
                                      className="text-[10px] px-1.5 py-0 h-4 cursor-pointer select-none"
                                      title={`同篇週記共 ${batchInfo.get(signal.batch_id)!.count} 檔，點擊${isBatchCollapsed ? '展開' : '折疊'}`}
                                      onClick={() => {
                                        setCollapsedBatches((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(signal.batch_id)) next.delete(signal.batch_id);
                                          else next.add(signal.batch_id);
                                          return next;
                                        });
                                      }}
                                    >
                                      📦 {isBatchCollapsed ? '展開' : '折疊'} {batchInfo.get(signal.batch_id)!.count}
                                    </Badge>
                                  )}
                                </div>
                              </td>
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
                             <td className="p-3 text-sm" style={{ maxWidth: '200px' }}>
                                  <p className="text-muted-foreground truncate overflow-hidden text-ellipsis whitespace-nowrap">{richHtmlPreview(signal.reason_summary, 80) || '-'}</p>
                              </td>
                                {isMentor && (
                                  <td className="p-3">
                                    {signal.status === 'pending' ? (
                                      <Badge className="text-xs border border-mentor/40 bg-mentor/10 text-mentor">待發布</Badge>
                                    ) : (
                                      <Badge className="text-xs border border-success/40 bg-success/10 text-success">已發布</Badge>
                                    )}
                                  </td>
                                )}
                                 <td className="p-3">
                                    {signal.action === 'exit' ? (
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
                                   {isAdvisor && signal.status === 'published' && (
                                     <PermissionTooltip disabled={isReadOnly}>
                                       <Button
                                         size="sm"
                                         variant="ghost"
                                         className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                                         onClick={() => handleRepush(signal.id)}
                                         disabled={repushingId === signal.id || isReadOnly}
                                         title="重新推送此訊號給 LINE 訂閱者（標記為「已更新」）"
                                       >
                                         {repushingId === signal.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                                         重推 LINE
                                       </Button>
                                     </PermissionTooltip>
                                   )}
                                   {signal.batch_id && (
                                     <PermissionTooltip disabled={isReadOnly}>
                                       <Button
                                         size="sm"
                                         variant="ghost"
                                         className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                                         onClick={() => navigate(`/admin/${expertSlug}/signals/edit/${signal.batch_id}`)}
                                         disabled={isReadOnly}
                                         title="編輯整批"
                                       >
                                         編輯
                                       </Button>
                                     </PermissionTooltip>
                                   )}
                                   <PermissionTooltip disabled={isReadOnly}>
                                     <Button
                                       size="sm"
                                       variant="ghost"
                                       className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
                                       onClick={() => handleRecall(signal.id)}
                                       disabled={recalling || isReadOnly || (isMentor && signal.status === 'published')}
                                       title={isMentor && signal.status === 'published' ? '已發布的週記不可收回' : undefined}
                                     >
                                       <Undo2 className="h-3 w-3" />收回
                                     </Button>
                                   </PermissionTooltip>
                                </div>
                              </td>
                           </tr>
                           {isExpanded && (
                             <tr className="border-b last:border-0">
                               <td colSpan={isMentor ? 8 : 7} className="p-0">
                                 <div className="bg-muted/30 px-6 py-3 text-xs space-y-2">
                                     {(signal as any).teaching_topic && (
                                      <div>
                                        <span className="font-medium text-foreground">教學主題</span>
                                        <p className="text-muted-foreground mt-0.5 whitespace-pre-wrap">{(signal as any).teaching_topic}</p>
                                      </div>
                                    )}
                                    {(signal as any).overall_summary && (
                                      <div>
                                        <span className="font-medium text-foreground">整體摘要</span>
                                        <p className="text-muted-foreground mt-0.5 whitespace-pre-wrap">{(signal as any).overall_summary}</p>
                                      </div>
                                    )}
                                    {signal.reason_summary && (
                                      <div>
                                        <span className="font-medium text-foreground">為什麼這樣操作？</span>
                                        <SafeRichHtml html={signal.reason_summary} className="mt-0.5 text-xs" />
                                      </div>
                                    )}
                                    {signal.reason_detail && (
                                      <div>
                                        <span className="font-medium text-foreground">部位控管想法</span>
                                        <SafeRichHtml html={signal.reason_detail} className="mt-0.5 text-xs" />
                                      </div>
                                    )}
                                     {signal.risk_notes && (
                                       <div>
                                         <span className="font-medium text-foreground">風險提醒</span>
                                         <SafeRichHtml html={signal.risk_notes} className="mt-0.5 text-xs" />
                                       </div>
                                     )}
                                     {signal.learning_points && (
                                       <div>
                                         <span className="font-medium text-foreground">教學重點</span>
                                         <SafeRichHtml html={signal.learning_points} className="mt-0.5 text-xs" />
                                       </div>
                                     )}
                                  </div>
                                </td>
                              </tr>
                            )}
                         </React.Fragment>
                       );
                     });
                  })()}
                </tbody>
                {holdingSummary && holdingSummary.length > 0 && (
                  <tfoot>
                    {holdingSummary.map(({ instrument, zhangQty, guQty, cost }) => (
                      <tr key={instrument} className="border-t bg-muted/40">
                        <td colSpan={3} className="p-3 text-sm font-medium text-muted-foreground">
                          {instrument} 目前持有
                        </td>
                        <td colSpan={2} className="p-3 text-sm font-bold text-foreground">
                          {zhangQty} 張　{guQty} 股　
                          <span className="text-muted-foreground font-medium">
                            成本 {cost.toLocaleString('zh-TW')} 元
                          </span>
                        </td>
                        <td colSpan={2}></td>
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
