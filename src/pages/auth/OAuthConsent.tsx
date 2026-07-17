import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PortalLayout } from "@/components/layouts/PortalLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

// Local typed wrapper for the beta supabase.auth.oauth namespace.
type OAuthClient = { name?: string; redirect_uri?: string; scope?: string };
type AuthorizationDetails = {
  client?: OAuthClient;
  scope?: string;
  requested_scopes?: string[];
  redirect_url?: string;
  redirect_to?: string;
};
type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  approveAuthorization: (id: string) => Promise<{ data: { redirect_url?: string; redirect_to?: string } | null; error: { message: string } | null }>;
  denyAuthorization: (id: string) => Promise<{ data: { redirect_url?: string; redirect_to?: string } | null; error: { message: string } | null }>;
};
const oauth = (supabase.auth as unknown as { oauth: OAuthApi }).oauth;

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) {
        setError("缺少 authorization_id 參數，此連結無效。");
        return;
      }
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        // Preserve the FULL consent URL so login returns the user here.
        const next = window.location.pathname + window.location.search;
        sessionStorage.setItem("redirect_after_login", next);
        window.location.href = "/auth/login";
        return;
      }
      const { data, error } = await oauth.getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (error) {
        setError(error.message);
        return;
      }
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data);
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    const { data, error } = approve
      ? await oauth.approveAuthorization(authorizationId)
      : await oauth.denyAuthorization(authorizationId);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("授權伺服器沒有回傳跳轉網址。");
      return;
    }
    window.location.href = target;
  }

  const clientName = details?.client?.name ?? "外部應用程式";
  const scopeText = (details?.requested_scopes ?? details?.scope?.split(/\s+/) ?? []).filter(Boolean);

  return (
    <PortalLayout>
      <div className="container py-12 md:py-20">
        <div className="max-w-md mx-auto">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">授權 {clientName} 連接 Legendflow</CardTitle>
              <CardDescription>
                {clientName} 將能以你的身分呼叫本 App 已啟用的工具。此授權不會繞過 Legendflow 的權限與後端政策。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <div className="text-sm text-destructive border border-destructive/30 rounded p-3 bg-destructive/5">
                  無法載入此授權請求：{error}
                </div>
              )}
              {!error && !details && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> 載入中…
                </div>
              )}
              {details && (
                <>
                  {details.client?.redirect_uri && (
                    <div className="text-xs text-muted-foreground break-all">
                      跳轉網址：{details.client.redirect_uri}
                    </div>
                  )}
                  {scopeText.length > 0 && (
                    <ul className="text-sm list-disc pl-5 space-y-1">
                      {scopeText.map((s) => (
                        <li key={s}>{scopeLabel(s)}</li>
                      ))}
                    </ul>
                  )}
                  <div className="flex gap-2 pt-2">
                    <Button className="flex-1" disabled={busy} onClick={() => decide(true)}>
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "同意授權"}
                    </Button>
                    <Button variant="outline" className="flex-1" disabled={busy} onClick={() => decide(false)}>
                      取消連接
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PortalLayout>
  );
}

function scopeLabel(scope: string): string {
  switch (scope) {
    case "openid":
      return "確認你的登入身分";
    case "email":
      return "取得你的電子郵件";
    case "profile":
      return "取得你的基本個人資料";
    default:
      return `額外權限：${scope}`;
  }
}
