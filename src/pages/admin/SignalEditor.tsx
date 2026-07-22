import { SEO } from '@/components/SEO';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { isPublishingWindowOpen } from '@/lib/publishingWindow';
import { useFormDraft } from '@/hooks/useFormDraft';
import { LazyRichTextEditor as RichTextEditor } from '@/components/admin/LazyRichTextEditor';
import { sanitizeRichHtml, htmlToPlainText } from '@/lib/sanitizeHtml';
import { cn } from '@/lib/utils';
import { Plus, Loader2, ArrowLeft, Eye } from 'lucide-react';
import { JournalPreviewDialog } from '@/pages/_signalEditor/JournalPreviewDialog';
import { toast } from 'sonner';
import {
  emptyTrade, newUid,
  type TradeDraft, type AIAssistFn,
} from '@/pages/_signalEditor/types';
import { CapitalPanel } from '@/pages/_signalEditor/CapitalPanel';
import { TradeCard } from '@/pages/_signalEditor/TradeCard';
import {
  buildPublishRows, buildTeachingOnlyRow, buildSimulatedPositions, computeCashSim, validateSignalBatch,
} from '@/pages/_signalEditor/derive';
import { useSignalEditorData } from '@/hooks/admin/useSignalEditorData';
import { getAssetSpec, resolveAssetClass, sanitizeAssetQuantityUnit } from '@/lib/asset';

