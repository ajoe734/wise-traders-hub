import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useViewAs } from '@/contexts/ViewAsContext';

/**
 * /app/view-as?token=xxx
 * Exchanges a one-shot view-as token (issued by admin-view-as edge function)
 * for a session, stores it in ViewAsContext, then redirects to /app.
 *
 * Requires the admin to already be logged in (their JWT is sent automatically
 * with supabase.functions.invoke; the edge function verifies admin == issuer).
 */
export default function ViewAsEntry() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { setSession } = useViewAs();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = params.get('token');
    if (!token) { setError('缺少 token 參數'); return; }

    let cancelled = false;
    (async () => {
      const { data, error: invokeErr } = await supabase.functions.invoke('admin-view-as', {
        body: { action: 'resolve', token },
      });
      if (cancelled) return;
      if (invokeErr || (data as any)?.error) {
        const code = (data as any)?.error || invokeErr?.message || 'unknown';
        const map: Record<string, string> = {
          invalid_token: '無效的預覽連結',
          already_used: '此預覽連結已使用過，請重新從後台產生',
          expired: '預覽連結已過期，請重新產生',
          forbidden: '權限不足（非原發起管理員）',
          unauthorized: '請先以管理員身分登入後再開啟此連結',
          revoked: '預覽連結已被撤銷',
        };
        setError(map[code] || `無法載入預覽：${code}`);
        return;
      }
      setSession({
        adminUserId: (data as any).admin_user_id,
        targetUserId: (data as any).target_user_id,
        targetEmail: (data as any).target_email,
        targetDisplayName: (data as any).target_display_name,
        expiresAt: (data as any).expires_at,
      });
      const dest = params.get('to') || '/app';
      navigate(dest, { replace: true });
    })();
    return () => { cancelled = true; };
  }, [params, navigate, setSession]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md w-full text-center space-y-4">
        {error ? (
          <>
            <h1 className="text-lg font-medium text-destructive">無法開啟預覽</h1>
            <p className="text-sm text-muted-foreground">{error}</p>
            <button
              onClick={() => window.close()}
              className="text-sm text-primary underline underline-offset-4"
            >關閉視窗</button>
          </>
        ) : (
          <>
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto" />
            <p className="text-sm text-muted-foreground">正在載入會員視角...</p>
          </>
        )}
      </div>
    </div>
  );
}
