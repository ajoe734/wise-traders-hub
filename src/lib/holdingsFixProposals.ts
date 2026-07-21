import { supabase } from '@/integrations/supabase/client';

export type FixProposalStatus = 'pending' | 'applied' | 'rejected' | 'superseded' | 'failed';
export type ProposedAction =
  | 'normalize_unit'
  | 'adjust_trade_quantity'
  | 'close_trade_record'
  | 'create_trade_record'
  | 'delete_orphan_signal'
  | 'cancel_signal'
  | 'manual_review';

export type FixProposal = {
  id: string;
  drift_category: string;
  expert_id: string | null;
  expert_slug: string | null;
  expert_name: string | null;
  symbol: string | null;
  instrument: string | null;
  severity: 'high' | 'medium' | 'low';
  summary: string;
  proposed_action: ProposedAction;
  payload: Record<string, any>;
  preview: Record<string, any>;
  status: FixProposalStatus;
  generated_at: string;
  reviewed_at: string | null;
  review_note: string | null;
  applied_at: string | null;
  apply_result: Record<string, any> | null;
};

export async function generateFixProposals(category?: string) {
  const { data, error } = await supabase.rpc('admin_generate_fix_proposals' as any, {
    p_category: category ?? null,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as { inserted: number; superseded: number; total_pending: number };
}

export async function listFixProposals(status?: FixProposalStatus) {
  let q = supabase.from('holdings_fix_proposals' as any).select('*')
    .order('severity', { ascending: true })
    .order('generated_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as FixProposal[];
}

export async function applyFixProposal(id: string) {
  const { data, error } = await supabase.rpc('admin_apply_fix_proposal' as any, {
    p_id: id, p_confirm: true,
  });
  if (error) throw error;
  return data as Record<string, any>;
}

export async function rejectFixProposal(id: string, note?: string) {
  const { error } = await supabase.rpc('admin_reject_fix_proposal' as any, {
    p_id: id, p_note: note ?? null,
  });
  if (error) throw error;
}
