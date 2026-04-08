import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';

/**
 * Handles LINE login callback by exchanging token_hash for a real Supabase session,
 * then redirecting to the intended destination.
 */
export default function LineCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const tokenHash = searchParams.get('token_hash');
    const type = searchParams.get('type');
    const returnTo = searchParams.get('return_to') || '/free-checkup';
    const lineError = searchParams.get('line_error');

    if (lineError) {
      setError(`LINE 登入失敗：${lineError}`);
      setTimeout(() => navigate(returnTo, { replace: true }), 2000);
      return;
    }

    if (!tokenHash || type !== 'magiclink') {
      setError('無效的登入連結');
      setTimeout(() => navigate('/auth/login', { replace: true }), 2000);
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
          setTimeout(() => navigate(returnTo, { replace: true }), 2000);
          return;
        }

        // Session established — redirect to destination
        navigate(returnTo, { replace: true });
      } catch (e) {
        console.error('Token exchange error:', e);
        setError('登入過程發生錯誤');
        setTimeout(() => navigate(returnTo, { replace: true }), 2000);
      }
    };

    exchangeToken();
  }, [searchParams, navigate]);

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
