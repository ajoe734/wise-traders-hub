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
    const returnTo = searchParams.get('return_to') || '/free-checkup';
    const lineError = searchParams.get('line_error');

    if (lineError) {
      setError(`LINE 登入失敗：${lineError}`);
      setTimeout(() => window.location.replace(returnTo), 2000);
      return;
    }

    if (!tokenHash || type !== 'magiclink') {
      setError('無效的登入連結');
      setTimeout(() => window.location.replace('/auth/login'), 2000);
      return;
    }

    const exchangeToken = async () => {
      try {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: 'magiclink',
        });

        if (verifyError) {
          console.error('OTP verification failed:', verifyError);
          setError('登入驗證失敗，請重試');
          setTimeout(() => window.location.replace(returnTo), 2000);
          return;
        }

        // Full-page redirect so all auth contexts (AuthContext, CheckupModeContext)
        // reinitialize with the fresh session from storage
        window.location.replace(returnTo);
      } catch (e) {
        console.error('Token exchange error:', e);
        setError('登入過程發生錯誤');
        setTimeout(() => window.location.replace(returnTo), 2000);
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
