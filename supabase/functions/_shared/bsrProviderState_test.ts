import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyBsrError,
  classifyBsrProvider,
  BSR_PROVIDER_CODES,
} from "./bsrProviderState.ts";

const base = {
  eligible: true,
  bsrAsOf: "2026-08-14",
  expectedDate: "2026-08-17",
  queueStatus: "pending" as const,
  lastErrorRaw: null as string | null,
  persistedErrorClass: null as string | null,
  attempts: 1,
  maxAttempts: 5,
};

const REGISTER_400 =
  'finmind_http_400:{"msg":"Your level is register. Please update your user level.","status":400}';

Deno.test("terminal: FinMind register-level 400", () => {
  const v = classifyBsrError(REGISTER_400);
  assertEquals(v?.state, "terminal_provider_rejected");
  assertEquals(v?.code, "provider_plan_rejected");
});

Deno.test("terminal: persisted error_class 直接命中", () => {
  const v = classifyBsrError(null, "provider_plan_rejected");
  assertEquals(v?.state, "terminal_provider_rejected");
});

Deno.test("negative: 其他 400 不得誤判 terminal", () => {
  for (
    const raw of [
      'finmind_http_400:{"msg":"invalid date format"}',
      'finmind_http_400:{"msg":"data_id not found: 9999"}',
      "finmind_http_400:bad request parameter start_date",
    ]
  ) {
    const v = classifyBsrError(raw);
    assertEquals(v?.state, "unknown_degraded", raw);
    assertEquals(v?.code, "unclassified", raw);
  }
});

Deno.test("retryable: 429 / 5xx / timeout / network", () => {
  assertEquals(classifyBsrError("finmind_http_429:too many requests")?.code, "upstream_rate_limited");
  assertEquals(classifyBsrError("rate_limited")?.code, "upstream_rate_limited");
  assertEquals(classifyBsrError("finmind_http_500:internal")?.code, "upstream_5xx");
  assertEquals(classifyBsrError("finmind_http_502:bad gateway")?.code, "upstream_5xx");
  assertEquals(classifyBsrError("AbortError: signal timed out")?.code, "upstream_timeout");
  assertEquals(classifyBsrError("TypeError: fetch failed ECONNRESET")?.code, "upstream_network");
});

Deno.test("5xx 內文帶簽章字樣也不得升級為 terminal", () => {
  const v = classifyBsrError('finmind_http_503:{"msg":"please update your user level"}');
  assertEquals(v?.state, "retryable");
});

Deno.test("空字串 / null → 無錯誤", () => {
  assertEquals(classifyBsrError(""), null);
  assertEquals(classifyBsrError(null), null);
  assertEquals(classifyBsrError("   "), null);
});

Deno.test("未知字串 → unknown_degraded", () => {
  assertEquals(classifyBsrError("something weird happened")?.state, "unknown_degraded");
});

Deno.test("precedence: ineligible 勝過一切", () => {
  const v = classifyBsrProvider({ ...base, eligible: false, lastErrorRaw: REGISTER_400 });
  assertEquals(v.state, "ineligible");
  assertEquals(v.retryable, false);
  assertEquals(v.nextRetryAllowed, false);
});

Deno.test("2308 真實形狀：terminal + 有 8/14 舊資料", () => {
  const v = classifyBsrProvider({ ...base, lastErrorRaw: REGISTER_400 });
  assertEquals(v.state, "terminal_provider_rejected");
  assertEquals(v.hasStaleData, true);
  assertEquals(v.retryable, false);
  assertEquals(v.nextRetryAllowed, false);
});

Deno.test("terminal 且完全無資料", () => {
  const v = classifyBsrProvider({ ...base, bsrAsOf: null, lastErrorRaw: REGISTER_400 });
  assertEquals(v.state, "terminal_provider_rejected");
  assertEquals(v.hasStaleData, false);
});

Deno.test("retryable 未達上限可承諾重試；達上限不可", () => {
  const ok = classifyBsrProvider({ ...base, lastErrorRaw: "finmind_http_500:x" });
  assertEquals(ok.state, "retryable");
  assertEquals(ok.nextRetryAllowed, true);
  const capped = classifyBsrProvider({
    ...base,
    lastErrorRaw: "finmind_http_500:x",
    attempts: 5,
  });
  assertEquals(capped.retryable, false);
  assertEquals(capped.nextRetryAllowed, false);
});

Deno.test("unknown_degraded：worker 可重試但 UI 不承諾", () => {
  const v = classifyBsrProvider({ ...base, lastErrorRaw: "weird" });
  assertEquals(v.state, "unknown_degraded");
  assertEquals(v.retryable, true);
  assertEquals(v.nextRetryAllowed, false);
});

Deno.test("fresh / stale_no_error", () => {
  const fresh = classifyBsrProvider({ ...base, bsrAsOf: "2026-08-17" });
  assertEquals(fresh.state, "fresh");
  const stale = classifyBsrProvider({ ...base, queueStatus: null });
  assertEquals(stale.state, "stale_no_error");
  assertEquals(stale.nextRetryAllowed, false);
});

Deno.test("輸出 code 一律在白名單內（不外洩 raw body）", () => {
  const v = classifyBsrProvider({ ...base, lastErrorRaw: REGISTER_400 });
  assertEquals(BSR_PROVIDER_CODES.includes(v.code), true);
  assertEquals(JSON.stringify(v).includes("Your level"), false);
});
