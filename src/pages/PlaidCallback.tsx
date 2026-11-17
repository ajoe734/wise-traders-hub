import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlaidLink } from 'react-plaid-link';
import { supabase } from '@/integrations/supabase/client';
import { brokerageCall, PLAID_LINK_TOKEN_KEY, PLAID_EXPERT_KEY } from '@/lib/plaid/brokerageApi';
import { toast } from 'sonner';

/** OAuth return page registered in Plaid: resumes Link with the stored link_token. */
export default function PlaidCallback() {
  const navigate = useNavigate();
  const token = sessionStorage.getItem(PLAID_LINK_TOKEN_KEY);
  const slug = sessionStorage.getItem(PLAID_EXPERT_KEY) || '';
  const back = () => navigate(slug ? `/admin/${slug}/brokerage` : '/', { replace: true });

  const onSuccess = useCallback(async (public_token: string, metadata: any) => {
    sessionStorage.removeItem(PLAID_LINK_TOKEN_KEY);
    try {
      const { data: ex } = await supabase.from('experts').select('id').eq('slug', slug).maybeSingle();
      if (!ex) throw new Error('expert_not_found');
      await brokerageCall('exchange', ex.id, { public_token, institution: metadata?.institution });
      toast.success('已連結 Firstrade');
    } catch (e: any) { toast.error(`連結失敗：${e.message}`); }
    back();
  }, [slug]);

  const { open, ready } = usePlaidLink({ token, onSuccess, onExit: back, receivedRedirectUri: window.location.href });
  useEffect(() => { if (!token) back(); else if (ready) open(); }, [token, ready, open]);
  return <div className="min-h-screen flex items-center justify-center text-muted-foreground">正在返回券商連結…</div>;
}
