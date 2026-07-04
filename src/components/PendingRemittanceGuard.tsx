import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useEffectiveUserId } from "@/hooks/useEffectiveUserId";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

const STORAGE_KEY = "pending_remittance_last_shown";
// 每 30 分鐘再提醒一次（原本是「一個 session 只提醒一次」，改用 localStorage 跨 tab/reload 共享）
const REMIND_INTERVAL_MS = 30 * 60 * 1000;

// Paths where we should NOT remind (avoid noise during these flows)
const SKIP_PREFIXES = [
  "/account/remittance",
  "/auth/",
  "/checkout/",
  "/app/checkout/",
  "/legal",
];

/**
 * After login, if the user has any remittance_orders with status='awaiting_info',
 * show a non-blocking toast with an action button to navigate to /account/remittance.
 * We DO NOT force-redirect — the user can keep using the app and come back later
 * via the toast, the Profile page entry, or the banner on /app/account.
 */
export function PendingRemittanceGuard() {
  const { user, isAuthenticated, isLoading, hasRole } = useAuth();
  const { userId: effectiveUserId, isViewAs } = useEffectiveUserId();
  const navigate = useNavigate();
  const location = useLocation();
  const checkedRef = useRef(false);

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated || !user) {
      localStorage.removeItem(STORAGE_KEY);
      checkedRef.current = false;
      return;
    }
    if (hasRole("company_admin") && !isViewAs) return;
    if (user.expertSlug && !isViewAs) return;

    // B-27：在 /account/remittance 頁清掉 dedupe key，使用者離開後若仍有待補單會再次提醒。
    if (location.pathname.startsWith("/account/remittance")) {
      localStorage.removeItem(STORAGE_KEY);
      checkedRef.current = false;
      return;
    }
    if (SKIP_PREFIXES.some((p) => location.pathname.startsWith(p))) return;
    if (checkedRef.current) return;
    const dedupeKey = effectiveUserId ?? user.id;
    // 每 30 分鐘一次：讀 localStorage.{userId, lastShownAt}，未過期則跳過
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { userId?: string; lastShownAt?: number };
        if (parsed?.userId === dedupeKey && typeof parsed.lastShownAt === "number"
            && Date.now() - parsed.lastShownAt < REMIND_INTERVAL_MS) {
          return;
        }
      }
    } catch { /* ignore malformed */ }

    checkedRef.current = true;
    (async () => {
      if (!effectiveUserId) return;
      const { data, error } = await supabase
        .from("remittance_orders")
        .select("id")
        .eq("user_id", effectiveUserId)
        .eq("status", "awaiting_info")
        .limit(1);
      if (error) return;
      // 不論有無資料都寫入時間戳，避免每次路由變動都重打 DB；30 分鐘後才會再檢查
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ userId: dedupeKey, lastShownAt: Date.now() }));
      if (data && data.length > 0) {
        toast({
          title: "您有匯款訂單尚未補齊資料",
          description: "請補填匯款人姓名與轉出帳號末五碼，後台才能為您對帳開通。",
          duration: 10000,
          action: (
            <button
              onClick={() => navigate("/account/remittance", { state: { from: { pathname: location.pathname, search: location.search } } })}
              className="text-xs font-medium underline-offset-2 hover:underline"
            >
              前往補填
            </button>
          ) as any,
        });
      }
    })();
  }, [isAuthenticated, isLoading, user, hasRole, navigate, location.pathname, effectiveUserId, isViewAs]);

  return null;
}
