// tw-ocr-replay/replay.ts
// 對 CAPTCHA 固定樣本執行 OCR 回放：
//   - 對每張圖跑一次 exhaustive aggressive OCR，取得全部 5 個變體的獨立猜測
//   - 模擬 fast / standard / aggressive 的短路投票，計算每個 mode 的命中率
//   - 統計每個 preprocessing 變體的獨立命中率、consensus 分布、confusion pairs
//   - 回傳結構化 report，可寫成 JSON artifact 或作為 CI 斷言基礎
//
// 使用方式：
//   const report = await runReplay({ samples });  // samples 可來自 CLI 或 HTTP body
//
import {
  ocrTwseCaptchaDetailed,
  type OcrAttempt,
  type OcrMode,
  type OcrVariantName,
} from "../_shared/twOcr.ts";

const VARIANTS: OcrVariantName[] = ["raw", "otsu", "adaptive", "dilate", "loose_crop"];
const MODE_PLAN: Record<OcrMode, OcrVariantName[]> = {
  fast: ["raw"],
  standard: ["otsu", "adaptive", "raw"],
  aggressive: ["otsu", "adaptive", "dilate", "loose_crop", "raw"],
};

export interface ReplaySample {
  /** 顯示用檔名或識別碼 */
  file: string;
  /** 期望的 5 碼答案，大寫 */
  expected: string;
  /** PNG 位元組 */
  bytes: Uint8Array;
}

export interface FixtureResult {
  file: string;
  expected: string;
  per_variant: Record<OcrVariantName, { guess: string | null; correct: boolean; elapsed_ms: number }>;
  modes: Record<OcrMode, { guess: string | null; correct: boolean; consensus: "majority" | "fallback_first" | "none"; used_variant: OcrVariantName | null }>;
}

export interface ReplayReport {
  generated_at: string;
  totals: { fixtures: number; api_calls: number; elapsed_ms: number; skipped: number };
  variantHitRate: Record<OcrVariantName, { attempts: number; correct: number; rate: number; avg_latency_ms: number }>;
  modeHitRate: Record<OcrMode, { fixtures: number; correct: number; rate: number; majority: number; fallback_first: number; none: number }>;
  improvements: {
    standard_vs_raw_pp: number;
    aggressive_vs_raw_pp: number;
    aggressive_vs_standard_pp: number;
  };
  confusionPairs: Array<{ expected_char: string; got_char: string; count: number }>;
  fixtures: FixtureResult[];
}

/** 驗證答案格式：5 個大寫英數字 */
export function normalizeAnswer(raw: string): string | null {
  const s = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.length === 5 ? s : null;
}

/** 依照每個變體的獨立猜測，模擬指定 mode 的短路投票邏輯 */
function simulateMode(
  mode: OcrMode,
  perVariant: Record<OcrVariantName, { guess: string | null; correct: boolean; elapsed_ms: number }>,
): { guess: string | null; consensus: "majority" | "fallback_first" | "none"; used_variant: OcrVariantName | null } {
  const plan = MODE_PLAN[mode];
  const votes = new Map<string, { count: number; variant: OcrVariantName }>();
  let first: { variant: OcrVariantName; guess: string } | null = null;
  for (const v of plan) {
    const g = perVariant[v]?.guess;
    if (!g) continue;
    if (!first) first = { variant: v, guess: g };
    const e = votes.get(g);
    if (e) {
      e.count += 1;
      return { guess: g, consensus: "majority", used_variant: e.variant };
    }
    votes.set(g, { count: 1, variant: v });
  }
  if (first) return { guess: first.guess, consensus: "fallback_first", used_variant: first.variant };
  return { guess: null, consensus: "none", used_variant: null };
}

export interface RunReplayOptions {
  samples: ReplaySample[];
  /** 每張圖處理間 sleep 毫秒，避免對 AI Gateway 造成尖峰 */
  perSampleDelayMs?: number;
  onProgress?: (done: number, total: number, current: string) => void;
}

