// AUTH: public  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { serviceClient } from '../_shared/supabaseClients.ts';
import { getActionLabel } from '../_shared/signalAction.ts';
/**
 * share-og — Open Graph 友善的公開 HTML 預覽端點
 *
 * 為什麼存在：
 * - 站台是純 Vite SPA，無 SSR。/app/* 還是 ProtectedRoute，crawler 無認證 → 即使 SSR 也只看到登入頁。
 * - 因此社群（FB/LinkedIn/Slack/Line）貼出 in-app URL 不可能拿到正確 OG。
 * - 此 function 提供「分享專用 URL」：crawler 看到完整 OG/Twitter/JSON-LD，人類自動跳轉到實際頁。
 *
 * URL 模式（GET，公開無 JWT）：
 *   /share-og/signal/{id}
 *   /share-og/journal/{id}
 *   /share-og/expert/{slug}
 *   /share-og/plan/{slug}/{planId}
 *   /share-og/holding-checkup
 *   /share-og/pricing
 *   /share-og/experts
 *   /share-og/                 → 站台首頁 OG
 *
 * 行為：
 *   1. 解析 path 拿到 kind + params
 *   2. 用 service-role 從 DB 取「公開可分享」的欄位（不含敏感策略內容）
 *   3. 組 HTML：完整 OG/Twitter/JSON-LD + meta refresh 0.5s + JS replace 到實際 in-app URL
 *   4. crawler 看到 OG 馬上撈走；human 0.5s 後跳到 /app/...
 *
 * 安全：
 *   - 僅輸出 instrument 名/週次/專家公開資料，不含 entry/stop/target/週記內文。
 *   - 找不到資料 → 200 + 預設 OG（避免社群顯示 404 預覽崩壞）。
 */

const SITE = "https://legendflow.tw";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const OG_CARD_BASE = `${SUPABASE_URL}/functions/v1/og-card`;
const DEFAULT_OG_IMAGE = `${SITE}/og-image.svg`;
const DEFAULT_TITLE = "legendflow · 投顧分析師與實戰導師訂閱平台";
const DEFAULT_DESC = "legendflow（智富股市實戰學院）— 專業投顧分析師即時策略訂閱與實戰導師週記教學。";

const supabase = serviceClient();

interface OgData {
  title: string;
  description: string;
  canonical: string;       // 實際 in-app 路徑（人類跳轉目標）
  image: string;
  type: "website" | "article" | "profile";
  jsonLd?: Record<string, unknown>;
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}

// 標籤一律來自 _shared/signalAction.ts（單一資料源）


async function resolveSignal(id: string): Promise<OgData> {
  const { data } = await supabase
    .from("expert_signals")
    .select("id, instrument, action, created_at, published_at, experts:expert_id(name, slug, avatar_url)")
    .eq("id", id)
    .eq("status", "published")
    .maybeSingle();
  if (!data) return defaultData(`/app/signal/${id}`);
  const exp: any = data.experts;
  const act = data.action ? getActionLabel(String(data.action)) : "";
  const title = `${data.instrument} ${act}｜${exp?.name || "策略訊號"} | legendflow`;
  return {
    title,
    description: `${exp?.name || "投顧"}發布的 ${data.instrument} ${act}訊號。完整策略與風險說明請至 legendflow App。`,
    canonical: `/app/signal/${data.id}`,
    image: exp?.avatar_url || DEFAULT_OG_IMAGE,
    type: "article",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: title,
      author: exp?.name ? { "@type": "Person", name: exp.name } : undefined,
      datePublished: data.published_at || data.created_at,
    },
  };
}

