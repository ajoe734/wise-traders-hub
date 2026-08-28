/**
 * nowProvider — 前台「現在幾點」的唯一 clock seam。
 *
 * 為什麼存在：`installHarnessClock()`（harnessClock.ts）只覆寫 `Date.now`，
 * 直接 `new Date()` 的呼叫會逃出覆寫，導致 harness / E2E 注入的時間與 production
 * 邏輯用的時間不是同一套。所有需要「現在」的 checkup 模組一律走這裡，
 * 保證 snapshot、cache key、fingerprint 出自同一個時間快照。
 */

/** 現在（epoch ms）。唯一來源 = `Date.now()`（可被 harness clock 覆寫）。 */
export function nowMs(): number {
  return Date.now();
}

/** 現在（Date 物件）。由 `nowMs()` 導出，不使用裸 `new Date()`。 */
export function nowDate(): Date {
  return new Date(nowMs());
}

export default nowMs;
