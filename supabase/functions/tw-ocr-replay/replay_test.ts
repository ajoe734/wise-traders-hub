// tw-ocr-replay/replay_test.ts — Deno test，讓 CI 以固定樣本回歸驗證 preprocessing 管線
//
// 觸發條件（皆需要滿足才會真正跑）：
//   - env LOVABLE_API_KEY 已設定
//   - fixtures/labels.json 存在且至少 5 筆有效樣本
//   若任一不滿足，測試會 ignore 並在 stderr 印出原因，不會擋 CI。
//
// 斷言：
//   1. standard mode 命中率 ≥ raw baseline （否則預處理管線退步）
//   2. aggressive mode 命中率 ≥ standard mode （否則加變體無效）
//   3. 至少有 1 個非 raw 變體命中率 ≥ raw （單變體最低效益）
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runReplay, loadFixturesFromDir } from "./replay.ts";

const FIXTURE_DIR = new URL("./fixtures", import.meta.url).pathname;
const MIN_FIXTURES = parseInt(Deno.env.get("OCR_REPLAY_MIN_FIXTURES") || "5", 10);

async function loadSamplesOrSkip() {
  if (!Deno.env.get("LOVABLE_API_KEY")) {
    console.warn("[ocr-replay-test] SKIP：LOVABLE_API_KEY 未設定");
    return null;
  }
  try {
    const samples = await loadFixturesFromDir(FIXTURE_DIR);
    if (samples.length < MIN_FIXTURES) {
      console.warn(`[ocr-replay-test] SKIP：fixtures 只有 ${samples.length} 筆（需要 ≥ ${MIN_FIXTURES}）`);
      return null;
    }
    return samples;
  } catch (e) {
    console.warn(`[ocr-replay-test] SKIP：讀取 fixtures 失敗 - ${(e as Error).message}`);
    return null;
  }
}

Deno.test({
  name: "CAPTCHA replay: preprocessing 管線不得使命中率退步",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const samples = await loadSamplesOrSkip();
    if (!samples) return;

    const report = await runReplay({ samples, perSampleDelayMs: 300 });
    console.log("\n" + JSON.stringify({
      fixtures: report.totals.fixtures,
      api_calls: report.totals.api_calls,
      elapsed_ms: report.totals.elapsed_ms,
      modeHitRate: report.modeHitRate,
      variantHitRate: report.variantHitRate,
      improvements: report.improvements,
    }, null, 2));

    // 寫 report 供 CI artifact
    const outPath = Deno.env.get("OCR_REPLAY_OUT") || "";
    if (outPath) {
      await Deno.writeTextFile(outPath, JSON.stringify(report, null, 2));
    }

    const rawRate = report.modeHitRate.fast.rate;
    const stdRate = report.modeHitRate.standard.rate;
    const aggRate = report.modeHitRate.aggressive.rate;

    assert(
      stdRate >= rawRate,
      `standard (${(stdRate * 100).toFixed(1)}%) < raw baseline (${(rawRate * 100).toFixed(1)}%) — preprocessing 退步`,
    );
    assert(
      aggRate >= stdRate,
      `aggressive (${(aggRate * 100).toFixed(1)}%) < standard (${(stdRate * 100).toFixed(1)}%) — 增加變體反而變差`,
    );

    const nonRawVariants = ["otsu", "adaptive", "dilate", "loose_crop"] as const;
    const anyBetter = nonRawVariants.some(
      (v) => report.variantHitRate[v].attempts > 0
        && report.variantHitRate[v].rate >= report.variantHitRate.raw.rate,
    );
    assert(
      anyBetter,
      `所有非 raw 變體命中率都低於 raw：${JSON.stringify(report.variantHitRate)}`,
    );
  },
});
