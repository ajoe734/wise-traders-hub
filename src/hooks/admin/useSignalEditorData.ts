import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
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
  /** 載入到既有 batch 後注入到表單 state */
  onBatchLoaded: (loaded: {
    teachingTopic: string;
    overallSummary: string;
    learningPoints: string;
    trades: TradeDraft[];
  }) => void;
  /** 找不到 batch 時的轉導 */
  onMissingBatch: () => void;
}

/**
 * 集中處理 admin/SignalEditor 的非 form 資料：
 * - expert / signalTemplates / openPositions / capital 首載
 * - 編輯模式下 batch 的回填（外部把資料注入 form state）
 * - reloadCapital helper
 */
export function useSignalEditorData(args: UseSignalEditorDataArgs) {
  const { expertSlug, editBatchId, isEditing, onBatchLoaded, onMissingBatch } = args;
  const [expert, setExpert] = useState<any>(null);
  const [signalTemplates, setSignalTemplates] = useState<any[]>([]);
  const [openPositions, setOpenPositions] = useState<OpenPos[]>([]);
  const [capital, setCapital] = useState<CapitalStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const reloadCapital = useCallback(async (eid: string) => {
    const { data } = await supabase.rpc('get_expert_capital_status' as any, { _expert_id: eid });
    if (data) setCapital(data as unknown as CapitalStatus);
  }, []);

  // 首載：expert + 模板 + 持倉 + 資金狀態
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

  // Realtime：trade_records / current_prices 變動 → reload capital，保持與績效總覽同步
  const reloadCapitalRef = useRef(reloadCapital);
  useEffect(() => { reloadCapitalRef.current = reloadCapital; }, [reloadCapital]);

  useEffect(() => {
    const eid = expert?.id;
    if (!eid) return;
    const tradeChannel = supabase
      .channel(`signal-editor-trade-records-${eid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trade_records', filter: `expert_id=eq.${eid}` },
        () => { reloadCapitalRef.current(eid); },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(tradeChannel);
    };
  }, [expert?.id]);

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
      // 確保至少一筆，避免後續 UI 對空陣列的假設失靈
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
    loading,
    setCapital,
    reloadCapital,
  };
}
