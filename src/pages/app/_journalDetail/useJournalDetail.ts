import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useEffectiveUserId } from '@/hooks/useEffectiveUserId';
import { useSubscriptionTimeline } from '@/hooks/useSubscriptionTimeline';
import { usePreviewMode } from '@/hooks/usePreviewMode';
import { parseInstrument } from '@/lib/instrument';
import { resolveStockNames } from '@/lib/stockNameResolver';
import * as journalRepo from '@/lib/journalRepository';
import type { SignalDetail } from './types';

/**
 * 週記詳情的取數接縫：唯一對外握手（journalRepository + stock_names + 訂閱時間軸），
 * 頁面只消費回傳值，不再自己組查詢。
 */
export const fetchJournalBundle = (signalId: string, forceOwner: boolean) =>
  journalRepo.forOwnerPreview<SignalDetail>(supabase as any, { signalId, forceOwner });

export const useJournalDetail = (id: string | undefined, previewFlagFromUrl: boolean) => {
  const { user, hasRole } = useAuth();
  const { isPreview: isPreviewSession, previewSlug: previewSlugFromSession } = usePreviewMode();
  const forceOwner = isPreviewSession || previewFlagFromUrl || !!user?.expertSlug || hasRole('company_admin');

  const { data, isLoading: loading } = useQuery({
    queryKey: ['app-journal-detail', id, forceOwner, 'v2'],
    queryFn: () => fetchJournalBundle(id!, forceOwner),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    // 詳情頁的可見性同樣由 RLS（訂閱狀態）決定，續訂後必須重驗，
    // 否則會沿用付款前「查不到」的持久化結果。
    refetchOnMount: 'always',
    placeholderData: (prev) => prev,
  });

  const signal = data?.signal ?? null;
  const weekSignals = data?.weekSignals ?? [];

  const { userId: effectiveUserId } = useEffectiveUserId();
  const { data: timelines = [] } = useSubscriptionTimeline(
    effectiveUserId ?? undefined,
    signal?.expert_id ?? null,
  );
  const timeline = timelines[0] ?? null;

  // 名稱回填：若 instrument 只存了代號（例如 "00631L"）而沒有名稱，透過 stock_names
  // 補上人類可讀名稱。使用 batch 查詢一次抓齊本週所有缺名的代號。
  const [nameMap, setNameMap] = useState<Record<string, string>>({});
  useEffect(() => {
    const missingCodes = Array.from(new Set(
      (weekSignals || [])
        .map((s) => {
          const { code, name } = parseInstrument(s.instrument);
          return code && !name ? code : null;
        })
        .filter((c): c is string => !!c),
    ));
    if (missingCodes.length === 0) return;
    let cancelled = false;
    resolveStockNames(missingCodes)
      .then((map) => { if (!cancelled) setNameMap((prev) => ({ ...prev, ...map })); })
      .catch(() => { /* 靜默失敗：仍會顯示代號 */ });
    return () => { cancelled = true; };
  }, [weekSignals]);

  const showDiagnostics = isPreviewSession || previewFlagFromUrl || hasRole('company_admin') || !!user?.expertSlug;

  return {
    loading,
    signal,
    weekSignals,
    diagnostics: data?.diagnostics ?? null,
    topLevelError: data?.error ?? null,
    timeline,
    nameMap,
    effectiveUserId,
    isPreviewSession,
    previewSlugFromSession,
    forceOwner,
    showDiagnostics,
  };
};
