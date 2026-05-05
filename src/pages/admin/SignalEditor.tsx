import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { isPublishingWindowOpen } from '@/lib/publishingWindow';
import { useFormDraft } from '@/hooks/useFormDraft';
import { RichTextEditor } from '@/components/admin/RichTextEditor';
import { sanitizeRichHtml, isHtmlEmpty, htmlToPlainText } from '@/lib/sanitizeHtml';
import { simulatePositions, TradeAction } from '@/lib/simulatePositions';
import { normalizeSignalQuantityToShares, simulateCashAfterTrades } from '@/lib/signalTradeLogic';
import { cn } from '@/lib/utils';
import { Plus, Trash2, ArrowUp, ArrowDown, Loader2, ArrowLeft, Wallet, History } from 'lucide-react';
import { toast } from 'sonner';

interface OpenPosition {
  symbol: string;
  instrument: string;
  quantity_shares: number;
  entry_price: number;
  current_price: number | null;
  market_value: number;
  unrealized_pnl: number;
  unrealized_pct: number;
}
interface RecentTrade {
  id: string;
  instrument: string;
  symbol: string;
  status: string;
  quantity_shares: number;
  entry_price: number | null;
  exit_price: number | null;
  pnl_percent: number | null;
  created_at: string;
}
interface CapitalStatus {
  starting_capital: number;
  realized_pnl_amount: number;
  open_cost_value: number;
  open_market_value: number;
  unrealized_pnl_amount: number;
  available_cash: number;
  open_positions: OpenPosition[];
  recent_trades: RecentTrade[];
}

const fmtMoney = (n: number) => `$${(Math.round(n) || 0).toLocaleString()}`;

interface TradeDraft {
  uid: string;             // 前端 key
  executedAt: string;      // datetime-local 格式 yyyy-MM-ddTHH:mm
  stockCode: string;
  stockName: string;
  action: TradeAction | '';
  priceHint: string;
  quantity: string;
  quantityUnit: '張' | '股';
  reasonSummary: string;   // HTML
  reasonDetail: string;    // HTML
  riskNotes: string;       // HTML
}

const newUid = () => Math.random().toString(36).slice(2, 10);

const nowLocalDatetime = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const emptyTrade = (): TradeDraft => ({
  uid: newUid(),
  executedAt: nowLocalDatetime(),
  stockCode: '',
  stockName: '',
  action: '',
  priceHint: '',
  quantity: '',
  quantityUnit: '張',
  reasonSummary: '',
  reasonDetail: '',
  riskNotes: '',
});

const actionLabels: Record<string, string> = {
  buy: '買進', sell: '賣出', add: '加碼', trim: '減碼', exit: '平損',
};

