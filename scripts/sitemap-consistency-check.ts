/**
 * Sitemap ↔ Route 一致性檢查（S10 follow-up）
 *
 * 規則：
 *   1. sitemap.xml 內每個 <loc> path，必須在 src/App.tsx 找到一個非 redirect 的 <Route path=...>。
 *   2. sitemap 不得包含 ProtectedRoute（subscriberOnly / requiredRole）或 Navigate 目標。
 *
 * 執行：bunx tsx scripts/sitemap-consistency-check.ts
 * Exit 1 表示不一致，CI 可掛此檢查。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SITE_URL = "https://legendflow.tw";

const appTsx = readFileSync(resolve("src/App.tsx"), "utf8");
const sitemap = readFileSync(resolve("public/sitemap.xml"), "utf8");

/** 不該被索引的路徑前綴（測試 harness、平台保留、會員區）。 */
const NON_INDEXABLE_PREFIXES = [
  "/e2e/",
  "/.lovable/",
  "/auth/",
  "/app",
  "/me",
  "/account/",
  "/company/",
  "/admin/",
  "/holding-checkup-demo",
];

const isNonIndexable = (p: string) => NON_INDEXABLE_PREFIXES.some((x) => p.startsWith(x));

const routeRegex = /<Route\s+path=(?:"|')([^"']+)(?:"|')\s+element=\{([^}]+)\}/g;
const realRoutes = new Set<string>();
const dynamicRoutes = new Set<string>(); // e.g. /expert/:slug
const redirectRoutes = new Set<string>();
let m: RegExpExecArray | null;
while ((m = routeRegex.exec(appTsx)) !== null) {
  const path = m[1];
  const element = m[2];
  if (path.startsWith("*")) continue;
  if (!path.startsWith("/")) continue; // skip nested children
  const KNOWN_REDIRECT_WRAPPERS =
    /(?:^|<)\s*(?:Navigate|LegacyFreeCheckupRedirect|LegacyMeRedirect|LegacyCheckoutRedirect|ShortExpertRedirect)\b/;
  if (KNOWN_REDIRECT_WRAPPERS.test(element)) {
    redirectRoutes.add(path);
    continue;
  }
  if (/ProtectedRoute/.test(element)) continue;
  if (path === "/overview") continue; // layout-only shell
  if (path.includes(":")) {
    dynamicRoutes.add(path);
    continue;
  }
  realRoutes.add(path);
}

/** 動態 route pattern（/expert/:slug）→ 可比對的正規表示式。 */
const dynamicMatchers = [...dynamicRoutes].map((pattern) => ({
  pattern,
  re: new RegExp(`^${pattern.replace(/:[^/]+/g, "[^/]+")}$`),
}));

const locRegex = /<loc>([^<]+)<\/loc>/g;
const sitemapPaths = new Set<string>();
while ((m = locRegex.exec(sitemap)) !== null) {
  const url = m[1].trim();
  if (!url.startsWith(SITE_URL)) {
    console.error(`✗ sitemap loc 非 ${SITE_URL} 起始: ${url}`);
    process.exitCode = 1;
    continue;
  }
  const path = url.slice(SITE_URL.length) || "/";
  sitemapPaths.add(path);
}

let problems = 0;
for (const p of sitemapPaths) {
  if (redirectRoutes.has(p)) {
    console.error(`✗ sitemap 列出 redirect 路由: ${p}（應指向實際目的地）`);
    problems++;
    continue;
  }
  if (isNonIndexable(p)) {
    console.error(`✗ sitemap 列出不該索引的路由: ${p}`);
    problems++;
    continue;
  }
  if (realRoutes.has(p)) continue;
  if (dynamicMatchers.some((d) => d.re.test(p))) continue; // 動態頁（/expert/:slug）
  console.error(`✗ sitemap 列出不存在或受保護的路由: ${p}`);
  problems++;
}

// 反向：公開且非 redirect 的靜態 route 必須列在 sitemap（A8 guard）
for (const p of realRoutes) {
  if (sitemapPaths.has(p)) continue;
  if (isNonIndexable(p)) continue;
  console.error(`✗ 公開路由未列在 sitemap: ${p}`);
  problems++;
}

// 動態頁至少要有一筆代表性 URL，否則 /expert/:slug 這類頁面完全不會被索引
for (const { pattern, re } of dynamicMatchers) {
  if (isNonIndexable(pattern)) continue;
  if (pattern.startsWith("/checkout") || pattern.startsWith("/plan/")) continue; // 交易頁不索引
  if ([...sitemapPaths].some((p) => re.test(p))) continue;
  console.error(`✗ 動態公開路由在 sitemap 沒有任何實例: ${pattern}`);
  problems++;
}

if (problems > 0) {
  console.error(`\nFAIL: sitemap 一致性檢查發現 ${problems} 個問題。`);
  process.exit(1);
}
console.log(
  `✓ sitemap 一致性 OK（${sitemapPaths.size} entries / ${realRoutes.size} 靜態公開路由 / ${dynamicMatchers.length} 動態 pattern）`,
);

