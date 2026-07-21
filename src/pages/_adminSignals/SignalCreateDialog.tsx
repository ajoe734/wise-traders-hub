import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Eye, Loader2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useFormDraft } from '@/hooks/useFormDraft';
import { avatarUrl } from '@/lib/imageTransform';
import { actionLabels } from './actionLabels';
import { PreviewTradeItem } from './PreviewTradeItem';
import { isMarketClosed } from './derive';
import { getAssetSpec, resolveAssetClass, isValidAssetSymbol, type QuantityUnit } from '@/lib/asset';
import { InstrumentTooltip } from '@/components/InstrumentTooltip';

interface Props {
  expert: any;
  signalTemplates: any[];
  isMentor: boolean;
  isAdvisor: boolean;
  expertSlug?: string;
  isCreateOpen: boolean;
  setIsCreateOpen: (v: boolean) => void;
  onPublished: () => void;
}

export function SignalCreateDialog({
  expert, signalTemplates, isMentor, isAdvisor, expertSlug,
  isCreateOpen, setIsCreateOpen, onPublished,
}: Props) {
  const FORM_KEY = `signal-form-${expertSlug}`;
  const DRAFT_KEY = `signal-draft-${expertSlug}`;

  const assetClass = resolveAssetClass(expert);
  const spec = getAssetSpec(assetClass);

  const [stockCode, setStockCode] = useState('');
  const [stockName, setStockName] = useState('');
  const [action, setAction] = useState('');
  const [priceHint, setPriceHint] = useState('');
  const [reasonSummary, setReasonSummary] = useState('');
  const [reasonDetail, setReasonDetail] = useState('');
  const [riskNotes, setRiskNotes] = useState('');
  const [learningPoints, setLearningPoints] = useState('');
  const [quantity, setQuantity] = useState('');
  const [quantityUnit, setQuantityUnit] = useState<QuantityUnit>(spec.defaultUnit);
  const [teachingTopic, setTeachingTopic] = useState('');
  const [overallSummary, setOverallSummary] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [fetchingQuote, setFetchingQuote] = useState(false);
  const [autoUppercased, setAutoUppercased] = useState(false);
  const [linePushing, setLinePushing] = useState(false);
  const [linePushed, setLinePushed] = useState(false);
  const [recalling, setRecalling] = useState(false);
  const [, setLastPublishedId] = useState<string | null>(null);
  const [lockedUnit, setLockedUnit] = useState<QuantityUnit | null>(null);
  const [lockedUnitSource, setLockedUnitSource] = useState<'signal' | 'trade' | null>(null);
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unitLookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uppercaseHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isCreateOpen) sessionStorage.setItem(FORM_KEY, JSON.stringify({ _open: true }));
    else sessionStorage.removeItem(FORM_KEY);
  }, [isCreateOpen, FORM_KEY]);

  const draftValue = useMemo(() => ({
    stockCode, stockName, action, priceHint, quantity, quantityUnit,
    reasonSummary, reasonDetail, riskNotes, learningPoints, teachingTopic, overallSummary,
  }), [stockCode, stockName, action, priceHint, quantity, quantityUnit,
      reasonSummary, reasonDetail, riskNotes, learningPoints, teachingTopic, overallSummary]);

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
    { enabled: isCreateOpen },
  );

  const clearForm = useCallback(() => {
    setStockCode(''); setStockName(''); setAction(''); setPriceHint(''); setQuantity(''); setQuantityUnit(spec.defaultUnit);
    setReasonSummary(''); setReasonDetail(''); setRiskNotes(''); setLearningPoints('');
    setTeachingTopic(''); setOverallSummary('');
    setLinePushed(false); setLinePushing(false); setLastPublishedId(null);
    setShowPreview(false);
    setLockedUnit(null); setLockedUnitSource(null);
    sessionStorage.removeItem(FORM_KEY);
    discardDraft();
  }, [FORM_KEY, discardDraft, spec.defaultUnit]);

  // 單位鎖定：若此代碼在 expert_signals 或 trade_records 已有既有單位，鎖定為該單位，
  // 防止未來出現 UNIT_MIX / UNIT_A_NE_B 資料漂移
  const lookupExistingUnit = useCallback(async (code: string) => {
    if (!expert?.id || !code) { setLockedUnit(null); setLockedUnitSource(null); return; }
    try {
      const { data: sig } = await supabase
        .from('expert_signals')
        .select('quantity_unit, created_at')
        .eq('expert_id', expert.id)
        .ilike('instrument', `${code}%`)
        .not('quantity_unit', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (sig?.quantity_unit && spec.units.includes(sig.quantity_unit as any)) {
        setLockedUnit(sig.quantity_unit as QuantityUnit);
        setLockedUnitSource('signal');
        setQuantityUnit(sig.quantity_unit as QuantityUnit);
        return;
      }
      const { data: tr } = await supabase
        .from('trade_records')
        .select('quantity_unit, created_at')
        .eq('expert_id', expert.id)
        .ilike('instrument', `${code}%`)
        .not('quantity_unit', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (tr?.quantity_unit && spec.units.includes(tr.quantity_unit as any)) {
        setLockedUnit(tr.quantity_unit as QuantityUnit);
        setLockedUnitSource('trade');
        setQuantityUnit(tr.quantity_unit as QuantityUnit);
        return;
      }
      setLockedUnit(null); setLockedUnitSource(null);
    } catch (e) {
      console.warn('lookupExistingUnit failed', e);
    }
  }, [expert?.id, spec.units]);

  // 若 asset_class 切換（例如從草稿回填 / 分析師切換），把不合法的 quantityUnit 校正回預設
  useEffect(() => {
    if (!spec.units.includes(quantityUnit as any)) {
      setQuantityUnit(spec.defaultUnit);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.assetClass]);

  const currencySymbol = spec.currency === 'USD' ? 'US$' : 'NT$';
  const pricePlaceholder = spec.currency === 'USD' ? '185.50' : '890';

  const fetchStockInfo = useCallback(async (code: string) => {
    const c = code.trim();
    if (!c || c.length < spec.minSymbolLen) return;
    setFetchingQuote(true);
    try {
      if (isMarketClosed(spec.marketHours) && expert?.user_id) {
        const { data: perf } = await supabase
          .from('user_performances')
          .select('name, current_price')
          .eq('user_id', expert.user_id)
          .eq('symbol', c)
          .limit(1)
          .maybeSingle();
        if (perf) {
          if (perf.name) setStockName(perf.name);
          if (perf.current_price != null) setPriceHint(String(perf.current_price));
          setFetchingQuote(false);
          return;
        }
      }
      const { resolveStockName } = await import('@/lib/stockNameResolver');
      const name = await resolveStockName(c);
      if (name) setStockName(name);
    } catch (e) {
      console.error('stock_info fetch error:', e);
    }
    setFetchingQuote(false);
  }, [expert?.user_id, spec.minSymbolLen, spec.marketHours]);

  const handleStockCodeChange = (value: string) => {
    const normalized = spec.uppercaseSymbol ? value.toUpperCase() : value;
    if (spec.uppercaseSymbol && value !== normalized && /[a-z]/.test(value)) {
      setAutoUppercased(true);
      if (uppercaseHintTimer.current) clearTimeout(uppercaseHintTimer.current);
      uppercaseHintTimer.current = setTimeout(() => setAutoUppercased(false), 3000);
    }
    setStockCode(normalized);
    if (fetchTimer.current) clearTimeout(fetchTimer.current);
    if (unitLookupTimer.current) clearTimeout(unitLookupTimer.current);
    const trimmed = normalized.trim();
    if (!trimmed) {
      setLockedUnit(null); setLockedUnitSource(null);
      return;
    }
    if (trimmed.length >= spec.minSymbolLen) {
      fetchTimer.current = setTimeout(() => fetchStockInfo(normalized), 500);
      unitLookupTimer.current = setTimeout(() => lookupExistingUnit(trimmed), 400);
    }
  };

  const canPublish = isMentor
    ? !!expert && !!stockCode.trim() && !!action && !!teachingTopic.trim()
    : !!expert && !!stockCode.trim() && !!action;

  const handlePublish = async () => {
    if (!expert) { toast.error('找不到分析師資料，請重新整理後再試'); return; }
    if (!expert.asset_class) {
      toast.error('請先到「分析師設定」選擇主打資產類別（台股 / 美股 / 加密），才能發布訊號或週記');
      return;
    }
    if (!stockCode.trim() || !action) { toast.error('請先填寫「代碼」與「操作方向」'); return; }
    if (!isValidAssetSymbol(stockCode, assetClass)) {
      toast.error(`代碼格式錯誤（${spec.symbolPlaceholder}）`); return;
    }
    if (!quantity || parseFloat(quantity) <= 0) { toast.error('請輸入數量'); return; }
    if (!priceHint || parseFloat(priceHint) <= 0) { toast.error('請輸入參考價格'); return; }
    if (lockedUnit && quantityUnit !== lockedUnit) {
      toast.error(`此代碼既有部位單位為「${lockedUnit}」，請勿混用單位以避免資料漂移`);
      return;
    }


    const latestName = stockName.trim();

    if (['add', 'trim', 'sell', 'exit'].includes(action)) {
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
      if (['trim', 'sell'].includes(action) && parseFloat(quantity) > openPos.quantity) {
        toast.error(`減碼數量 (${quantity}) 超過持倉量 (${openPos.quantity})`);
        return;
      }
    }
    const latestPrice = priceHint;
    const parsedQty = spec.quantityAllowsDecimal ? parseFloat(quantity) : parseInt(quantity);
    const instrument = latestName ? `${stockCode.trim()} ${latestName}` : stockCode.trim();
    const { data: inserted, error } = await supabase.from('expert_signals').insert({
      expert_id: expert.id,
      plan_id: null,
      instrument,
      action: action as any,
      price_hint: latestPrice ? parseFloat(latestPrice) : null,
      quantity: quantity ? parsedQty : null,
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

    if (expert.user_id) {
      const entryPrice = latestPrice ? parseFloat(latestPrice) : 0;
      if (action === 'exit') {
        await supabase.from('trade_signals').update({ status: 'closed' } as any)
          .eq('user_id', expert.user_id).eq('symbol', stockCode.trim()).eq('status', 'open');
        await supabase.from('user_performances').delete()
          .eq('user_id', expert.user_id).eq('symbol', stockCode.trim());
      } else if (action === 'sell' || action === 'trim') {
        const { data: remainingTrade } = await supabase
          .from('trade_records').select('id')
          .eq('expert_id', expert.id)
          .eq('instrument', `${stockCode.trim()} ${latestName || ''}`.trim())
          .eq('status', 'open').limit(1);
        if (!remainingTrade || remainingTrade.length === 0) {
          await supabase.from('trade_signals').update({ status: 'closed' } as any)
            .eq('user_id', expert.user_id).eq('symbol', stockCode.trim()).eq('status', 'open');
          await supabase.from('user_performances').delete()
            .eq('user_id', expert.user_id).eq('symbol', stockCode.trim());
        }
      } else if (action === 'add') {
        const { data: existing } = await supabase
          .from('trade_signals').select('id')
          .eq('user_id', expert.user_id).eq('symbol', stockCode.trim()).eq('status', 'open').limit(1);
        if (!existing || existing.length === 0) {
          const { data: tsData } = await supabase.from('trade_signals').insert({
            user_id: expert.user_id, symbol: stockCode.trim(),
            name: latestName || null, entry_price: entryPrice, status: 'open',
          } as any).select('id').single();
          if (tsData) {
            await supabase.from('user_performances').insert({
              user_id: expert.user_id, signal_id: (tsData as any).id,
              symbol: stockCode.trim(), name: latestName || null,
              entry_price: entryPrice, current_price: entryPrice, pnl: 0, pnl_percent: 0,
            } as any);
          }
        }
      } else {
        const { data: tsData, error: tsError } = await supabase.from('trade_signals').insert({
          user_id: expert.user_id, symbol: stockCode.trim(),
          name: latestName || null, entry_price: entryPrice, status: 'open',
        } as any).select('id').single();
        if (tsError) {
          console.error('trade_signals insert failed:', tsError);
          toast.error('持倉記錄寫入失敗');
        }
        if (tsData) {
          await supabase.from('user_performances').insert({
            user_id: expert.user_id, signal_id: (tsData as any).id,
            symbol: stockCode.trim(), name: latestName || null,
            entry_price: entryPrice, current_price: entryPrice, pnl: 0, pnl_percent: 0,
          } as any);
        }
      }
    }

    toast.success(isMentor ? '週記已儲存，將於本週五 20:00 統一發布' : '訊號已發布');
    setIsCreateOpen(false);
    clearForm();

    const skipLinePush = isMentor || (isAdvisor && linePushed);
    if (inserted?.id && !skipLinePush) {
      supabase.functions.invoke('line-push-signal', {
        body: { signal_id: inserted.id, expert_id: expert.id },
      }).then(({ data: pushData, error: pushError }) => {
        if (pushError) toast.error(`LINE 推播失敗：${pushError.message}`);
        else if (pushData?.pushed) toast.success(`已推播給 ${pushData.count} 位訂閱者`);
        else if (pushData?.reason) toast.info(`LINE 推播略過：${pushData.reason}`);
      }).catch((err) => {
        console.error('LINE push invoke error:', err);
        toast.error('LINE 推播呼叫失敗');
      });
    }
    onPublished();
  };

  return (
    <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
      <DialogContent
        data-testid="signal-create-dialog"
        className="w-[calc(100vw-1rem)] max-w-lg max-h-[90dvh] landscape:max-h-[95dvh] flex flex-col"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            發布新{isMentor ? '週記' : '訊號'}
            <Badge variant="outline" className="text-[10px]">{spec.label} · {spec.currency}</Badge>
          </DialogTitle>
        </DialogHeader>
        <div
          data-testid="signal-create-scroll"
          className="space-y-4 mt-4 overflow-y-auto flex-1 min-h-0 p-1 -m-1 overscroll-contain"
        >
          {isMentor && (
            <div className="space-y-2">
              <Label>教學主題</Label>
              <Input value={teachingTopic} onChange={(e) => setTeachingTopic(e.target.value)} />
            </div>
          )}
          {isMentor && (
            <div className="space-y-2">
              <Label>整體摘要</Label>
              <Textarea value={overallSummary} onChange={(e) => setOverallSummary(e.target.value)} rows={2} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>股票代碼</Label>
              <Input value={stockCode} onChange={(e) => handleStockCodeChange(e.target.value)} placeholder={spec.symbolPlaceholder} />
              {autoUppercased && (
                <p
                  data-testid="uppercase-hint"
                  className="text-[11px] text-muted-foreground animate-in fade-in slide-in-from-top-1 duration-200"
                  aria-live="polite"
                >
                  已自動轉大寫
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>股票名稱 {fetchingQuote && <Loader2 className="inline h-3 w-3 animate-spin text-muted-foreground" />}</Label>
              <Input value={stockName} onChange={(e) => setStockName(e.target.value)} />
            </div>
          </div>
          {signalTemplates.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">訊號模板</Label>
              <div data-testid="signal-template-group" className="flex flex-wrap gap-x-1.5 gap-y-2 max-h-16 overflow-y-auto p-0.5 -m-0.5">
                {signalTemplates.map((tpl) => {
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
                      className={cn('h-6 text-xs px-2', actionColor[tpl.action] || '')}
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
              <Label>參考價位（{currencySymbol}）</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{currencySymbol}</span>
                <Input
                  value={priceHint}
                  onChange={(e) => setPriceHint(e.target.value)}
                  type="number"
                  step={spec.priceDigits >= 4 ? '0.0001' : '0.01'}
                  placeholder={pricePlaceholder}
                  className="pl-11"
                />
              </div>
            </div>
          </div>
          {action && (
            <div className="space-y-2">
              <Label>數量</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={quantity}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '' || Number(v) >= 0) setQuantity(v);
                  }}
                  type="number"
                  min="0"
                  step={spec.quantityAllowsDecimal ? '0.0001' : '1'}
                  placeholder={spec.quantityAllowsDecimal ? '0.5' : '1'}
                  className="w-32"
                />
                <Select
                  value={quantityUnit}
                  onValueChange={(v) => setQuantityUnit(v as '張' | '股' | '顆')}
                  disabled={spec.units.length === 1 || !!lockedUnit}
                >
                  <SelectTrigger
                    className="w-20"
                    data-testid="quantity-unit-select"
                    data-locked={lockedUnit ? 'true' : 'false'}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {spec.units.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {lockedUnit && (
                <p
                  data-testid="unit-locked-hint"
                  className="text-[11px] text-muted-foreground"
                  aria-live="polite"
                >
                  已鎖定單位「{lockedUnit}」（依既有{lockedUnitSource === 'trade' ? '持倉' : '訊號'}）— 避免 UNIT_MIX 漂移
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label>為什麼這樣操作？</Label>
            <Textarea value={reasonSummary} onChange={(e) => setReasonSummary(e.target.value)} rows={2} />
            {isAdvisor && canPublish && (
              <div className="flex gap-2 mt-1">
                <Button
                  type="button"
                  variant="outline"
                  className={cn('flex-1 border-advisor text-advisor hover:bg-advisor/10', linePushed && 'opacity-60 cursor-default')}
                  disabled={linePushing || linePushed || !reasonSummary.trim()}
                  onClick={async () => {
                    if (!expert) return;
                    if (!quantity || parseFloat(quantity) <= 0) { toast.error('請輸入數量'); return; }
                    if (!priceHint || parseFloat(priceHint) <= 0) { toast.error('請輸入參考價格'); return; }
                    setLinePushing(true);
                    try {
                      const instrument = stockName.trim() ? `${stockCode.trim()} ${stockName.trim()}` : stockCode.trim();
                      const { data: pushData, error: pushError } = await supabase.functions.invoke('line-push-signal', {
                        body: {
                          expert_id: expert.id, mode: 'preview',
                          signal_data: {
                            action, instrument,
                            price_hint: priceHint ? parseFloat(priceHint) : null,
                            quantity: quantity ? (spec.quantityAllowsDecimal ? parseFloat(quantity) : parseInt(quantity)) : null,
                            quantity_unit: quantityUnit, reason_summary: reasonSummary,
                          },
                        },
                      });
                      if (pushError) toast.error(`LINE 推播失敗：${pushError.message}`);
                      else if (pushData?.pushed) {
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
                            expert_id: expert.id, mode: 'preview',
                            signal_data: { action, instrument, price_hint: priceHint ? parseFloat(priceHint) : null },
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
            <Textarea value={reasonDetail} onChange={(e) => setReasonDetail(e.target.value)} rows={3} />
          </div>
          <div className="space-y-2">
            <Label>風險提醒</Label>
            <Textarea value={riskNotes} onChange={(e) => setRiskNotes(e.target.value)} rows={2} />
          </div>
          {isMentor && (
            <div className="space-y-2">
              <Label>教學重點</Label>
              <Textarea value={learningPoints} onChange={(e) => setLearningPoints(e.target.value)} rows={3} />
            </div>
          )}
          {isMentor && canPublish && (
            <>
              <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => setShowPreview(true)}>
                <Eye className="h-4 w-4 mr-2" />訂閱者預覽
              </Button>
              <Dialog open={showPreview} onOpenChange={setShowPreview}>
                <DialogContent className="max-w-[80vw] max-h-[80vh] overflow-y-auto p-0">
                  <div className="p-4 space-y-4">
                    <div className="flex items-center gap-3">
                      <img src={avatarUrl(expert?.avatar_url, 80)} alt={expert?.name} loading="lazy" decoding="async" className="shrink-0 h-10 w-10 rounded-full object-cover object-[center_15%]" />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{expert?.name}</span>
                          <Badge variant="secondary" className="text-[10px]">實戰導師</Badge>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span>📅 本週週記預覽</span>
                      <Badge variant="outline" className="text-[10px] bg-mentor/10 text-mentor border-mentor/20">T+7 歷史</Badge>
                    </div>
                    {teachingTopic && <h1 className="text-xl font-bold">📚 {teachingTopic}</h1>}
                    {overallSummary && (
                      <Card><CardContent className="p-4">
                        <h2 className="font-semibold mb-2">本週整體摘要</h2>
                        <p className="text-sm text-muted-foreground whitespace-pre-line">{overallSummary}</p>
                      </CardContent></Card>
                    )}
                    <div>
                      <h2 className="font-semibold mb-3">本週操作列表</h2>
                      <Card><CardContent className="p-0">
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
                      </CardContent></Card>
                    </div>
                    {learningPoints && (
                      <Card><CardContent className="p-4">
                        <h2 className="font-semibold mb-2 flex items-center gap-2">
                          <span className="text-mentor">📖</span> 本週教學重點
                        </h2>
                        <ul className="space-y-2">
                          {learningPoints.split('\n').filter((l) => l.trim()).map((point, idx) => (
                            <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                              <span className="text-mentor">•</span> {point.replace(/^[•·．‧●○◆■□▪▫※☆★→➤➜▸▹►▻‣⁃–—\-]\s*/gm, '')}
                            </li>
                          ))}
                        </ul>
                      </CardContent></Card>
                    )}
                    <Card className="bg-muted/30"><CardContent className="p-4 flex items-start gap-2">
                      <span className="text-muted-foreground mt-0.5 flex-shrink-0">🛡️</span>
                      <p className="text-xs text-muted-foreground">
                        本頁內容為一週前之操作回顧（T+7），僅供教學用途，不構成任何即時投資建議。
                      </p>
                    </CardContent></Card>
                  </div>
                </DialogContent>
              </Dialog>
            </>
          )}
          {isAdvisor && canPublish && (
            <Card className="bg-muted/50"><CardContent className="p-4 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">📋 訂閱者預覽</p>
              <div className="flex items-start gap-2 flex-wrap">
                <Badge variant="secondary" className="text-xs shrink-0">{actionLabels[action]?.label || action}</Badge>
                <InstrumentTooltip
                  full={stockName ? `${stockCode} ${stockName}` : stockCode}
                  data-testid="advisor-preview-instrument"
                  className="font-medium text-[13px] sm:text-sm min-w-0 break-words [overflow-wrap:anywhere] tracking-normal"
                >
                  <span className="font-mono tabular-nums tracking-normal">{stockCode}</span>
                  {stockName && <> <span className="tracking-tight">{stockName}</span></>}
                </InstrumentTooltip>
                {priceHint && <span className="font-mono tabular-nums text-[13px] sm:text-sm text-muted-foreground shrink-0 whitespace-nowrap tracking-normal">@ {currencySymbol}{priceHint}</span>}
                {quantity && <span className="font-mono tabular-nums text-[13px] sm:text-sm text-muted-foreground shrink-0 whitespace-nowrap tracking-normal">{quantity} <span className="font-sans">{quantityUnit}</span></span>}
              </div>
              {reasonSummary && <p className="text-sm">{reasonSummary}</p>}
              {reasonDetail && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{reasonDetail}</p>}
              {riskNotes && <p className="text-xs text-destructive">⚠️ {riskNotes}</p>}
            </CardContent></Card>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => { setIsCreateOpen(false); clearForm(); }}>取消</Button>
            <Button
              onClick={handlePublish}
              disabled={!canPublish}
              className={cn(isAdvisor ? 'bg-advisor hover:bg-advisor/90' : 'bg-mentor hover:bg-mentor/90')}
            >
              立即發布
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
