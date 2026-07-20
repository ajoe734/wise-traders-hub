// tw-ocr-replay/harvest.ts — 本機一次性用工具
// 從 TWSE BSR 抓 N 張新鮮 captcha PNG 存到 fixtures/unlabeled/，供人工標註後移入 labels.json。
// 用法：
//   deno run --allow-net --allow-write --allow-read \
//     supabase/functions/tw-ocr-replay/harvest.ts --count=20 --out=fixtures/unlabeled
//
// 標註流程：
//   1. 執行本工具，取得 unlabeled/*.png
//   2. 人眼辨識每張圖，將 { "unlabeled/xxxx.png": "AB12C" } 加到 fixtures/labels.json
//   3. 建議把已標註的圖 mv 到 fixtures/images/ 保持目錄整潔
import "https://deno.land/std@0.224.0/dotenv/load.ts";

const TWSE_CAPTCHA_URL = "https://bsr.twse.com.tw/bshtm/bsMenu.aspx";
const CAPTCHA_IMG_RE = /<img[^>]+id="Panel_bshtm"[\s\S]*?<img[^>]+src="([^"]+CaptchaImage[^"]+)"/i;
const FALLBACK_RE = /src="(CaptchaImage\.aspx[^"]+)"/i;

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const args = parseArgs(Deno.args);
const count = parseInt(args.count || "20", 10);
const outDir = args.out || new URL("./fixtures/unlabeled", import.meta.url).pathname;
const delay = parseInt(args.delay || "1500", 10);

await Deno.mkdir(outDir, { recursive: true });
console.error(`[harvest] ${count} captchas → ${outDir}`);

let ok = 0;
for (let i = 0; i < count; i++) {
  try {
    const menuRes = await fetch(TWSE_CAPTCHA_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!menuRes.ok) { console.error(`[harvest] menu HTTP ${menuRes.status}`); continue; }
    const html = await menuRes.text();
    const m = html.match(CAPTCHA_IMG_RE) || html.match(FALLBACK_RE);
    if (!m) { console.error(`[harvest] captcha 圖 URL 找不到，可能改版`); continue; }
    const imgUrl = new URL(m[1], TWSE_CAPTCHA_URL).toString();
    const cookies = menuRes.headers.get("set-cookie") || "";
    const imgRes = await fetch(imgUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        Referer: TWSE_CAPTCHA_URL,
        Cookie: cookies,
      },
    });
    if (!imgRes.ok) { console.error(`[harvest] img HTTP ${imgRes.status}`); continue; }
    const buf = new Uint8Array(await imgRes.arrayBuffer());
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = `${outDir}/captcha-${stamp}-${i.toString().padStart(3, "0")}.png`;
    await Deno.writeFile(file, buf);
    ok += 1;
    console.error(`[harvest] ${ok}/${count} → ${file}`);
  } catch (e) {
    console.error(`[harvest] err:`, (e as Error).message);
  }
  if (i < count - 1) await new Promise((r) => setTimeout(r, delay));
}
console.error(`[harvest] done: ${ok}/${count}`);