const SignalEditor = () => {
  const { expertSlug, batchId: editBatchId } = useParams<{ expertSlug: string; batchId?: string }>();
  const isEditing = !!editBatchId;
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();

  const isCompanyAdmin = hasRole('company_admin');
  const isOwner = !!user?.expertSlug && user.expertSlug === expertSlug;
  const canEdit = isCompanyAdmin || isOwner;

  // ── Form state ────────────────────────────────────────────────────────
  const [teachingTopic, setTeachingTopic] = useState('');
  const [overallSummary, setOverallSummary] = useState('');
  const [learningPoints, setLearningPoints] = useState('');
  const [trades, setTrades] = useState<TradeDraft[]>([emptyTrade()]);
  const [showHistory, setShowHistory] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /** mentor 本週類型：'trades' = 交易週記（預設）； 'teaching' = 純教學週記，無交易 */
  const [weekType, setWeekType] = useState<'trades' | 'teaching'>('trades');
  const [previewOpen, setPreviewOpen] = useState(false);

  // ── Data (expert / templates / open positions / capital) ──────────────
  const {
    expert, signalTemplates, openPositions, capital, currency, loading, reloadCapital,
  } = useSignalEditorData({
    expertSlug,
    editBatchId,
    isEditing,
    onBatchLoaded: ({ teachingTopic: tt, overallSummary: os, learningPoints: lp, trades: ts }) => {
      setTeachingTopic(tt);
      setOverallSummary(os);
      setLearningPoints(lp);
      setTrades(ts);
      // 編輯既有批次：若所有 trade 都是 teaching action，視為純教學週記
      if (ts.length > 0 && ts.every((t: any) => t.action === 'teaching')) {
        setWeekType('teaching');
      }
    },
    onMissingBatch: () => {
      toast.error('找不到要編輯的批次');
      navigate(`/admin/${expertSlug}/signals`, { replace: true });
    },
  });

  const assetClass = resolveAssetClass(expert);
  const assetSpec = getAssetSpec(assetClass);

  // 當 expert 的 asset_class 載入後，校正草稿殘留單位；確保 us_stock 永遠為「股」。
  useEffect(() => {
    if (!expert) return;
    setTrades((prev) => {
      if (prev.length !== 1) return prev;
      const t = prev[0];
      const isEmpty = !t.stockCode && !t.quantity && !t.priceHint && !t.reasonSummary && !t.action;
      if (isEmpty) {
        const fresh = emptyTrade(assetClass);
        if (fresh.quantityUnit === t.quantityUnit) return prev;
        return [{ ...fresh, uid: t.uid }];
      }
      const safeUnit = sanitizeAssetQuantityUnit(t.quantityUnit, assetClass);
      if (safeUnit === t.quantityUnit) return prev;
      return [{ ...t, quantityUnit: safeUnit }];
    });
  }, [expert, assetClass]);

  useEffect(() => {
    if (!expert) return;
    setTrades((prev) => {
      let changed = false;
      const next = prev.map((t) => {
        const safeUnit = sanitizeAssetQuantityUnit(t.quantityUnit, assetClass);
        if (safeUnit === t.quantityUnit) return t;
        changed = true;
        return { ...t, quantityUnit: safeUnit };
      });
      return changed ? next : prev;
    });
  }, [expert, assetClass]);

  const isMentor = expert?.role === 'mentor';
  const publishWindow = isPublishingWindowOpen();
  const stockCacheRef = useRef<Map<string, string>>(new Map());

  // ── Draft persistence ────────────────────────────────────────────────
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
        setTrades(saved.trades.map((t: any) => {
          const merged = { ...emptyTrade(assetClass), ...t, uid: t.uid || newUid() };
          return { ...merged, quantityUnit: sanitizeAssetQuantityUnit(merged.quantityUnit, assetClass) };
        }));
      }
    },
    { enabled: !isEditing },
  );

  // ── Permission guard ─────────────────────────────────────────────────
  if (!loading && expert && !canEdit) {
    toast.error('沒有編輯權限');
    navigate(`/admin/${expertSlug}/signals`, { replace: true });
  }

  // ── Trade-row mutators ───────────────────────────────────────────────
  const updateTrade = useCallback((idx: number, patch: Partial<TradeDraft>) =>
    setTrades((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t))), []);
  const addTrade = useCallback(() => setTrades((prev) => [...prev, emptyTrade(assetClass)]), [assetClass]);
  const removeTrade = useCallback(
    (idx: number) => setTrades((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx))),
    [],
  );
  const moveTrade = useCallback((idx: number, dir: -1 | 1) => {
    setTrades((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }, []);

  // ── Stock-name lookup ────────────────────────────────────────────────
  const fetchStockInfo = useCallback(async (idx: number, code: string) => {
    // uppercase 確保台股 ETF 字尾（如 00631L）與大小寫快取一致
    const c = code.trim().toUpperCase();
    const minLen = assetSpec.minSymbolLen;
    if (!c || c.length < minLen) return;
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
    } catch { /* ignore */ }
  }, [assetSpec.minSymbolLen]);

  // ── AI assist passthrough ────────────────────────────────────────────
  const callAIAssist = useCallback<AIAssistFn>(async (field, mode, currentHtml, instruction, context) => {
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

  // ── Simulation ───────────────────────────────────────────────────────
  const cashSim = useMemo(() => {
    return computeCashSim(trades, capital);
  }, [capital, trades]);

  const simulatedPositions = useMemo(
    () => buildSimulatedPositions(trades, capital),
    [trades, capital],
  );

  // ── Publish ──────────────────────────────────────────────────────────
  const isTeachingOnly = isMentor && weekType === 'teaching';

  const handlePublish = async () => {
    if (!canEdit) return;
    if (!publishWindow.open) {
      toast.error(publishWindow.reason || '目前不在發布時段');
      return;
    }
    if (!expert?.asset_class) {
      toast.error('請先到「分析師設定」選擇主打資產類別（台股 / 美股 / 加密），才能發布訊號或週記');
      return;
    }
    if (isTeachingOnly) {
      if (!teachingTopic.trim()) {
        toast.error('純教學週記至少要填教學主題');
        return;
      }
    } else {
      const err = validateSignalBatch({ expert, trades, openPositions, capital });
      if (err) { toast.error(err); return; }
    }

    setSubmitting(true);
    try {
      const batchId = isEditing ? (editBatchId as string) : crypto.randomUUID();
      const status = isMentor ? 'pending' : 'published';

      const rows = isTeachingOnly
        ? buildTeachingOnlyRow({
            expertId: expert.id, batchId, status,
            teachingTopic, overallSummary, learningPoints,
          })
        : buildPublishRows({
            expertId: expert.id, batchId, status, assetClass, isMentor,
            teachingTopic, overallSummary, learningPoints, trades,
          });

      if (isEditing) {
        // 先刪舊 trade_records → 再刪舊 expert_signals（FK 依賴順序）
        const { data: oldSigs } = await supabase
          .from('expert_signals').select('id').eq('batch_id', batchId);
        const oldIds = (oldSigs || []).map((r: any) => r.id);
        if (oldIds.length > 0) {
          await supabase.rpc('admin_delete_trade_records_by_signal_ids', {
            _signal_ids: oldIds,
          });
        }
        await supabase.from('expert_signals').delete().eq('batch_id', batchId);
      }

      const { error } = await supabase.from('expert_signals').insert(rows as any);
      if (error) { toast.error(error.message); return; }

      if (!isMentor) {
        try {
          const { data: pushData, error: pushErr } = await supabase.functions.invoke('line-push-signal', {
            body: { expert_id: expert.id, batch_id: batchId, type: 'publish', is_update: isEditing },
          });
          if (pushErr) console.warn('LINE push (batch) failed:', pushErr);
          else if (pushData?.pushed) console.log('LINE batch pushed:', pushData);
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
      if (expert?.id) reloadCapital();
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
      <SEO title={`${expertSlug || ''} 訊號編輯 | legendflow`} description={'撰寫或編輯策略訊號。'} path={`/admin/${expertSlug || ''}/signals/edit`} noindex />
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
            {isMentor && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setPreviewOpen(true)}
                title="以前台版型預覽（不會送出）"
              >
                <Eye className="h-4 w-4 mr-1" /> 預覽
              </Button>
            )}
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

        {isMentor && (
          <Card>
            <CardContent className="p-4 space-y-3">
              <Label className="text-sm">本週類型</Label>
              <div className="flex gap-2 flex-wrap">
                <Button
                  type="button"
                  variant={weekType === 'trades' ? 'default' : 'outline'}
                  size="sm"
                  className={cn(weekType === 'trades' && 'bg-mentor hover:bg-mentor/90')}
                  onClick={() => setWeekType('trades')}
                >交易週記（含進出場 / 觀察）</Button>
                <Button
                  type="button"
                  variant={weekType === 'teaching' ? 'default' : 'outline'}
                  size="sm"
                  className={cn(weekType === 'teaching' && 'bg-mentor hover:bg-mentor/90')}
                  onClick={() => setWeekType('teaching')}
                >純教學週記（無交易）</Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {weekType === 'teaching'
                  ? '本週不會帶任何進出場紀錄，只發布教學主題、整體摘要、教學重點。'
                  : '本週至少有一檔股票操作；若只是想對既有持倉做觀察，可在操作方向選「觀察」。'}
              </p>
            </CardContent>
          </Card>
        )}

        {!isTeachingOnly && capital && (
          <CapitalPanel
            capital={capital}
            cashSim={cashSim}
            simulatedPositions={simulatedPositions}
            trades={trades}
            showHistory={showHistory}
            setShowHistory={setShowHistory}
            addTrade={addTrade}
            updateTrade={updateTrade}
            currency={currency}
            assetClass={assetClass}
          />
        )}

        {isMentor && (
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="space-y-2">
                <Label>教學主題{isTeachingOnly && <span className="text-destructive ml-1">*</span>}</Label>
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

        {!isTeachingOnly && trades.map((t, idx) => (
          <TradeCard
            key={t.uid}
            idx={idx}
            trade={t}
            totalTrades={trades.length}
            signalTemplates={signalTemplates}
            capital={capital}
            cashSim={cashSim}
            simulatedPositions={simulatedPositions}
            expertId={expert?.id}
            currency={currency}
            assetClass={assetClass}
            allowHold={isMentor}
            updateTrade={updateTrade}
            removeTrade={removeTrade}
            moveTrade={moveTrade}
            fetchStockInfo={fetchStockInfo}
            callAIAssist={callAIAssist}
          />
        ))}

        {!isTeachingOnly && (
          <Button type="button" variant="outline" className="w-full border-dashed" onClick={addTrade}>
            <Plus className="h-4 w-4 mr-2" /> 新增另一檔股票
          </Button>
        )}

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

        <div className="flex justify-end gap-2 flex-wrap">
          <Button variant="outline" onClick={() => navigate(`/admin/${expertSlug}/signals`)}>取消</Button>
          {isMentor && (
            <Button type="button" variant="outline" onClick={() => setPreviewOpen(true)}>
              <Eye className="h-4 w-4 mr-1" /> 預覽
            </Button>
          )}
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

      <JournalPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        expert={expert as any}
        isTeachingOnly={isTeachingOnly}
        teachingTopic={teachingTopic}
        overallSummary={overallSummary}
        learningPoints={learningPoints}
        trades={trades}
      />
    </AdminLayout>
  );
};

export default SignalEditor;
