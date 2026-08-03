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
        // 弱網 / LINE in-app browser 冷啟動時第一次 invoke 常直接拋網路錯誤，
        // 這種「還沒碰到 nonce」的失敗要重試，否則使用者會被誤判為連結過期。
        let data: any = null;
        let invokeError: any = null;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          const res = await supabase.functions.invoke('line-login-exchange-nonce', { body: { nonce } });
          data = res.data;
          invokeError = res.error;
          if (!invokeError && data?.access_token && data?.refresh_token) break;
          // 410（已使用／過期）不重試；只重試傳輸層失敗。
          const status = (invokeError as any)?.context?.status;
          if (status === 410 || status === 400) break;
          console.warn(DBG, `nonce exchange attempt ${attempt} failed`, invokeError);
          if (attempt < 3) await new Promise((r) => window.setTimeout(r, attempt * 600));
        }

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

        const sessionUser = await waitForSession();
        sessionStorage.removeItem('line_login_return_to');

        if (!sessionUser) {
          setError('登入狀態同步逾時，請重新登入。');
          return;
        }

        // Detect new LINE signup: created_at and last_sign_in_at within 60s
        // means this is the first sign-in (account just provisioned).
        try {
          const createdAt = sessionUser.created_at ? new Date(sessionUser.created_at).getTime() : 0;
          const lastSignIn = (sessionUser as any).last_sign_in_at
            ? new Date((sessionUser as any).last_sign_in_at).getTime()
            : createdAt;
          const isNewUser = createdAt && Math.abs(lastSignIn - createdAt) < 60_000;
          if (isNewUser) gtmPush('SignUp', { method: 'line' });
        } catch (e) {
          console.warn(DBG, 'new-user detection failed', e);
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
