import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

const SESSION_KEY = "pending_remittance_checked";

// Paths where we should NOT auto-redirect (avoid trapping the user / breaking flows)
const SKIP_PREFIXES = [
  "/account/remittance",
  "/auth/",
  "/checkout/",
  "/app/checkout/",
  "/legal",
];

/**
 * After login, if the user has any remittance_orders with status='awaiting_info',
 * redirect them once per session to /account/remittance to remind them to fill in
 * the payer name and last-5 digits.
 */
export function PendingRemittanceGuard() {
  const { user, isAuthenticated, isLoading, hasRole } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const checkedRef = useRef(false);

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated || !user) {
      // Reset on logout so next login re-checks
      sessionStorage.removeItem(SESSION_KEY);
      checkedRef.current = false;
      return;
    }
    // Skip role-based admin/analyst users
    if (hasRole("company_admin") || user.expertSlug) return;
    // Already checked this session
    if (checkedRef.current) return;
    if (sessionStorage.getItem(SESSION_KEY) === user.id) return;
    // Skip on certain paths
    if (SKIP_PREFIXES.some((p) => location.pathname.startsWith(p))) return;

    checkedRef.current = true;
    (async () => {
      const { data, error } = await supabase
        .from("remittance_orders")
        .select("id")
        .eq("user_id", user.id)
        .eq("status", "awaiting_info")
        .limit(1);
      if (error) return;
      sessionStorage.setItem(SESSION_KEY, user.id);
      if (data && data.length > 0) {
        toast({
          title: "您有匯款訂單尚未補齊資料",
          description: "請補填匯款人姓名與轉出帳號末五碼，後台才能為您對帳開通。",
        });
        navigate("/account/remittance", { replace: true });
      }
    })();
  }, [isAuthenticated, isLoading, user, hasRole, navigate, location.pathname]);

  return null;
}
