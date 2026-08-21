import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface SampleSelection {
  signal_id: string;
  source_field:
    | 'reason_summary'
    | 'reason_detail'
    | 'risk_notes'
    | 'learning_points'
    | 'overall_summary';
}

export interface SamplePreviewRow {
  signal_id: string;
  source_field: string;
  label: string;
  ok: boolean;
  fail_reason: string | null;
  masked_text: string;
  truncated: boolean;
}

export interface SampleStatus {
  week_start_taipei: string;
  status: string;
  mask_level: string;
  source_content_hash: string;
  source_drifted: boolean;
  approved_by: string | null;
  approved_at: string | null;
  section_count: number;
}

/** 後台：已核准範例狀態（含來源漂移偵測）。僅 company_admin 可呼叫。 */
export function useExpertSampleStatus(expertId?: string, enabled = true) {
  return useQuery<SampleStatus | null>({
    queryKey: ['expert-public-sample-status', expertId],
    enabled: !!expertId && enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_expert_public_sample_status', {
        _expert_id: expertId!,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : null;
      return (row as SampleStatus) ?? null;
    },
  });
}

export function useExpertSampleAdmin(expertId?: string) {
  const qc = useQueryClient();
  const [preview, setPreview] = useState<SamplePreviewRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['expert-public-sample-status', expertId] });
    qc.invalidateQueries({ queryKey: ['expert-public-sample'] });
  }, [qc, expertId]);

  const runPreview = useCallback(
    async (weekStart: string, selections: SampleSelection[]) => {
      if (!expertId) return null;
      setBusy(true);
      try {
        const { data, error } = await supabase.rpc('preview_expert_public_sample', {
          _expert_id: expertId,
          _week_start: weekStart,
          _selections: selections as unknown as never,
        });
        if (error) throw error;
        const rows = (data ?? []) as SamplePreviewRow[];
        setPreview(rows);
        return rows;
      } finally {
        setBusy(false);
      }
    },
    [expertId],
  );

  const approve = useCallback(
    async (weekStart: string, selections: SampleSelection[]) => {
      if (!expertId) return null;
      setBusy(true);
      try {
        const { data, error } = await supabase.rpc('approve_expert_public_sample', {
          _expert_id: expertId,
          _week_start: weekStart,
          _selections: selections as unknown as never,
        });
        if (error) throw error;
        invalidate();
        return data as string;
      } finally {
        setBusy(false);
      }
    },
    [expertId, invalidate],
  );

  const revoke = useCallback(async () => {
    if (!expertId) return 0;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('revoke_expert_public_sample', {
        _expert_id: expertId,
      });
      if (error) throw error;
      invalidate();
      return (data as number) ?? 0;
    } finally {
      setBusy(false);
    }
  }, [expertId, invalidate]);

  return { preview, setPreview, busy, runPreview, approve, revoke };
}

export const RPC_ERROR_LABEL: Record<string, string> = {
  not_authorized: '沒有權限（僅限公司管理員）',
  expert_not_active_mentor: '此老師不是啟用中的導師',
  week_not_closed: '該週尚未完整結束，不能公開',
  bad_selections: '選取格式錯誤',
  bad_selection_count: '請選取 2～4 個段落',
  bad_selection_item: '選取項目格式錯誤',
  bad_selection_keys: '選取項目欄位錯誤',
  bad_source_field: '不允許的來源欄位',
  bad_signal_id: '週記 ID 格式錯誤',
  duplicate_selection: '同一段落重複選取',
  signal_not_found: '找不到來源週記',
  cross_teacher_selection: '不可跨老師選取',
  signal_not_published: '來源週記尚未公開',
  signal_week_mismatch: '來源週記不屬於所選週次',
  redaction_gate_failed: '有段落未通過遮罩檢查，已中止',
  bad_section_count: '段落數量不符（需 2～4）',
  payload_too_large: '內容過長',
};

export function sampleRpcErrorMessage(e: unknown): string {
  const raw = (e as { message?: string })?.message ?? '';
  for (const [k, v] of Object.entries(RPC_ERROR_LABEL)) {
    if (raw.includes(k)) return v;
  }
  return raw || '操作失敗，請重試';
}
