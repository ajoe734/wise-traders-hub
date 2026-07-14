import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useExpertHoldingsBundle } from '@/hooks/useExpertHoldingsBundle';
import {
  emptyTrade, newUid,
  type CapitalStatus, type TradeDraft,
} from '@/pages/_signalEditor/types';

interface OpenPos {
  symbol: string;
  quantity: number;
  instrument: string;
}

interface UseSignalEditorDataArgs {
  expertSlug: string | undefined;
  editBatchId: string | undefined;
  isEditing: boolean;
  onBatchLoaded: (loaded: {
    teachingTopic: string;
    overallSummary: string;
    learningPoints: string;
    trades: TradeDraft[];
  }) => void;
  onMissingBatch: () => void;
}

/**
 * 集中處理 admin/SignalEditor 的非 form 資料。
 * Capital / openPositions 統一由 `useExpertHoldingsBundle` 提供 —
 * 禁止再直接讀 trade_records / RPC。
 */
export function useSignalEditorData(args: UseSignalEditorDataArgs) {
  const { expertSlug, editBatchId, isEditing, onBatchLoaded, onMissingBatch } = args;
  const [expert, setExpert] = useState<any>(null);
  const [signalTemplates, setSignalTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // 統一資料源
  const currency = (expert?.currency === 'USD' ? 'USD' : 'TWD') as 'TWD' | 'USD';
  const bundle = useExpertHoldingsBundle(expert?.id, {
    expertOwnerUserId: expert?.user_id ?? null,
    currency,
  });
  // 把 currency 注入 capital，下游 CapitalPanel 即可直接取
  const capital = bundle.capital
    ? ({ ...(bundle.capital as any), currency } as unknown as CapitalStatus)
    : null;
  const openPositions: OpenPos[] = (bundle.rawOpenPositions || []).map((p) => ({
    instrument: p.instrument,
    symbol: p.symbol || String(p.instrument || '').split(' ')[0],
    quantity: Number(p.quantity_shares ?? 0),
  }));

  const reloadCapital = useCallback(async () => {
    await bundle.refetch();
  }, [bundle]);

  // 首載：expert + 模板
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!expertSlug) return;
      setLoading(true);
      const { data: exp } = await supabase.from('experts').select('*').eq('slug', expertSlug).single();
      if (cancelled) return;
      setExpert(exp);
      if (exp) {
        const { data: tpl } = await supabase
          .from('expert_signal_templates' as any)
          .select('id, title, action, reason, risk_note, strategy_note')
          .eq('expert_id', exp.id)
          .order('sort_order', { ascending: true });
        if (cancelled) return;
        setSignalTemplates((tpl as any) || []);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [expertSlug]);

  // 編輯模式：載入既有 batch
  const onBatchLoadedRef = useRef(onBatchLoaded);
  const onMissingBatchRef = useRef(onMissingBatch);
  useEffect(() => { onBatchLoadedRef.current = onBatchLoaded; }, [onBatchLoaded]);
  useEffect(() => { onMissingBatchRef.current = onMissingBatch; }, [onMissingBatch]);

  useEffect(() => {
    if (!isEditing || !expert || !editBatchId) return;
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
        onMissingBatchRef.current();
        return;
      }
      const first: any = data[0];
      const trades: TradeDraft[] = data.map((row: any) => {
        const inst = String(row.instrument || '');
        const [code, ...rest] = inst.split(' ');
        const dt = row.executed_at ? new Date(row.executed_at) : new Date(row.published_at || Date.now());
        const pad = (n: number) => String(n).padStart(2, '0');
        return {
          uid: row.id || newUid(),
          executedAt: `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`,
          stockCode: code || '',
          stockName: rest.join(' '),
          action: (row.action || '') as any,
          priceHint: row.price_hint != null ? String(row.price_hint) : '',
          quantity: row.quantity != null ? String(row.quantity) : '',
          quantityUnit: (row.quantity_unit || '張') as '張' | '股',
          reasonSummary: row.reason_summary || '',
          reasonDetail: row.reason_detail || '',
          riskNotes: row.risk_notes || '',
        };
      });
      onBatchLoadedRef.current({
        teachingTopic: first.teaching_topic || '',
        overallSummary: first.overall_summary || '',
        learningPoints: first.learning_points || '',
        trades: trades.length > 0 ? trades : [emptyTrade()],
      });
    })();
    return () => { cancelled = true; };
  }, [isEditing, editBatchId, expert]);

  return {
    expert,
    signalTemplates,
    openPositions,
    capital,
    currency,
    loading: loading || bundle.loading,
    setCapital: (_v: any) => { /* deprecated — bundle 為單一來源 */ },
    reloadCapital,
  };
}
