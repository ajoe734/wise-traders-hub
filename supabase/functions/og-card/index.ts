// AUTH: public  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { serviceClient } from '../_shared/supabaseClients.ts';
/**
 * og-card — 動態品牌化 OG 預覽卡（SVG）。
 *
 * 為什麼存在：
 * - 公開分享 legendflow.tw/expert/{slug} 時，社群預覽卡需要顯示「legendflow logo +
 *   老師頭像 + 名字 + 角色 + 一句話描述」，而非只是頭像。
 * - 站台已使用 SVG og:image（index.html → /og-image.svg），所以此端點同樣回 SVG，
 *   crawler 行為一致。Twitter / Slack / Telegram / LINE 都支援 SVG og:image。
 *   FB/IG 不支援 SVG 預覽，但無 og:image 時會 fallback 到 index.html，仍能顯示品牌卡。
 *
 * URL：
 *   GET /og-card/expert/{slug}  → image/svg+xml, 1200×630
 *
 * 公開無 JWT；找不到專家時回預設 legendflow 卡（避免 404 破壞預覽）。
 */

const W = 1200;
const H = 630;
const BRAND_ORANGE = "#EC662D";
const BG = "#FAF8F4";
const INK = "#0B120E";
const SUB = "#5A5550";

const supabase = serviceClient();

function escapeXml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!),
  );
}

/** Truncate by visual width (CJK = 2, ASCII = 1). */
function clip(s: string, maxUnits: number): string {
  let units = 0;
  let out = "";
  for (const ch of String(s ?? "")) {
    const w = /[\u3000-\u9FFF\uFF00-\uFFEF]/.test(ch) ? 2 : 1;
    if (units + w > maxUnits) {
      out += "…";
      break;
    }
    units += w;
    out += ch;
  }
  return out;
}

interface ExpertCard {
  name: string;
  roleLabel: string;
  desc: string;
  avatarUrl: string | null;
  strategy: string;
}

async function fetchExpert(slug: string): Promise<ExpertCard | null> {
  const { data } = await supabase
    .from("experts")
    .select("name, role, description, bio, avatar_url, strategy_name")
    .eq("slug", slug)
    .in("status", ["approved", "active"])
    .maybeSingle();
  if (!data) return null;
  return {
    name: data.name || "legendflow",
    roleLabel: data.role === "mentor" ? "實戰導師" : "投顧分析師",
    desc: (data.description || data.bio || "").trim(),
    avatarUrl: data.avatar_url || null,
    strategy: data.strategy_name || "",
  };
}

function renderExpertSvg(c: ExpertCard): string {
  const name = clip(c.name, 18);
  const desc = clip(c.desc || c.strategy || "策略內容、訂閱方案請至 legendflow.tw", 48);
  const avatar = c.avatarUrl
    ? `<image href="${escapeXml(c.avatarUrl)}" x="80" y="195" width="240" height="240" clip-path="url(#circle)" preserveAspectRatio="xMidYMid slice"/>`
    : `<circle cx="200" cy="315" r="120" fill="${BRAND_ORANGE}" opacity="0.15"/>
       <text x="200" y="345" font-size="120" text-anchor="middle" fill="${BRAND_ORANGE}" font-weight="700">${escapeXml((name[0] || "L"))}</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="'PingFang TC','Noto Sans TC','Microsoft JhengHei','Source Han Sans TC','Source Serif 4',serif">
  <defs>
    <clipPath id="circle"><circle cx="200" cy="315" r="120"/></clipPath>
  </defs>

  <!-- BG -->
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <!-- Brand stripe -->
  <rect x="0" y="0" width="${W}" height="8" fill="${BRAND_ORANGE}"/>

  <!-- Logo / wordmark -->
  <g transform="translate(80, 78)">
    <text x="0" y="0" font-size="44" font-weight="700" fill="${INK}" letter-spacing="-1">legendflow</text>
    <circle cx="290" cy="-12" r="9" fill="${BRAND_ORANGE}"/>
    <text x="0" y="36" font-size="18" fill="${SUB}" letter-spacing="2">投顧與導師訂閱平台</text>
  </g>

  <!-- Avatar -->
  ${avatar}
  <circle cx="200" cy="315" r="120" fill="none" stroke="${BRAND_ORANGE}" stroke-width="4" opacity="0.5"/>

  <!-- Expert info -->
  <g transform="translate(380, 230)">
    <rect x="0" y="0" width="120" height="34" rx="17" fill="${BRAND_ORANGE}" opacity="0.12"/>
    <text x="60" y="23" font-size="18" font-weight="600" fill="${BRAND_ORANGE}" text-anchor="middle">${escapeXml(c.roleLabel)}</text>

    <text x="0" y="100" font-size="64" font-weight="700" fill="${INK}">${escapeXml(name)}</text>

    <foreignObject x="0" y="130" width="720" height="180">
      <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:'PingFang TC','Noto Sans TC','Microsoft JhengHei',sans-serif;font-size:26px;line-height:1.55;color:${SUB};">
        ${escapeXml(desc)}
      </div>
    </foreignObject>
  </g>

  <!-- Footer -->
  <g transform="translate(80, ${H - 60})">
    <text x="0" y="0" font-size="20" fill="${SUB}">legendflow.tw</text>
    <text x="${W - 160}" y="0" font-size="18" fill="${SUB}" text-anchor="end">立即查看訂閱方案 →</text>
  </g>
</svg>`;
}

function renderDefaultSvg(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <rect x="0" y="0" width="${W}" height="8" fill="${BRAND_ORANGE}"/>
  <g transform="translate(80, 280)" font-family="'PingFang TC','Noto Sans TC',sans-serif">
    <text x="0" y="0" font-size="72" font-weight="700" fill="${INK}">legendflow</text>
    <circle cx="430" cy="-22" r="14" fill="${BRAND_ORANGE}"/>
    <text x="0" y="56" font-size="28" fill="${SUB}">投顧分析師與實戰導師訂閱平台</text>
  </g>
</svg>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    });
  }
  try {
    const url = new URL(req.url);
    const raw = url.pathname.replace(/^\/+/, "").replace(/^og-card\/?/, "");
    const parts = raw.split("/").map(decodeURIComponent).filter(Boolean);
    let svg = renderDefaultSvg();
    if (parts[0] === "expert" && parts[1]) {
      const c = await fetchExpert(parts[1]);
      if (c) svg = renderExpertSvg(c);
    }
    return new Response(svg, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    console.error("[og-card] error", e);
    return new Response(renderDefaultSvg(), {
      status: 200,
      headers: { "Content-Type": "image/svg+xml; charset=utf-8" },
    });
  }
});
