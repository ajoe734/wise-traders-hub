import { supabase } from '@/integrations/supabase/client';

export const PLAID_LINK_TOKEN_KEY = 'plaid_link_token';
export const PLAID_EXPERT_KEY = 'plaid_expert';

export async function brokerageCall<T = any>(action: string, expertId: string, extra: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('plaid-link', { body: { action, expert_id: expertId, ...extra } });
  if (error) {
    let detail: any = null;
    try { detail = await (error as any).context?.json?.(); } catch { /* ignore */ }
    throw new Error(detail?.code || detail?.error || error.message);
  }
  return data as T;
}

export function plaidRedirectUri(): string | undefined {
  const u = `${window.location.origin}/expert/plaid-callback`;
  return u.startsWith('https://') ? u : undefined;
}
