// tw-ocr-replay/cli.ts — 本機 / CI 用的 CLI 入口
// 用法：
//   deno run --allow-read --allow-env --allow-net supabase/functions/tw-ocr-replay/cli.ts \
//     --dir=supabase/functions/tw-ocr-replay/fixtures \
//     --out=/tmp/ocr-replay-report.json \
//     --markdown=/tmp/ocr-replay-report.md
//
// 需要環境變數 LOVABLE_API_KEY（可寫在專案根目錄 .env）。
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { runReplay, loadFixturesFromDir, type ReplayReport } from "./replay.ts";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
    else if (a.startsWith("--")) out[a.slice(2)] = "true";
  }
  return out;
}

const args = parseArgs(Deno.args);
const dir = args.dir || new URL("./fixtures", import.meta.url).pathname;
const outJson = args.out || "";
const outMd = args.markdown || "";
const delay = parseInt(args.delay || "300", 10);
const minFixtures = parseInt(args["min-fixtures"] || "1", 10);
const failOnRegression = args["fail-on-regression"] !== "false";

if (!Deno.env.get("LOVABLE_API_KEY")) {
  console.error("[replay] LOVABLE_API_KEY 未設定，無法呼叫 AI Gateway");
  Deno.exit(2);
}

console.error(`[replay] fixtures dir: ${dir}`);
const samples = await loadFixturesFromDir(dir);
console.error(`[replay] 載入 ${samples.length} 個樣本`);
if (samples.length < minFixtures) {
  console.error(`[replay] 樣本數 ${samples.length} < min-fixtures=${minFixtures}，中止`);
  Deno.exit(3);
}

const report = await runReplay({
  samples,
  perSampleDelayMs: delay,
  onProgress: (done, total, cur) => {
    if (done % 1 === 0) console.error(`[replay] ${done}/${total} · ${cur}`);
  },
});

const md = renderMarkdown(report);
console.log(md);

if (outJson) {
  await Deno.writeTextFile(outJson, JSON.stringify(report, null, 2));
  console.error(`[replay] JSON → ${outJson}`);
}
if (outMd) {
  await Deno.writeTextFile(outMd, md);
  console.error(`[replay] Markdown → ${outMd}`);
}

// 回歸斷言：standard >= raw、aggressive >= standard
if (failOnRegression) {
  const { modeHitRate } = report;
  const errs: string[] = [];
  if (modeHitRate.standard.rate < modeHitRate.fast.rate) {
    errs.push(`standard (${pct(modeHitRate.standard.rate)}) < raw baseline (${pct(modeHitRate.fast.rate)})`);
  }
  if (modeHitRate.aggressive.rate < modeHitRate.standard.rate) {
    errs.push(`aggressive (${pct(modeHitRate.aggressive.rate)}) < standard (${pct(modeHitRate.standard.rate)})`);
  }
  if (errs.length) {
    console.error(`[replay] ❌ regression:\n  - ${errs.join("\n  - ")}`);
    Deno.exit(1);
  }
}
console.error("[replay] ✅ done");

function pct(n: number) { return `${(n * 100).toFixed(1)}%`; }

function renderMarkdown(r: ReplayReport): string {
  const lines: string[] = [];
  lines.push(`# CAPTCHA OCR Replay Report`);
  lines.push(``);
  lines.push(`- Generated: \`${r.generated_at}\``);
  lines.push(`- Fixtures: **${r.totals.fixtures}** (skipped ${r.totals.skipped}) · API calls: ${r.totals.api_calls} · elapsed ${(r.totals.elapsed_ms / 1000).toFixed(1)}s`);
  lines.push(``);
  lines.push(`## Mode 命中率`);
  lines.push(``);
  lines.push(`| mode | 命中率 | majority | fallback_first | none |`);
  lines.push(`|---|---:|---:|---:|---:|`);
  for (const m of ["fast", "standard", "aggressive"] as const) {
    const x = r.modeHitRate[m];
    lines.push(`| ${m} | ${pct(x.rate)} (${x.correct}/${x.fixtures}) | ${x.majority} | ${x.fallback_first} | ${x.none} |`);
  }
  lines.push(``);
  lines.push(`**Improvement**: standard vs raw = **${r.improvements.standard_vs_raw_pp >= 0 ? "+" : ""}${r.improvements.standard_vs_raw_pp} pp** · aggressive vs raw = **${r.improvements.aggressive_vs_raw_pp >= 0 ? "+" : ""}${r.improvements.aggressive_vs_raw_pp} pp** · aggressive vs standard = **${r.improvements.aggressive_vs_standard_pp >= 0 ? "+" : ""}${r.improvements.aggressive_vs_standard_pp} pp**`);
  lines.push(``);
  lines.push(`## 變體獨立命中率`);
  lines.push(``);
  lines.push(`| variant | attempts | correct | rate | avg latency |`);
  lines.push(`|---|---:|---:|---:|---:|`);
  for (const v of ["raw", "otsu", "adaptive", "dilate", "loose_crop"] as const) {
    const x = r.variantHitRate[v];
    lines.push(`| ${v} | ${x.attempts} | ${x.correct} | ${pct(x.rate)} | ${x.avg_latency_ms} ms |`);
  }
  if (r.confusionPairs.length) {
    lines.push(``);
    lines.push(`## Top confusion pairs`);
    lines.push(``);
    lines.push(`| expected | got | count |`);
    lines.push(`|---|---|---:|`);
    for (const c of r.confusionPairs.slice(0, 15)) {
      lines.push(`| \`${c.expected_char}\` | \`${c.got_char}\` | ${c.count} |`);
    }
  }
  return lines.join("\n") + "\n";
}
