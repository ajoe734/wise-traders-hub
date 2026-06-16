import { SEO } from '@/components/SEO';
import { useCallback, useMemo, useRef, useState } from 'react';
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
import { Plus, Loader2, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import {
  emptyTrade, newUid,
  type TradeDraft, type AIAssistFn,
} from '@/pages/_signalEditor/types';
import { CapitalPanel } from '@/pages/_signalEditor/CapitalPanel';
import { TradeCard } from '@/pages/_signalEditor/TradeCard';
import {
  buildPublishRows, buildSimulatedPositions, computeCashSim, validateSignalBatch,
} from '@/pages/_signalEditor/derive';
import { useSignalEditorData } from '@/hooks/admin/useSignalEditorData';

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

  // ── Data (expert / templates / open positions / capital) ──────────────
  const {
    expert, signalTemplates, openPositions, capital, loading, reloadCapital,
  } = useSignalEditorData({
    expertSlug,
    editBatchId,
    isEditing,
    onBatchLoaded: ({ teachingTopic: tt, overallSummary: os, learningPoints: lp, trades: ts }) => {
      setTeachingTopic(tt);
      setOverallSummary(os);
      setLearningPoints(lp);
      setTrades(ts);
    },
    onMissingBatch: () => {
      toast.error('找不到要編輯的批次');
      navigate(`/admin/${expertSlug}/signals`, { replace: true });
    },
  });

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
        setTrades(saved.trades.map((t: any) => ({ ...emptyTrade(), ...t, uid: t.uid || newUid() })));
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
  const addTrade = useCallback(() => setTrades((prev) => [...prev, emptyTrade()]), []);
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
    } catch { /* ignore */ }
  }, []);

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
  const handlePublish = async () => {
    if (!canEdit) return;
    if (!publishWindow.open) {
      toast.error(publishWindow.reason || '目前不在發布時段');
      return;
    }
    const err = validateSignalBatch({ expert, trades, openPositions, capital });
    if (err) { toast.error(err); return; }

    setSubmitting(true);
    try {
      const batchId = isEditing ? (editBatchId as string) : crypto.randomUUID();
      const status = isMentor ? 'pending' : 'published';

      const rows = buildPublishRows({
        expertId: expert.id, batchId, status, isMentor,
        teachingTopic, overallSummary, learningPoints, trades,
      });

      if (isEditing) {
        // 先刪舊 trade_records → 再刪舊 expert_signals（FK 依賴順序）
        await supabase.from('trade_records').delete().eq('expert_id', expert.id).in(
          'signal_id',
          (
            await supabase.from('expert_signals').select('id').eq('batch_id', batchId)
          ).data?.map((r: any) => r.id) || [],
        );
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

        {capital && (
          <CapitalPanel
            capital={capital}
            cashSim={cashSim}
            simulatedPositions={simulatedPositions}
            trades={trades}
            showHistory={showHistory}
            setShowHistory={setShowHistory}
            addTrade={addTrade}
            updateTrade={updateTrade}
          />
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
          <TradeCard
            key={t.uid}
            idx={idx}
            trade={t}
            totalTrades={trades.length}
            signalTemplates={signalTemplates}
            capital={capital}
            cashSim={cashSim}
            expertId={expert?.id}
            updateTrade={updateTrade}
            removeTrade={removeTrade}
            moveTrade={moveTrade}
            fetchStockInfo={fetchStockInfo}
            callAIAssist={callAIAssist}
          />
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