const SignalEditor = () => {
  const { expertSlug, batchId: editBatchId } = useParams<{ expertSlug: string; batchId?: string }>();
  const isEditing = !!editBatchId;
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();

  const isCompanyAdmin = hasRole('company_admin');
  const isOwner = !!user?.expertSlug && user.expertSlug === expertSlug;
  const canEdit = isCompanyAdmin || isOwner;

  const [expert, setExpert] = useState<any>(null);
  const [signalTemplates, setSignalTemplates] = useState<any[]>([]);
  const [openPositions, setOpenPositions] = useState<{ symbol: string; quantity: number; instrument: string }[]>([]);
  const [capital, setCapital] = useState<CapitalStatus | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const reloadCapital = useCallback(async (eid: string) => {
    const { data } = await supabase.rpc('get_expert_capital_status' as any, { _expert_id: eid });
    if (data) setCapital(data as unknown as CapitalStatus);
  }, []);

  // mentor 共用欄位（整篇週記）
  const [teachingTopic, setTeachingTopic] = useState('');
  const [overallSummary, setOverallSummary] = useState('');     // HTML
  const [learningPoints, setLearningPoints] = useState('');    // HTML

  // 多筆操作
  const [trades, setTrades] = useState<TradeDraft[]>([emptyTrade()]);

  const isMentor = expert?.role === 'mentor';
  const publishWindow = isPublishingWindowOpen();
  const stockCacheRef = useRef<Map<string, string>>(new Map());

  // 草稿（編輯模式不啟用，避免覆蓋線上資料）
  const DRAFT_KEY = `signal-editor-${expertSlug}`;
  const draftValue = useMemo(
    () => ({ teachingTopic, overallSummary, learningPoints, trades }),
    [teachingTopic, overallSummary, learningPoints, trades],
  );
  const { discard: discardDraft } = useFormDraft(
    DRAFT_KEY,
    draftValue,
    (saved) => {
      if (isEditing) return;
      if (typeof saved.teachingTopic === 'string') setTeachingTopic(saved.teachingTopic);
      if (typeof saved.overallSummary === 'string') setOverallSummary(saved.overallSummary);
      if (typeof saved.learningPoints === 'string') setLearningPoints(saved.learningPoints);
      if (Array.isArray(saved.trades) && saved.trades.length > 0) {
        setTrades(saved.trades.map((t: any) => ({ ...emptyTrade(), ...t, uid: t.uid || newUid() })));
      }
    },
    { enabled: !isEditing },
  );

  // 載入 expert / 模板 / 持倉
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!expertSlug) return;
      setLoading(true);
      const { data: exp } = await supabase.from('experts').select('*').eq('slug', expertSlug).single();
      if (cancelled) return;
      setExpert(exp);
      if (exp) {
        const [{ data: tpl }, { data: openTrades }, { data: cap }] = await Promise.all([
          supabase
            .from('expert_signal_templates' as any)
            .select('id, title, action, reason, risk_note, strategy_note')
            .eq('expert_id', exp.id)
            .order('sort_order', { ascending: true }),
          supabase
            .from('trade_records')
            .select('instrument, quantity')
            .eq('expert_id', exp.id)
            .eq('status', 'open'),
          supabase.rpc('get_expert_capital_status' as any, { _expert_id: exp.id }),
        ]);
        if (cancelled) return;
        setSignalTemplates((tpl as any) || []);
        setOpenPositions(
          (openTrades || []).map((t: any) => ({
            instrument: t.instrument,
            symbol: String(t.instrument || '').split(' ')[0],
            quantity: t.quantity || 0,
          })),
        );
        if (cap) setCapital(cap as unknown as CapitalStatus);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [expertSlug]);

  // 編輯模式：載入既有 batch 的所有訊號
  useEffect(() => {
    if (!isEditing || !expert) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('expert_signals')
        .select('*')
        .eq('expert_id', expert.id)
        .eq('batch_id', editBatchId as any)
        .order('executed_at', { ascending: true });
      if (cancelled) return;
      if (error || !data || data.length === 0) {
        toast.error('找不到要編輯的批次');
        navigate(`/admin/${expertSlug}/signals`, { replace: true });
        return;
      }
      const first: any = data[0];
      setTeachingTopic(first.teaching_topic || '');
      setOverallSummary(first.overall_summary || '');
      setLearningPoints(first.learning_points || '');
      setTrades(
        data.map((row: any) => {
          const inst = String(row.instrument || '');
          const [code, ...rest] = inst.split(' ');
          const dt = row.executed_at ? new Date(row.executed_at) : new Date(row.published_at || Date.now());
          const pad = (n: number) => String(n).padStart(2, '0');
          return {
            uid: row.id,
            executedAt: `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`,
            stockCode: code || '',
            stockName: rest.join(' '),
            action: (row.action || '') as TradeAction,
            priceHint: row.price_hint != null ? String(row.price_hint) : '',
            quantity: row.quantity != null ? String(row.quantity) : '',
            quantityUnit: (row.quantity_unit || '張') as '張' | '股',
            reasonSummary: row.reason_summary || '',
            reasonDetail: row.reason_detail || '',
            riskNotes: row.risk_notes || '',
          };
        }),
      );
    })();
    return () => { cancelled = true; };
  }, [isEditing, editBatchId, expert, expertSlug, navigate]);

  // 沒權限就回列表
  useEffect(() => {
    if (!loading && expert && !canEdit) {
      toast.error('沒有編輯權限');
      navigate(`/admin/${expertSlug}/signals`, { replace: true });
    }
  }, [loading, expert, canEdit, expertSlug, navigate]);

  // 股票代碼自動帶名稱與最後價（不阻塞輸入）
  const fetchStockInfo = useCallback(async (idx: number, code: string) => {
    const c = code.trim();
    if (!c || c.length < 4) return;
    if (stockCacheRef.current.has(c)) {
      const name = stockCacheRef.current.get(c)!;
      setTrades((prev) => prev.map((t, i) => (i === idx && !t.stockName ? { ...t, stockName: name } : t)));
      return;
    }
    try {
      const { resolveStockName } = await import('@/lib/stockNameResolver');
      const name = await resolveStockName(c);
      if (name) {
        stockCacheRef.current.set(c, name);
        setTrades((prev) => prev.map((t, i) => (i === idx && !t.stockName ? { ...t, stockName: name } : t)));
      }
    } catch (e) { /* ignore */ }
  }, []);

  const updateTrade = (idx: number, patch: Partial<TradeDraft>) =>
    setTrades((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)));

  const addTrade = () => setTrades((prev) => [...prev, emptyTrade()]);
  const removeTrade = (idx: number) => setTrades((prev) => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx));
  const moveTrade = (idx: number, dir: -1 | 1) => {
    setTrades((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  // AI 助寫呼叫
  const callAIAssist = useCallback(async (
    field: 'reason_summary' | 'reason_detail' | 'risk_notes' | 'learning_points' | 'overall_summary',
    mode: any,
    currentHtml: string,
    instruction: string | undefined,
    context?: any,
  ): Promise<string> => {
    try {
      const { data, error } = await supabase.functions.invoke('signal-ai-assist', {
        body: { mode, field, content: currentHtml, instruction, context },
      });
      if (error) {
        const msg = (error as any)?.context?.error || error.message || 'AI 助寫失敗';
        toast.error(typeof msg === 'string' ? msg : 'AI 助寫失敗');
        return '';
      }
      if ((data as any)?.error) {
        toast.error((data as any).error);
        return '';
      }
      return sanitizeRichHtml((data as any)?.html || '');
    } catch (e: any) {
      toast.error(e?.message || 'AI 助寫呼叫失敗');
      return '';
    }
  }, []);

  // 把交易草稿轉成 cash 模擬輸入
  const buildCashSimTrades = useCallback(() => {
    const posMap = new Map<string, OpenPosition>();
    (capital?.open_positions || []).forEach((p) => posMap.set(p.symbol, p));
    return trades.map((t) => {
      const shares = normalizeSignalQuantityToShares(parseInt(t.quantity || '0', 10) || 0, t.quantityUnit);
      const code = t.stockCode.trim();
      const pos = posMap.get(code);
      return {
        action: (t.action || '') as any,
        price: parseFloat(t.priceHint || '0') || 0,
        shares,
        exitShares: pos?.quantity_shares,
        exitAvgPrice: pos?.entry_price,
      };
    });
  }, [trades, capital]);

  const cashSim = useMemo(() => {
    const start = capital?.available_cash || 0;
    return simulateCashAfterTrades(start, buildCashSimTrades());
  }, [capital, buildCashSimTrades]);

  // 驗證
  const validate = (): string | null => {
    if (!expert) return '找不到分析師資料';
    if (trades.length === 0) return '至少要有一檔股票';

    const initial = openPositions.map((p) => ({ symbol: p.symbol, quantity: p.quantity }));
    const simulated: { symbol: string; action: TradeAction; quantity: number }[] = [];

    let remaining = capital?.available_cash || 0;
    const posMap = new Map<string, OpenPosition>();
    (capital?.open_positions || []).forEach((p) => posMap.set(p.symbol, p));

    for (let i = 0; i < trades.length; i++) {
      const t = trades[i];
      const tag = `第 ${i + 1} 檔`;
      if (!t.stockCode.trim()) return `${tag}：請填股票代碼`;
      if (!t.action) return `${tag}：請選操作方向`;
      if (!t.executedAt) return `${tag}：請填操作時間`;
      const qty = parseInt(t.quantity || '0', 10);
      if (!qty || qty <= 0) return `${tag}：請填數量`;
      const price = parseFloat(t.priceHint || '0');
      if (!price || price <= 0) return `${tag}：請填參考價格`;

      const code = t.stockCode.trim();
      const shares = normalizeSignalQuantityToShares(qty, t.quantityUnit);

      if (['add', 'trim', 'sell', 'exit'].includes(t.action)) {
        const sim = simulatePositions(initial, simulated);
        const cur = sim.get(code) || 0;
        if (cur <= 0) return `${tag}：尚無 ${code} 的未平倉部位，無法執行${actionLabels[t.action]}`;
        if ((t.action === 'trim' || t.action === 'sell') && qty > cur) {
          return `${tag}：減碼數量 (${qty}) 超過模擬持倉 (${cur})`;
        }
      }

      // 資金硬擋：buy / add 不可超過剩餘可用現金
      if (t.action === 'buy' || t.action === 'add') {
        const required = price * shares;
        if (required > remaining) {
          return `${tag}：本筆需 ${fmtMoney(required)}，剩餘可用現金僅 ${fmtMoney(remaining)}，已超過操作金額上限`;
        }
        remaining -= required;
      } else if (t.action === 'sell' || t.action === 'trim') {
        remaining += price * shares;
      } else if (t.action === 'exit') {
        const pos = posMap.get(code);
        remaining += (pos?.entry_price || price) * (pos?.quantity_shares || shares);
      }

      simulated.push({ symbol: code, action: t.action as TradeAction, quantity: qty });
    }
    return null;
  };

  const handlePublish = async () => {
    if (!canEdit) return;
    if (!publishWindow.open) {
      toast.error(publishWindow.reason || '目前不在發布時段');
      return;
    }
    const err = validate();
    if (err) { toast.error(err); return; }

    setSubmitting(true);
    try {
      const batchId = isEditing ? (editBatchId as string) : crypto.randomUUID();
      const status = isMentor ? 'pending' : 'published';

      const rows = trades.map((t, idx) => {
        const instrument = t.stockName.trim()
          ? `${t.stockCode.trim()} ${t.stockName.trim()}`
          : t.stockCode.trim();
        return {
          expert_id: expert.id,
          plan_id: null,
          batch_id: batchId,
          instrument,
          action: t.action as any,
          price_hint: parseFloat(t.priceHint),
          quantity: parseInt(t.quantity, 10),
          quantity_unit: t.quantityUnit,
          executed_at: new Date(t.executedAt).toISOString(),
          reason_summary: sanitizeRichHtml(t.reasonSummary),
          reason_detail: sanitizeRichHtml(t.reasonDetail),
          risk_notes: sanitizeRichHtml(t.riskNotes),
          // mentor 整篇共用欄位只寫到第一筆，避免重複
          teaching_topic: idx === 0 && isMentor ? teachingTopic || null : null,
          overall_summary: idx === 0 && isMentor ? sanitizeRichHtml(overallSummary) || null : null,
          learning_points: idx === 0 && isMentor ? sanitizeRichHtml(learningPoints) || null : null,
          status: status as any,
        } as any;
      });

      if (isEditing) {
        // 整批替換：先刪舊批次（trade_records 由 FK 連動 / 或我們自行清理），再 insert
        await supabase.from('trade_records').delete().eq('expert_id', expert.id).in(
          'signal_id',
          // 取得舊 signal id 一併刪除其關聯交易紀錄
          (
            await supabase.from('expert_signals').select('id').eq('batch_id', batchId)
          ).data?.map((r: any) => r.id) || [],
        );
        await supabase.from('expert_signals').delete().eq('batch_id', batchId);
      }

      const { error } = await supabase.from('expert_signals').insert(rows as any);
      if (error) { toast.error(error.message); return; }

      // analyst 立即發布 → 一次以 carousel 推送整批給 LINE 訂閱者
      if (!isMentor) {
        try {
          const { data: pushData, error: pushErr } = await supabase.functions.invoke('line-push-signal', {
            body: { expert_id: expert.id, batch_id: batchId, type: 'publish', is_update: isEditing },
          });
          if (pushErr) {
            console.warn('LINE push (batch) failed:', pushErr);
          } else if (pushData?.pushed) {
            console.log('LINE batch pushed:', pushData);
          }
        } catch (e) {
          console.warn('LINE push exception:', e);
        }
      }

      toast.success(
        isEditing
          ? `已更新 ${rows.length} 檔${isMentor ? '週記' : '訊號'}`
          : isMentor ? '週記已儲存，將於本週五 20:00 統一發布' : `已發布 ${rows.length} 檔訊號`,
      );
      discardDraft();
      if (expert?.id) reloadCapital(expert.id);
      navigate(`/admin/${expertSlug}/signals`);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-64 text-muted-foreground">載入中...</div>
      </AdminLayout>
    );
  }

  const contentLabel = isMentor ? '週記' : '訊號';

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-4xl mx-auto pb-20">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate(`/admin/${expertSlug}/signals`)}>
              <ArrowLeft className="h-4 w-4 mr-1" /> 返回列表
            </Button>
            <h1 className="text-2xl font-bold">{isEditing ? '編輯' : '發布新'}{contentLabel}</h1>
          </div>
          <div className="flex items-center gap-2">
            {!publishWindow.open && (
              <span className="text-xs text-destructive">{publishWindow.reason}</span>
            )}
            <Button variant="outline" onClick={() => navigate(`/admin/${expertSlug}/signals`)}>取消</Button>
            <Button
              onClick={handlePublish}
              disabled={submitting || !publishWindow.open}
              className={cn(isMentor ? 'bg-mentor hover:bg-mentor/90' : 'bg-primary hover:bg-primary/90')}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {isEditing ? '更新' : (isMentor ? '儲存週記' : '立即發布')}
            </Button>
          </div>
        </div>

        {/* 資金看板 */}
        {capital && (
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Wallet className="h-4 w-4 text-muted-foreground" />
                資金狀況
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <div className="text-xs text-muted-foreground">起始資金</div>
                  <div className="text-base font-medium">{fmtMoney(capital.starting_capital)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">已實現損益</div>
                  <div className={cn('text-base font-medium', capital.realized_pnl_amount >= 0 ? 'text-success' : 'text-destructive')}>
                    {capital.realized_pnl_amount >= 0 ? '+' : ''}{fmtMoney(capital.realized_pnl_amount)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">未平倉成本</div>
                  <div className="text-base font-medium">{fmtMoney(capital.open_cost_value)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">可用現金</div>
                  <div className={cn('text-lg font-bold', capital.available_cash < 0 ? 'text-destructive' : 'text-foreground')}>
                    {fmtMoney(capital.available_cash)}
                  </div>
                </div>
              </div>
              <div className={cn(
                'rounded-md border px-3 py-2 text-sm',
                cashSim.remaining < 0 ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-muted bg-muted/30 text-muted-foreground',
              )}>
                送出後預估可用現金：<span className="font-medium">{fmtMoney(cashSim.remaining)}</span>
                {cashSim.remaining < 0 && <span className="ml-2">⚠ 已超過上限，將被擋下</span>}
              </div>

              {/* 目前持倉 */}
              {capital.open_positions.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">目前持倉（{capital.open_positions.length} 檔）</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b text-muted-foreground">
                          <th className="text-left py-1.5 font-normal">股票</th>
                          <th className="text-right font-normal">股數</th>
                          <th className="text-right font-normal">均價</th>
                          <th className="text-right font-normal">現價</th>
                          <th className="text-right font-normal">市值</th>
                          <th className="text-right font-normal">未實現</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {capital.open_positions.map((p) => (
                          <tr key={p.symbol} className="border-b last:border-0">
                            <td className="py-1.5">{p.instrument}</td>
                            <td className="text-right">{p.quantity_shares.toLocaleString()}</td>
                            <td className="text-right">{Number(p.entry_price || 0).toFixed(2)}</td>
                            <td className="text-right">{p.current_price != null ? Number(p.current_price).toFixed(2) : '—'}</td>
                            <td className="text-right">{fmtMoney(p.market_value)}</td>
                            <td className={cn('text-right', p.unrealized_pnl >= 0 ? 'text-success' : 'text-destructive')}>
                              {p.unrealized_pnl >= 0 ? '+' : ''}{fmtMoney(p.unrealized_pnl)}
                              <span className="ml-1 opacity-70">({p.unrealized_pct >= 0 ? '+' : ''}{p.unrealized_pct.toFixed(2)}%)</span>
                            </td>
                            <td className="text-right">
                              <Button
                                type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs"
                                onClick={() => {
                                  const last = trades[trades.length - 1];
                                  const targetIdx = last && !last.stockCode ? trades.length - 1 : trades.length;
                                  if (targetIdx === trades.length) addTrade();
                                  setTimeout(() => updateTrade(targetIdx, {
                                    stockCode: p.symbol,
                                    stockName: p.instrument.replace(p.symbol, '').trim(),
                                    action: 'trim' as TradeAction,
                                    priceHint: p.current_price ? String(p.current_price) : '',
                                    quantityUnit: '股',
                                  }), 0);
                                }}
                              >帶入</Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 最近交易 */}
              <div className="space-y-2">
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setShowHistory((v) => !v)}
                >
                  <History className="h-3.5 w-3.5" />
                  最近交易紀錄（{capital.recent_trades.length}）{showHistory ? '收合' : '展開'}
                </button>
                {showHistory && capital.recent_trades.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b text-muted-foreground">
                          <th className="text-left py-1.5 font-normal">日期</th>
                          <th className="text-left font-normal">股票</th>
                          <th className="text-left font-normal">狀態</th>
                          <th className="text-right font-normal">股數</th>
                          <th className="text-right font-normal">進價</th>
                          <th className="text-right font-normal">出價</th>
                          <th className="text-right font-normal">損益%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {capital.recent_trades.map((r) => (
                          <tr key={r.id} className="border-b last:border-0">
                            <td className="py-1.5">{new Date(r.created_at).toLocaleDateString('en-CA').replace(/-/g, '/')}</td>
                            <td>{r.instrument}</td>
                            <td>{r.status}</td>
                            <td className="text-right">{(r.quantity_shares || 0).toLocaleString()}</td>
                            <td className="text-right">{r.entry_price != null ? Number(r.entry_price).toFixed(2) : '—'}</td>
                            <td className="text-right">{r.exit_price != null ? Number(r.exit_price).toFixed(2) : '—'}</td>
                            <td className={cn('text-right', (r.pnl_percent || 0) >= 0 ? 'text-success' : 'text-destructive')}>
                              {r.pnl_percent != null ? `${r.pnl_percent >= 0 ? '+' : ''}${r.pnl_percent.toFixed(2)}%` : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {isMentor && (
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="space-y-2">
                <Label>教學主題</Label>
                <Input value={teachingTopic} onChange={(e) => setTeachingTopic(e.target.value)} placeholder="例：本週主題 — 強勢股的進場時機" />
              </div>
              <div className="space-y-2">
                <Label>整體摘要</Label>
                <RichTextEditor
                  uploadFolder={expert?.id}
                  value={overallSummary}
                  onChange={setOverallSummary}
                  placeholder="這週的市場觀察與整體想法⋯"
                  minHeight={80}
                  aiField="overall_summary"
                  onAIAssist={(mode, html, ins) => callAIAssist('overall_summary', mode, htmlToPlainText(html), ins)}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {trades.map((t, idx) => (
          <Card key={t.uid}>
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-muted-foreground">操作 #{idx + 1}</div>
                <div className="flex items-center gap-1">
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveTrade(idx, -1)} disabled={idx === 0}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveTrade(idx, 1)} disabled={idx === trades.length - 1}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeTrade(idx)} disabled={trades.length === 1}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">操作時間</Label>
                  <Input
                    type="datetime-local"
                    value={t.executedAt}
                    onChange={(e) => updateTrade(idx, { executedAt: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">股票代碼</Label>
                  <Input
                    value={t.stockCode}
                    onChange={(e) => {
                      const v = e.target.value;
                      updateTrade(idx, { stockCode: v });
                      if (v.trim().length >= 4) fetchStockInfo(idx, v);
                    }}
                    placeholder="例：2330"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">股票名稱</Label>
                  <Input value={t.stockName} onChange={(e) => updateTrade(idx, { stockName: e.target.value })} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">操作方向</Label>
                  <Select value={t.action} onValueChange={(v) => updateTrade(idx, { action: v as TradeAction })}>
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
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center justify-between">
                    <span>數量</span>
                    {(t.action === 'buy' || t.action === 'add') && capital && (
                      <button
                        type="button"
                        className="text-[10px] text-primary hover:underline"
                        onClick={() => {
                          const price = parseFloat(t.priceHint || '0');
                          if (!price || price <= 0) { toast.error('請先填參考價位'); return; }
                          const remainingBefore = idx === 0
                            ? (capital.available_cash || 0)
                            : (cashSim.perTrade[idx - 1] ?? capital.available_cash);
                          const maxShares = Math.max(0, Math.floor(remainingBefore / price));
                          updateTrade(idx, { quantity: String(maxShares), quantityUnit: '股' });
                        }}
                      >最大可買</button>
                    )}
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min={0}
                      value={t.quantity}
                      onChange={(e) => updateTrade(idx, { quantity: e.target.value })}
                      className="flex-1"
                    />
                    <Select value={t.quantityUnit} onValueChange={(v) => updateTrade(idx, { quantityUnit: v as '張' | '股' })}>
                      <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="張">張</SelectItem>
                        <SelectItem value="股">股</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">參考價位</Label>
                  <Input type="number" value={t.priceHint} onChange={(e) => updateTrade(idx, { priceHint: e.target.value })} placeholder="890" />
                </div>
              </div>

              {signalTemplates.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">套用訊號模板（不會覆蓋已填內容）</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {signalTemplates.map((tpl) => (
                      <Button
                        key={tpl.id}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() =>
                          updateTrade(idx, {
                            action: t.action || tpl.action,
                            reasonSummary: t.reasonSummary || (tpl.reason ? `<p>${tpl.reason}</p>` : ''),
                            riskNotes: t.riskNotes || (tpl.risk_note ? `<p>${tpl.risk_note}</p>` : ''),
                            reasonDetail: t.reasonDetail || (tpl.strategy_note ? `<p>${tpl.strategy_note}</p>` : ''),
                          })
                        }
                      >
                        {tpl.title}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs">為什麼這樣操作？</Label>
                <RichTextEditor
                  uploadFolder={expert?.id}
                  value={t.reasonSummary}
                  onChange={(html) => updateTrade(idx, { reasonSummary: html })}
                  placeholder="決策摘要、訊號背後的理由…"
                  minHeight={90}
                  aiField="reason_summary"
                  onAIAssist={(mode, html, ins) =>
                    callAIAssist('reason_summary', mode, htmlToPlainText(html), ins, {
                      instrument: `${t.stockCode} ${t.stockName}`.trim(),
                      action: t.action,
                      price_hint: t.priceHint,
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">部位控管想法</Label>
                <RichTextEditor
                  uploadFolder={expert?.id}
                  value={t.reasonDetail}
                  onChange={(html) => updateTrade(idx, { reasonDetail: html })}
                  placeholder="進出場條件、停損停利、加碼計畫…"
                  minHeight={100}
                  aiField="reason_detail"
                  onAIAssist={(mode, html, ins) => callAIAssist('reason_detail', mode, htmlToPlainText(html), ins)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">風險提醒</Label>
                <RichTextEditor
                  uploadFolder={expert?.id}
                  value={t.riskNotes}
                  onChange={(html) => updateTrade(idx, { riskNotes: html })}
                  placeholder="可能出錯的情境、停損點、總曝險…"
                  minHeight={80}
                  aiField="risk_notes"
                  onAIAssist={(mode, html, ins) => callAIAssist('risk_notes', mode, htmlToPlainText(html), ins)}
                />
              </div>
            </CardContent>
          </Card>
        ))}

        <Button type="button" variant="outline" className="w-full border-dashed" onClick={addTrade}>
          <Plus className="h-4 w-4 mr-2" /> 新增另一檔股票
        </Button>

        {isMentor && (
          <Card>
            <CardContent className="p-4 space-y-2">
              <Label>本週教學重點</Label>
              <RichTextEditor
                  uploadFolder={expert?.id}
                value={learningPoints}
                onChange={setLearningPoints}
                placeholder="老師對學生的歸納，可條列⋯"
                minHeight={120}
                aiField="learning_points"
                onAIAssist={(mode, html, ins) => callAIAssist('learning_points', mode, htmlToPlainText(html), ins)}
              />
            </CardContent>
          </Card>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => navigate(`/admin/${expertSlug}/signals`)}>取消</Button>
          <Button
            onClick={handlePublish}
            disabled={submitting || !publishWindow.open}
            className={cn(isMentor ? 'bg-mentor hover:bg-mentor/90' : 'bg-primary hover:bg-primary/90')}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {isEditing ? '更新' : (isMentor ? '儲存週記' : '立即發布')}
          </Button>
        </div>
      </div>
    </AdminLayout>
  );
};

export default SignalEditor;