async function resolveJournal(id: string): Promise<OgData> {
  const { data } = await supabase
    .from("expert_signals")
    .select("id, instrument, created_at, published_at, teaching_topic, experts:expert_id(name, slug, avatar_url)")
    .eq("id", id)
    .eq("status", "published")
    .maybeSingle();
  if (!data) return defaultData(`/app/journal/${id}`);
  const exp: any = data.experts;
  const topic = data.teaching_topic ? `｜${data.teaching_topic}` : "";
  const title = `${data.instrument}${topic}｜${exp?.name || "導師"}週記 | legendflow`;
  return {
    title,
    description: `${exp?.name || "實戰導師"}的 ${data.instrument} 週記覆盤、策略思路與市場觀察。`,
    canonical: `/app/journal/${data.id}`,
    image: exp?.avatar_url || DEFAULT_OG_IMAGE,
    type: "article",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: title,
      author: exp?.name ? { "@type": "Person", name: exp.name } : undefined,
      datePublished: data.published_at || data.created_at,
    },
  };
}

async function resolveExpert(slug: string): Promise<OgData> {
  const { data } = await supabase
    .from("experts")
    .select("name, slug, role, description, bio, avatar_url, strategy_name")
    .eq("slug", slug)
    .in("status", ["approved", "active"])
    .maybeSingle();
  if (!data) return defaultData(`/expert/${slug}`);
  const roleLabel = data.role === "mentor" ? "實戰導師" : "投顧分析師";
  const title = `${data.name}｜${roleLabel} | legendflow`;
  const desc =
    data.description?.slice(0, 140) ||
    data.bio?.slice(0, 140) ||
    (data.strategy_name ? `${data.name}｜${data.strategy_name}` : null) ||
    `${data.name} 的 legendflow 訂閱方案、績效與專業背景。`;
  return {
    title,
    description: desc,
    canonical: `/expert/${data.slug}`,
    image: `${OG_CARD_BASE}/expert/${encodeURIComponent(data.slug)}`,
    type: "profile",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Person",
      name: data.name,
      jobTitle: roleLabel,
      description: desc,
      image: data.avatar_url || undefined,
      url: `${SITE}/expert/${data.slug}`,
    },
  };
}

async function resolvePlan(slug: string, planId: string): Promise<OgData> {
  const { data: expert } = await supabase
    .from("experts")
    .select("id, name, slug, avatar_url, role")
    .eq("slug", slug)
    .maybeSingle();
  if (!expert) return defaultData(`/plan/${slug}/${planId}`);
  const { data: plan } = await supabase
    .from("expert_plans")
    .select("id, name, price_monthly, price_yearly, description")
    .eq("id", planId)
    .eq("expert_id", expert.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!plan) return defaultData(`/expert/${slug}`);
  const title = `${plan.name}｜${expert.name} | legendflow`;
  const priceTxt = plan.price_monthly
    ? `NT$${plan.price_monthly}／月`
    : plan.price_yearly
      ? `NT$${plan.price_yearly}／年`
      : "";
  const desc = plan.description?.slice(0, 140) ||
    `${expert.name} 的「${plan.name}」訂閱方案${priceTxt ? `，${priceTxt}` : ""}。`;
  return {
    title,
    description: desc,
    canonical: `/plan/${slug}/${planId}`,
    image: `${OG_CARD_BASE}/expert/${encodeURIComponent(slug)}`,
    type: "website",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Product",
      name: plan.name,
      description: desc,
      brand: { "@type": "Organization", name: "legendflow" },
      offers: {
        "@type": "Offer",
        priceCurrency: "TWD",
        price: plan.price_monthly || plan.price_yearly || 0,
        availability: "https://schema.org/InStock",
      },
    },
  };
}

function defaultData(canonical: string): OgData {
  return {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESC,
    canonical,
    image: DEFAULT_OG_IMAGE,
    type: "website",
  };
}