export async function runReplay(opts: RunReplayOptions): Promise<ReplayReport> {
  const t0 = Date.now();
  const fixtures: FixtureResult[] = [];
  const variantAgg: Record<OcrVariantName, { attempts: number; correct: number; total_latency: number }> = {
    raw: { attempts: 0, correct: 0, total_latency: 0 },
    otsu: { attempts: 0, correct: 0, total_latency: 0 },
    adaptive: { attempts: 0, correct: 0, total_latency: 0 },
    dilate: { attempts: 0, correct: 0, total_latency: 0 },
    loose_crop: { attempts: 0, correct: 0, total_latency: 0 },
  };
  const modeAgg: Record<OcrMode, { fixtures: number; correct: number; majority: number; fallback_first: number; none: number }> = {
    fast: { fixtures: 0, correct: 0, majority: 0, fallback_first: 0, none: 0 },
    standard: { fixtures: 0, correct: 0, majority: 0, fallback_first: 0, none: 0 },
    aggressive: { fixtures: 0, correct: 0, majority: 0, fallback_first: 0, none: 0 },
  };
  const confusion = new Map<string, number>(); // key = `${exp}\t${got}`
  let apiCalls = 0;
  let skipped = 0;

  for (let i = 0; i < opts.samples.length; i++) {
    const s = opts.samples[i];
    opts.onProgress?.(i, opts.samples.length, s.file);
    const expected = normalizeAnswer(s.expected);
    if (!expected) { skipped += 1; continue; }

    let result;
    try {
      result = await ocrTwseCaptchaDetailed(s.bytes, { mode: "aggressive", exhaustive: true });
    } catch (e) {
      console.error(`[replay] ${s.file} failed:`, e);
      skipped += 1;
      continue;
    }

    const perVariant: FixtureResult["per_variant"] = {
      raw: { guess: null, correct: false, elapsed_ms: 0 },
      otsu: { guess: null, correct: false, elapsed_ms: 0 },
      adaptive: { guess: null, correct: false, elapsed_ms: 0 },
      dilate: { guess: null, correct: false, elapsed_ms: 0 },
      loose_crop: { guess: null, correct: false, elapsed_ms: 0 },
    };
    for (const a of result.attempts as OcrAttempt[]) {
      apiCalls += 1;
      const guess = a.guess ? normalizeAnswer(a.guess) : null;
      const correct = guess === expected;
      perVariant[a.variant] = { guess, correct, elapsed_ms: a.elapsed_ms };
      const agg = variantAgg[a.variant];
      agg.attempts += 1;
      if (correct) agg.correct += 1;
      agg.total_latency += a.elapsed_ms;
      // confusion: 比對字元錯位（僅在 guess 有 5 碼時）
      if (guess && !correct) {
        for (let k = 0; k < 5; k++) {
          if (guess[k] !== expected[k]) {
            const key = `${expected[k]}\t${guess[k]}`;
            confusion.set(key, (confusion.get(key) || 0) + 1);
          }
        }
      }
    }

    const modes: FixtureResult["modes"] = {
      fast: (() => { const s = simulateMode("fast", perVariant); return { ...s, correct: s.guess === expected }; })(),
      standard: (() => { const s = simulateMode("standard", perVariant); return { ...s, correct: s.guess === expected }; })(),
      aggressive: (() => { const s = simulateMode("aggressive", perVariant); return { ...s, correct: s.guess === expected }; })(),
    };
    for (const m of ["fast", "standard", "aggressive"] as OcrMode[]) {
      const r = modes[m];
      modeAgg[m].fixtures += 1;
      if (r.correct) modeAgg[m].correct += 1;
      modeAgg[m][r.consensus] += 1;
    }

    fixtures.push({ file: s.file, expected, per_variant: perVariant, modes });

    if (opts.perSampleDelayMs && i < opts.samples.length - 1) {
      await new Promise((r) => setTimeout(r, opts.perSampleDelayMs));
    }
  }

  opts.onProgress?.(opts.samples.length, opts.samples.length, "done");

  const variantHitRate = {} as ReplayReport["variantHitRate"];
  for (const v of VARIANTS) {
    const a = variantAgg[v];
    variantHitRate[v] = {
      attempts: a.attempts,
      correct: a.correct,
      rate: a.attempts > 0 ? a.correct / a.attempts : 0,
      avg_latency_ms: a.attempts > 0 ? Math.round(a.total_latency / a.attempts) : 0,
    };
  }

  const modeHitRate = {} as ReplayReport["modeHitRate"];
  for (const m of ["fast", "standard", "aggressive"] as OcrMode[]) {
    const a = modeAgg[m];
    modeHitRate[m] = {
      fixtures: a.fixtures,
      correct: a.correct,
      rate: a.fixtures > 0 ? a.correct / a.fixtures : 0,
      majority: a.majority,
      fallback_first: a.fallback_first,
      none: a.none,
    };
  }

  const rawRate = modeHitRate.fast.rate; // fast = raw only，作為 baseline
  const stdRate = modeHitRate.standard.rate;
  const aggRate = modeHitRate.aggressive.rate;

  const confusionPairs = Array.from(confusion.entries())
    .map(([k, count]) => {
      const [expected_char, got_char] = k.split("\t");
      return { expected_char, got_char, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);

  return {
    generated_at: new Date().toISOString(),
    totals: { fixtures: fixtures.length, api_calls: apiCalls, elapsed_ms: Date.now() - t0, skipped },
    variantHitRate,
    modeHitRate,
    improvements: {
      standard_vs_raw_pp: +(100 * (stdRate - rawRate)).toFixed(2),
      aggressive_vs_raw_pp: +(100 * (aggRate - rawRate)).toFixed(2),
      aggressive_vs_standard_pp: +(100 * (aggRate - stdRate)).toFixed(2),
    },
    confusionPairs,
    fixtures,
  };
}

/** 讀取 fixtures 目錄，回傳 sample 陣列。labels.json 格式：{ "images/xxx.png": "AB12C" } */
export async function loadFixturesFromDir(dir: string): Promise<ReplaySample[]> {
  const labelsPath = `${dir}/labels.json`;
  const raw = await Deno.readTextFile(labelsPath);
  const labels: Record<string, string> = JSON.parse(raw);
  const samples: ReplaySample[] = [];
  for (const [rel, ans] of Object.entries(labels)) {
    const norm = normalizeAnswer(ans);
    if (!norm) { console.warn(`[replay] 跳過 ${rel}：答案格式非法 (${ans})`); continue; }
    try {
      const bytes = await Deno.readFile(`${dir}/${rel}`);
      samples.push({ file: rel, expected: norm, bytes });
    } catch (e) {
      console.warn(`[replay] 讀不到 ${rel}:`, (e as Error).message);
    }
  }
  return samples;
}
