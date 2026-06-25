import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

/**
 * Admin-side helper: ask the edge function for a one-shot view-as token, then
 * open `/app/view-as?token=...` in a new tab. The token is consumed on resolve,
 * so even if it leaks from the URL bar it can only be used once.
 */
export async function launchViewAs(targetUserId: string, opts?: { to?: string }) {
  const { data, error } = await supabase.functions.invoke('admin-view-as', {
    body: { action: 'issue', target_user_id: targetUserId },
  });
  if (error || (data as any)?.error) {
    const code = (data as any)?.error || error?.message || '未知錯誤';
    toast({
      title: '無法產生預覽連結',
      description: code === 'forbidden' ? '僅平台管理員可使用此功能' : code,
      variant: 'destructive',
    });
    return;
  }
  const token = (data as any)?.token;
  if (!token) {
    toast({ title: '無法產生預覽連結', description: '回應未包含 token', variant: 'destructive' });
    return;
  }
  const url = `${window.location.origin}/app/view-as?token=${encodeURIComponent(token)}${opts?.to ? `&to=${encodeURIComponent(opts.to)}` : ''}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}
