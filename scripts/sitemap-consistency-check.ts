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

const routeRegex = /<Route\s+path=(?:"|')([^"']+)(?:"|')\s+element=\{([^}]+)\}/g;
const realRoutes = new Set<string>();
const redirectRoutes = new Set<string>();
let m: RegExpExecArray | null;
while ((m = routeRegex.exec(appTsx)) !== null) {
  const path = m[1];
  const element = m[2];
  if (path.startsWith("*") || path.includes(":")) continue; // skip wildcards + dynamic
  if (/Navigate/.test(element) || /Redirect/.test(element)) {
    redirectRoutes.add(path);
    continue;
  }
  // gated routes — not for sitemap
  if (/ProtectedRoute/.test(element)) continue;
  realRoutes.add(path);
}

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
  if (!realRoutes.has(p)) {
    console.error(`✗ sitemap 列出不存在或受保護的路由: ${p}`);
    problems++;
  }
}

// 反向：建議公開且非 redirect 的 route 是否漏寫
for (const p of realRoutes) {
  if (sitemapPaths.has(p)) continue;
  // /auth/* 不該被索引（會員登入頁），靜默略過
  if (p.startsWith("/auth/")) continue;
  console.warn(`⚠ 公開路由未列在 sitemap: ${p}`);
}

if (problems > 0) {
  console.error(`\nFAIL: sitemap 一致性檢查發現 ${problems} 個問題。`);
  process.exit(1);
}
console.log(`✓ sitemap 一致性 OK（${sitemapPaths.size} entries vs ${realRoutes.size} routes）`);
