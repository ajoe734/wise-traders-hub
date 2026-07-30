// 共用: Expert AI 對話每日配額檢查
// 依 Asia/Taipei 每日 00:00 重置；跨所有導師合計。
import type { SupabaseClient } from './supabaseClients.ts';
import { isCompanyAdminWith } from './adminGuard.ts';


export const EXPERT_AI_DAILY_LIMIT = 30;

export interface ExpertAiQuota {
  limit: number;
  used: number;
  remaining: number;
  resets_at: string;
  unlimited?: boolean;
}

function taipeiDayBoundaries(now = new Date()) {
  const tpeMs = now.getTime() + 8 * 3600 * 1000;
  const tpe = new Date(tpeMs);
  const startTpe = Date.UTC(tpe.getUTCFullYear(), tpe.getUTCMonth(), tpe.getUTCDate());
  const startUtc = new Date(startTpe - 8 * 3600 * 1000);
  const endUtc = new Date(startUtc.getTime() + 24 * 3600 * 1000);
  return { startUtc, endUtc };
}

/**
 * 是否豁免（company_admin / 導師本人在自己頁面預覽時另外處理）。
 */
async function isAdmin(admin: SupabaseClient, uid: string): Promise<boolean> {
  const { data } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', uid)
    .eq('role', 'company_admin')
    .maybeSingle();
  return !!data;
}

export async function getExpertAiQuota(
  admin: SupabaseClient,
  uid: string,
  opts: { exemptExpertOwner?: boolean; expertOwnerId?: string | null } = {},
): Promise<ExpertAiQuota> {
  const { startUtc, endUtc } = taipeiDayBoundaries();
  const base: ExpertAiQuota = {
    limit: EXPERT_AI_DAILY_LIMIT,
    used: 0,
    remaining: EXPERT_AI_DAILY_LIMIT,
    resets_at: endUtc.toISOString(),
  };

  if (opts.exemptExpertOwner && opts.expertOwnerId && opts.expertOwnerId === uid) {
    return { ...base, unlimited: true, remaining: EXPERT_AI_DAILY_LIMIT };
  }
  if (await isAdmin(admin, uid)) {
    return { ...base, unlimited: true, remaining: EXPERT_AI_DAILY_LIMIT };
  }

  const { data: convs } = await admin
    .from('expert_ai_conversations')
    .select('id')
    .eq('user_id', uid);
  const ids = (convs || []).map((c: { id: string }) => c.id);
  if (!ids.length) return base;

  const { count } = await admin
    .from('expert_ai_messages')
    .select('id', { count: 'exact', head: true })
    .in('conversation_id', ids)
    .eq('role', 'user')
    .gte('created_at', startUtc.toISOString())
    .lt('created_at', endUtc.toISOString());

  const used = count ?? 0;
  return {
    ...base,
    used,
    remaining: Math.max(0, EXPERT_AI_DAILY_LIMIT - used),
  };
}
