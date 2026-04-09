import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';

/**
 * Handles LINE login callback by exchanging token_hash for a real Supabase session,
 * then doing a full-page redirect so all auth contexts reinitialize cleanly.
 */
export default function LineCallback() {
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const tokenHash = searchParams.get('token_hash');
    const type = searchParams.get('type');
    const returnTo = searchParams.get('return_to') || sessionStorage.getItem('line_login_return_to') || '/free-checkup';
    const lineError = searchParams.get('line_error');
    const safeReturnTo = returnTo.startsWith('/') ? returnTo : '/free-checkup';

    const waitForSession = async () => {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          return true;
        }

        await new Promise((resolve) => window.setTimeout(resolve, 150));
      }

      return false;
    };

    if (lineError) {
      setError(`LINE 登入失敗：${lineError}`);
      setTimeout(() => window.location.replace(safeReturnTo), 2000);
      return;
    }

    if (!tokenHash || type !== 'magiclink') {
      setError('無效的登入連結');
      setTimeout(() => window.location.replace('/auth/login'), 2000);
      return;
    }

    const exchangeToken = async () => {
      try {
        const { data, error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: 'magiclink',
        });

        if (verifyError) {
          console.error('OTP verification failed:', verifyError);
          setError('登入驗證失敗，請重試');
          setTimeout(() => window.location.replace(safeReturnTo), 2000);
          return;
        }

        if (data.session?.access_token && data.session?.refresh_token) {
          const { error: setSessionError } = await supabase.auth.setSession({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
          });

          if (setSessionError) {
            console.error('Session persistence failed:', setSessionError);
          }
        }

        const sessionReady = await waitForSession();
        sessionStorage.removeItem('line_login_return_to');

        if (!sessionReady) {
          setError('登入狀態同步逾時，請重試');
          setTimeout(() => window.location.replace(safeReturnTo), 1500);
          return;
        }

        // Full-page redirect so all auth contexts (AuthContext, CheckupModeContext)
        // reinitialize with the fresh session from storage
        window.location.replace(safeReturnTo);
      } catch (e) {
        console.error('Token exchange error:', e);
        setError('登入過程發生錯誤');
        setTimeout(() => window.location.replace(safeReturnTo), 2000);
      }
    };

    exchangeToken();
  }, [searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4">
        {error ? (
          <p className="text-destructive">{error}</p>
        ) : (
          <>
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
            <p className="text-muted-foreground">正在完成 LINE 登入...</p>
          </>
        )}
      </div>
    </div>
  );
}
