/**
 * Share URL helper — 把 in-app 路徑轉成可公開分享的「OG 友善」URL。
 *
 * 為什麼需要：legendflow 是純 SPA + ProtectedRoute，社群 crawler 貼 /app/signal/xxx
 * 只會看到 index.html 預設 OG（拿不到該 signal 的具體標題/作者/圖）。
 * `share-og` edge function 提供公開預覽，crawler 看 OG / 人類自動跳轉回 in-app URL。
 *
 * 用法：
 *   import { buildShareUrl } from "@/lib/shareUrl";
 *   const url = buildShareUrl({ kind: "signal", id });
 *   navigator.clipboard.writeText(url);
 */

const SUPABASE_FN_BASE =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "")
    ? `${(import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "")}/functions/v1/share-og`
    : "https://yqacmrgdjlenbijclngi.supabase.co/functions/v1/share-og";

export type ShareTarget =
  | { kind: "signal"; id: string }
  | { kind: "journal"; id: string }
  | { kind: "expert"; slug: string }
  | { kind: "plan"; slug: string; planId: string }
  | { kind: "experts" }
  | { kind: "pricing" }
  | { kind: "holding-checkup" }
  | { kind: "home" };

export function buildShareUrl(t: ShareTarget): string {
  switch (t.kind) {
    case "signal":
      return `${SUPABASE_FN_BASE}/signal/${encodeURIComponent(t.id)}`;
    case "journal":
      return `${SUPABASE_FN_BASE}/journal/${encodeURIComponent(t.id)}`;
    case "expert":
      return `${SUPABASE_FN_BASE}/expert/${encodeURIComponent(t.slug)}`;
    case "plan":
      return `${SUPABASE_FN_BASE}/plan/${encodeURIComponent(t.slug)}/${encodeURIComponent(t.planId)}`;
    case "experts":
      return `${SUPABASE_FN_BASE}/experts`;
    case "pricing":
      return `${SUPABASE_FN_BASE}/pricing`;
    case "holding-checkup":
      return `${SUPABASE_FN_BASE}/holding-checkup`;
    case "home":
    default:
      return `${SUPABASE_FN_BASE}/`;
  }
}

/** 一鍵複製到剪貼簿；回傳是否成功。 */
export async function copyShareUrl(t: ShareTarget): Promise<boolean> {
  const url = buildShareUrl(t);
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}
