import { SEO } from '@/components/SEO';
import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { isPublishingWindowOpen, canRecallSignal } from '@/lib/publishingWindow';
import { PermissionTooltip } from '@/components/admin/PermissionTooltip';
import { useAdminSignals } from '@/hooks/useAdminSignals';
import { SignalsTable } from '@/pages/_adminSignals/SignalsTable';
import { SignalCreateDialog } from '@/pages/_adminSignals/SignalCreateDialog';
import {
  computeAddBuySignalIds, computeBatchInfo, computeHoldingSummary, filterSignals,
} from '@/pages/_adminSignals/derive';

const AdminSignals = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();
  const isCompanyAdmin = hasRole('company_admin');
  const isOwner = !!user?.expertSlug && user.expertSlug === expertSlug;
  const isReadOnly = !isCompanyAdmin && !isOwner;

  const {
    expert, signals, openInstruments, signalTemplates,
    loading, setSignals, refetch: refetchAdminSignals,
  } = useAdminSignals(expertSlug);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [recalling, setRecalling] = useState(false);
  const [repushingId, setRepushingId] = useState<string | null>(null);
  const [collapsedBatches, setCollapsedBatches] = useState<Set<string>>(new Set());

  const FORM_KEY = `signal-form-${expertSlug}`;
  const getSavedOpen = () => {
    try { return !!JSON.parse(sessionStorage.getItem(FORM_KEY) || '{}')?._open; } catch { return false; }
  };
  const [isCreateOpen, setIsCreateOpen] = useState(getSavedOpen);

  const isAdvisor = expert?.role === 'advisor';
  const isMentor = expert?.role === 'mentor';
  const contentLabel = isMentor ? '週記' : '訊號';
  const publishWindow = isPublishingWindowOpen();

  const pendingCount = useMemo(
    () => (isMentor ? signals.filter((s) => s.status === 'pending').length : 0),
    [signals, isMentor],
  );

  const addBuySignalIds = useMemo(
    () => computeAddBuySignalIds(signals, openInstruments),
    [signals, openInstruments],
  );

  const filtered = useMemo(
    () => filterSignals(signals, searchQuery, openInstruments, addBuySignalIds),
    [signals, searchQuery, openInstruments, addBuySignalIds],
  );

  const batchInfo = useMemo(() => computeBatchInfo(signals), [signals]);
  const holdingSummary = useMemo(() => computeHoldingSummary(filtered, searchQuery), [filtered, searchQuery]);

  const visibleSignals = useMemo(() => {
    const seen = new Set<string>();
    return filtered.filter((s: any) => {
      if (!s.batch_id || !collapsedBatches.has(s.batch_id)) return true;
      if (seen.has(s.batch_id)) return false;
      seen.add(s.batch_id);
      return true;
    });
  }, [filtered, collapsedBatches]);

  const handleRecall = async (signalId: string) => {
    if (!expert || recalling) return;
    const target = signals.find((s: any) => s.id === signalId) as any;
    const batchId = target?.batch_id || null;
    const batchSiblings = batchId ? signals.filter((s: any) => s.batch_id === batchId) : [];
    const isBatch = batchSiblings.length > 1;

    const candidates = isBatch ? batchSiblings : [target];
    const earliestPub = candidates.map((s: any) => s?.published_at).filter(Boolean).sort()[0];
    const guard = canRecallSignal(earliestPub);
    if (!guard.ok) { toast.error(guard.reason || '已過收回期限'); return; }

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
        .from('expert_signals').select('*').in('id', idsToRecall);

      if (!signalsToRecall || signalsToRecall.length === 0) {
        toast.error('找不到該訊號'); setRecalling(false); return;
      }

      const pushable = signalsToRecall.filter((s: any) => !(isMentor && s.status === 'pending'));
      if (pushable.length > 0) {
        await Promise.all(pushable.map((s: any) =>
          supabase.functions.invoke('line-push-signal', {
            body: {
              expert_id: expert.id, mode: 'preview',
              signal_data: { action: s.action, instrument: s.instrument, price_hint: s.price_hint },
              type: 'recall',
            },
          }).catch(() => {}),
        ));
      }

      for (const sig of signalsToRecall) {
        const symbol = sig.instrument.split(' ')[0];
        if (expert.user_id && symbol) {
          const { data: otherSignals } = await supabase
            .from('expert_signals').select('id')
            .eq('expert_id', expert.id)
            .eq('status', 'published' as any)
            .ilike('instrument', `${symbol}%`)
            .not('id', 'in', `(${idsToRecall.map((x) => `"${x}"`).join(',')})`)
            .limit(1);

          if (!otherSignals || otherSignals.length === 0) {
            await Promise.all([
              supabase.rpc('admin_delete_trade_records_by_symbol', {
                _expert_id: expert.id,
                _symbol_prefix: symbol,
              }),
              supabase.from('trade_signals').delete().eq('user_id', expert.user_id).eq('symbol', symbol),
              supabase.from('user_performances').delete().eq('user_id', expert.user_id).eq('symbol', symbol),
            ]);
          } else {
            await supabase.rpc('admin_delete_trade_records_by_signal_ids', {
              _signal_ids: [sig.id],
            });
          }
        }
      }

      await supabase.from('expert_signals').delete().in('id', idsToRecall);
      toast.success(isBatch ? `已收回批次 ${idsToRecall.length} 筆訊號` : '訊號已收回');
      setSignals((prev) => prev.filter((s) => !idsToRecall.includes(s.id)));
      refetchAdminSignals();
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
      if (error) toast.error(`重推失敗：${error.message}`);
      else if (data?.pushed) toast.success(`已重推給 ${data.count} 位 LINE 訂閱者（標記為「已更新」）`);
      else if (data?.reason) toast.info(`未推播：${data.reason}`);
      else toast.info('未推播：無有效收件者');
    } catch (err: any) {
      console.error('Repush failed:', err);
      toast.error('重推失敗，請重試');
    }
    setRepushingId(null);
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-64 text-muted-foreground">載入中...</div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <SEO title={`${expertSlug || ''} 訊號管理 | legendflow`} description={'發布與管理策略訊號。'} path={`/admin/${expertSlug || ''}/signals`} noindex />
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
            <PermissionTooltip disabled={isReadOnly}>
              <Button
                disabled={!publishWindow.open || isReadOnly}
                className={cn(isAdvisor ? 'bg-advisor hover:bg-advisor/90' : 'bg-mentor hover:bg-mentor/90')}
                onClick={() => navigate(`/admin/${expertSlug}/signals/new`)}
              >
                <Plus className="h-4 w-4 mr-2" />發布新{contentLabel}
              </Button>
            </PermissionTooltip>
            <SignalCreateDialog
              expert={expert}
              signalTemplates={signalTemplates}
              isMentor={isMentor}
              isAdvisor={isAdvisor}
              expertSlug={expertSlug}
              isCreateOpen={isCreateOpen}
              setIsCreateOpen={setIsCreateOpen}
              onPublished={() => refetchAdminSignals()}
            />
          </div>
        </div>

        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜尋：標的、日期、方向、狀態（用「、」分隔）"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        <SignalsTable
          visibleSignals={visibleSignals}
          isMentor={isMentor}
          isAdvisor={isAdvisor}
          isReadOnly={isReadOnly}
          expertSlug={expertSlug}
          expandedId={expandedId}
          setExpandedId={setExpandedId}
          openInstruments={openInstruments}
          addBuySignalIds={addBuySignalIds}
          batchInfo={batchInfo}
          collapsedBatches={collapsedBatches}
          setCollapsedBatches={setCollapsedBatches}
          recalling={recalling}
          repushingId={repushingId}
          onRepush={handleRepush}
          onRecall={handleRecall}
          onEdit={(batchId) => navigate(`/admin/${expertSlug}/signals/edit/${batchId}`)}
          contentLabel={contentLabel}
          holdingSummary={holdingSummary}
          defaultCurrency={(expert as any)?.currency === 'USD' ? 'USD' : 'TWD'}
          defaultAssetClass={(expert as any)?.asset_class ?? null}
        />
      </div>
    </AdminLayout>
  );
};

export default AdminSignals;