const STATIC_PAGES: Record<string, OgData> = {
  "": {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESC,
    canonical: "/",
    image: DEFAULT_OG_IMAGE,
    type: "website",
  },
  "experts": {
    title: "專家列表 | legendflow",
    description: "瀏覽 legendflow 全部投顧分析師與實戰導師，挑選適合的訂閱方案。",
    canonical: "/experts",
    image: DEFAULT_OG_IMAGE,
    type: "website",
  },
  "pricing": {
    title: "訂閱方案與價格 | legendflow",
    description: "legendflow 訂閱方案總覽：投顧即時策略訊號與實戰導師週記教學。",
    canonical: "/pricing",
    image: DEFAULT_OG_IMAGE,
    type: "website",
  },
  "holding-checkup": {
    title: "免費 AI 持倉診斷 | legendflow",
    description: "立即用 AI 診斷你的台股持倉：技術面、籌碼、財報與事件預測一次到位。",
    canonical: "/holding-checkup",
    image: DEFAULT_OG_IMAGE,
    type: "website",
  },
};

async function resolve(pathParts: string[]): Promise<OgData> {
  const [kind, ...rest] = pathParts;
  if (!kind) return STATIC_PAGES[""];
  if (STATIC_PAGES[kind]) return STATIC_PAGES[kind];
  if (kind === "signal" && rest[0]) return resolveSignal(rest[0]);
  if (kind === "journal" && rest[0]) return resolveJournal(rest[0]);
  if (kind === "expert" && rest[0]) return resolveExpert(rest[0]);
  if (kind === "plan" && rest[0] && rest[1]) return resolvePlan(rest[0], rest[1]);
  return defaultData("/");
}

function renderHtml(d: OgData): string {
  const fullUrl = `${SITE}${d.canonical.startsWith("/") ? d.canonical : `/${d.canonical}`}`;
  const ld = d.jsonLd
    ? `<script type="application/ld+json">${JSON.stringify(d.jsonLd)}</script>`
    : "";
  // 0.5s meta refresh + immediate JS replace。Crawler 不執行 JS / 不跟 meta refresh，看到 OG 就走。
  return `<!doctype html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>${escapeHtml(d.title)}</title>
<meta name="description" content="${escapeHtml(d.description)}" />
<link rel="canonical" href="${escapeHtml(fullUrl)}" />
<meta property="og:title" content="${escapeHtml(d.title)}" />
<meta property="og:description" content="${escapeHtml(d.description)}" />
<meta property="og:url" content="${escapeHtml(fullUrl)}" />
<meta property="og:type" content="${d.type}" />
<meta property="og:image" content="${escapeHtml(d.image)}" />
<meta property="og:site_name" content="legendflow" />
<meta property="og:locale" content="zh_TW" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeHtml(d.title)}" />
<meta name="twitter:description" content="${escapeHtml(d.description)}" />
<meta name="twitter:image" content="${escapeHtml(d.image)}" />
${ld}
<meta http-equiv="refresh" content="0.5;url=${escapeHtml(fullUrl)}" />
<style>body{font-family:'Noto Sans TC',sans-serif;margin:0;padding:48px 24px;background:#FAFAFA;color:#0B120E;text-align:center}h1{font-size:18px;font-weight:500;margin:0 0 8px}p{color:#838585;font-size:14px;margin:0}a{color:#EC662D;text-decoration:none;font-size:14px;display:inline-block;margin-top:24px}</style>
</head>
<body>
<h1>${escapeHtml(d.title)}</h1>
<p>正在前往 legendflow…</p>
<a href="${escapeHtml(fullUrl)}">若未自動跳轉，點此前往</a>
<script>window.location.replace(${JSON.stringify(fullUrl)});</script>
</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "content-type",
      },
    });
  }
  const url = new URL(req.url);
  // path = /share-og/{kind}/{...}; supabase routes function name as first segment
  // 容錯：去掉 /share-og 前綴與多餘 slash
  const raw = url.pathname.replace(/^\/+/, "").replace(/^share-og\/?/, "");
  const parts = raw.split("/").map(decodeURIComponent).filter(Boolean);
  let data: OgData;
  try {
    data = await resolve(parts);
  } catch (e) {
    console.error("[share-og] resolve failed", e);
    data = defaultData("/");
  }
  return new Response(renderHtml(data), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=600",
      "X-Robots-Tag": "noindex,nofollow",
      "Access-Control-Allow-Origin": "*",
    },
  });
});
