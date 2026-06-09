import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { gtmPush } from '@/lib/analytics/gtm';

const DBG = '[LINE-CB]';

/**
 * LINE login callback.
 *
 * Flow (nonce):
 *   1. Server (line-login-callback) inserts {nonce, access_token, refresh_token}
 *      into line_login_nonces and redirects here with ?nonce=…&return_to=…
 *   2. We POST the nonce to `line-login-exchange-nonce`, which atomically deletes
 *      the row and returns the tokens. A pre-fetch (LINE IAB / iOS link preview)
 *      that consumed the nonce simply returns 410 — the real user retries.
 *   3. setSession() with the durable tokens, wait for the in-memory session, redirect.
 *
 * The old `token_hash` flow is rejected with a clear message so stale links
 * don't silently loop on verifyOtp.
 */
export default function LineCallback() {
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const nonce = searchParams.get('nonce');
    const legacyTokenHash = searchParams.get('token_hash');
    const returnToParam = searchParams.get('return_to');
    const returnToSession = sessionStorage.getItem('line_login_return_to');
    const returnTo = returnToParam || returnToSession || '/holding-checkup';
    const lineError = searchParams.get('line_error');
    const safeReturnTo = returnTo.startsWith('/') ? returnTo : '/holding-checkup';

    console.log(DBG, 'Callback mounted', {
      hasNonce: !!nonce,
      hasLegacyTokenHash: !!legacyTokenHash,
      returnToParam,
      returnToSession,
      resolvedReturnTo: safeReturnTo,
    });

    const waitForSession = async () => {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          console.log(DBG, `Session confirmed on attempt ${attempt + 1}`, {
            userId: session.user.id,
            email: session.user.email,
          });
          return session.user;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 150));
      }
      console.warn(DBG, 'Session polling exhausted');
      return null;
    };

    if (lineError) {
      console.error(DBG, 'LINE error param:', lineError);
      setError(`LINE 登入失敗：${lineError}`);
      return;
    }

    // Backwards-compat: old token_hash links from before the nonce rollout.
    if (!nonce && legacyTokenHash) {
      console.warn(DBG, 'Legacy token_hash link received; new flow expects nonce.');
      setError('登入連結已過期，請重新登入。');
      return;
    }

    if (!nonce) {
      console.error(DBG, 'Missing nonce in callback URL');
      setError('無效的登入連結，請重新登入。');
      return;
    }

    const run = async () => {
      try {
        console.log(DBG, 'Exchanging nonce…');
        const { data, error: invokeError } = await supabase.functions.invoke(
          'line-login-exchange-nonce',
          { body: { nonce } },
        );

        if (invokeError || !data?.access_token || !data?.refresh_token) {
          console.error(DBG, 'nonce exchange failed:', invokeError, data);
          setError('登入連結已使用或過期，請重新登入。');
          return;
        }

        const { error: setSessionError } = await supabase.auth.setSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
        });

        if (setSessionError) {
          console.error(DBG, 'setSession failed:', setSessionError);
          setError('建立登入狀態失敗，請重新登入。');
          return;
        }

        const ready = await waitForSession();
        sessionStorage.removeItem('line_login_return_to');

        if (!ready) {
          setError('登入狀態同步逾時，請重新登入。');
          return;
        }

        gtmPush('Login', { method: 'line' });
        console.log(DBG, `✅ Redirecting to: ${safeReturnTo}`);
        window.location.replace(safeReturnTo);
      } catch (e) {
        console.error(DBG, 'Exchange exception:', e);
        setError('登入過程發生錯誤，請重新登入。');
      }
    };

    run();
  }, [searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="text-center space-y-4 max-w-sm">
        {error ? (
          <>
            <p className="text-foreground">{error}</p>
            <Button
              onClick={() => window.location.replace('/auth/login')}
              variant="default"
            >
              重新登入
            </Button>
          </>
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
