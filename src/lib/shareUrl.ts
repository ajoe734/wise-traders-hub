/**
 * Share URL helper — 把 in-app 路徑轉成可公開分享的「OG 友善」URL。
 *
 * 設計：
 * - 公開頁面（/expert/:slug、/experts、/pricing、/holding-checkup、首頁）
 *   直接回 `https://legendflow.tw/...` canonical URL。IG/FB/Line 對自有網域信任度高，
 *   不會像 supabase.co 端點被標記為可疑外連結。
 * - ProtectedRoute 內的頁面（signal/journal/plan）仍走 share-og edge function，
 *   讓 crawler 拿到 OG 卡，人類自動跳轉到 /app/* 受保護頁。
 */

import { functionUrl } from "@/lib/supabaseEndpoint";

const SUPABASE_FN_BASE = functionUrl("share-og");
const SITE = "https://legendflow.tw";

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
    // ── 公開頁面：直接用 legendflow.tw canonical（IG 友善、品牌一致） ──
    case "expert":
      return `${SITE}/expert/${encodeURIComponent(t.slug)}`;
    case "experts":
      return `${SITE}/experts`;
    case "pricing":
      return `${SITE}/pricing`;
    case "holding-checkup":
      return `${SITE}/holding-checkup`;
    case "home":
      return `${SITE}/`;
    // ── ProtectedRoute：走 share-og crawler 跳板 ──
    case "signal":
      return `${SUPABASE_FN_BASE}/signal/${encodeURIComponent(t.id)}`;
    case "journal":
      return `${SUPABASE_FN_BASE}/journal/${encodeURIComponent(t.id)}`;
    case "plan":
      return `${SUPABASE_FN_BASE}/plan/${encodeURIComponent(t.slug)}/${encodeURIComponent(t.planId)}`;
    default:
      return `${SITE}/`;
  }
}

/** 取得「短連結」版（適合 IG bio）。目前僅 expert 有短碼 /s/:slug。 */
export function buildShortShareUrl(t: ShareTarget): string {
  if (t.kind === "expert") return `${SITE}/s/${encodeURIComponent(t.slug)}`;
  return buildShareUrl(t);
}

/** 取得 og-card 預覽圖 URL（PNG/SVG，可放 og:image）。 */
export function buildOgCardUrl(t: ShareTarget): string {
  if (t.kind === "expert") {
    return `${SUPABASE_URL}/functions/v1/og-card/expert/${encodeURIComponent(t.slug)}`;
  }
  return `${SITE}/og-image.svg`;
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
