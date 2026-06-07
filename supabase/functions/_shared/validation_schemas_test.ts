// Per-function schema boundary tests.
//
// These mirror the `validateInput({ fields, source })` calls inside each edge
// function's index.ts. The specs are inlined here on purpose so this test file
// is the canonical contract that prod schemas must match — when prod drifts,
// the matching E2E test (e2e_test.ts) catches the runtime divergence.
//
// Naming convention: each block = one edge function. Cases: at least one
// success, and one failure per declared constraint (required / type / minLength
// / minItems / pattern / oneOf / nested).
//
// Pure logic. No network. Run via lovable-exec test.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateInput, type FieldSpec } from "./inputValidator.ts";

type Spec = Record<string, FieldSpec>;

function ok(spec: Spec, source: unknown) {
  const out = validateInput({ fields: spec, source });
  assertEquals(out.length, 0, `expected pass, got: ${JSON.stringify(out)}`);
}
function fail(spec: Spec, source: unknown, key?: string) {
  const out = validateInput({ fields: spec, source });
  assert(out.length > 0, "expected failure");
  if (key) assert(out.some((i) => i.key === key), `expected fail on key=${key}, got ${JSON.stringify(out)}`);
}

// ───────────── data-upsert ─────────────
Deno.test("schema:data-upsert", () => {
  const spec: Spec = {
    action: { required: true, type: "string", oneOf: ["select", "upsert", "insert"], label: "action" },
    table: { required: true, type: "string", label: "table" },
    records: { type: "array", label: "records" },
    params: { type: "object", label: "params" },
    on_conflict: { type: "string", label: "on_conflict" },
    ignore_duplicates: { type: "boolean", label: "ignore_duplicates" },
  };
  ok(spec, { action: "select", table: "trade_signals" });
  ok(spec, { action: "upsert", table: "current_prices", records: [], on_conflict: "id" });
  fail(spec, {}, "action");
  fail(spec, { action: "select" }, "table");
  fail(spec, { action: "delete", table: "x" }, "action");
  fail(spec, { action: "select", table: "x", records: "not-array" }, "records");
  fail(spec, { action: "select", table: "x", ignore_duplicates: "yes" }, "ignore_duplicates");
});

// ───────────── signal-ai-assist ─────────────
Deno.test("schema:signal-ai-assist", () => {
  const spec: Spec = {
    mode: { required: true, type: "string", oneOf: ["rewrite", "expand", "summarize", "bulletize", "custom"], label: "mode" },
    content: { required: true, type: "string", minLength: 1, label: "content" },
    field: { type: "string", label: "field" },
    instruction: { type: "string", label: "instruction" },
    context: { type: "object", label: "context" },
  };
  ok(spec, { mode: "rewrite", content: "x" });
  fail(spec, { mode: "rewrite" }, "content");
  fail(spec, { mode: "rewrite", content: "" }, "content");
  fail(spec, { mode: "translate", content: "x" }, "mode");
  fail(spec, { content: "x" }, "mode");
  fail(spec, { mode: "rewrite", content: "x", context: [] }, "context");
});

// ───────────── admin-manage-users ─────────────
Deno.test("schema:admin-manage-users", () => {
  const spec: Spec = {
    action: {
      required: true,
      type: "string",
      oneOf: ["list", "set_role", "set_tester", "set_banned", "send_password_reset", "update_profile", "delete_user", "lookup_identities"],
      label: "action",
    },
  };
  for (const a of ["list", "set_role", "delete_user", "lookup_identities"]) ok(spec, { action: a });
  fail(spec, {}, "action");
  fail(spec, { action: "drop_table" }, "action");
  fail(spec, { action: 123 }, "action");
});

// ───────────── checkup-research ─────────────
Deno.test("schema:checkup-research", () => {
  const spec: Spec = {
    code: { required: true, type: "string", pattern: /^\d{4,6}[A-Z]?$/i, label: "股票代碼" },
    name: { required: true, type: "string", label: "股票名稱" },
  };
  ok(spec, { code: "2330", name: "台積電" });
  ok(spec, { code: "1101B", name: "台泥乙" });
  fail(spec, { code: "abc", name: "x" }, "code");
  fail(spec, { code: "12", name: "x" }, "code");
  fail(spec, { name: "x" }, "code");
  fail(spec, { code: "2330" }, "name");
});

// ───────────── checkup-predict-events ─────────────
Deno.test("schema:checkup-predict-events", () => {
  const spec: Spec = {
    events: { required: true, type: "array", minItems: 1, label: "events" },
    holdings: { required: false, type: "array", label: "holdings" },
    debug: { required: false, type: "boolean", label: "debug" },
  };
  ok(spec, { events: [{}] });
  ok(spec, { events: [{}], holdings: [], debug: true });
  fail(spec, { events: [] }, "events");
  fail(spec, {}, "events");
  fail(spec, { events: [{}], holdings: "x" }, "holdings");
  fail(spec, { events: [{}], debug: "yes" }, "debug");
});

// ───────────── checkup-research-extract ─────────────
Deno.test("schema:checkup-research-extract", () => {
  const spec: Spec = {
    report: {
      required: true,
      type: "object",
      label: "report",
      nested: {
        code: { required: true, type: "string", pattern: /^\d{4,6}[A-Z]?$/i, label: "report.code" },
        text: { required: true, type: "string", minLength: 10, label: "report.text" },
      },
    },
    stock: { required: false, type: "object", label: "stock" },
    dossier: { required: false, type: "object", label: "dossier" },
  };
  ok(spec, { report: { code: "2330", text: "this is long enough" } });
  fail(spec, {}, "report");
  fail(spec, { report: { code: "bad", text: "this is long enough" } }, "code");
  fail(spec, { report: { code: "2330", text: "short" } }, "text");
  fail(spec, { report: { code: "2330" } }, "text");
});

// ───────────── checkup-calendar ─────────────
Deno.test("schema:checkup-calendar", () => {
  const spec: Spec = {
    stocks: {
      required: true, type: "string", minLength: 3, acceptTypes: ["array"], label: "stocks",
    },
    today: { required: false, type: "string", label: "today" },
    endDate: { required: false, type: "string", label: "endDate" },
    debug: { required: false, type: "boolean", label: "debug" },
  };
  ok(spec, { stocks: "2330 台積電" });
  ok(spec, { stocks: ["2330"] });
  fail(spec, {}, "stocks");
  fail(spec, { stocks: "ab" }, "stocks");
  fail(spec, { stocks: 123 }, "stocks");
});

// ───────────── checkup-parse ─────────────
Deno.test("schema:checkup-parse", () => {
  const spec: Spec = {
    base64: { required: true, type: "string", minLength: 32, label: "截圖 base64" },
    mediaType: { required: false, type: "string" },
    systemPrompt: { required: false, type: "string" },
  };
  ok(spec, { base64: "x".repeat(32) });
  fail(spec, {}, "base64");
  fail(spec, { base64: "x".repeat(31) }, "base64");
  fail(spec, { base64: 123 }, "base64");
});

// ───────────── checkup-twse ─────────────
Deno.test("schema:checkup-twse", () => {
  const spec: Spec = {
    ex_ch: { required: true, type: "string", minLength: 3, label: "ex_ch" },
  };
  ok(spec, { ex_ch: "tse_2330.tw" });
  fail(spec, {}, "ex_ch");
  fail(spec, { ex_ch: "ab" }, "ex_ch");
});

// ───────────── checkup-telemetry ─────────────
Deno.test("schema:checkup-telemetry", () => {
  const spec: Spec = {
    action: { required: true, type: "string", oneOf: ["capture-diagnostics"], label: "action" },
    data: { required: true, type: "object", label: "data" },
  };
  ok(spec, { action: "capture-diagnostics", data: { foo: 1 } });
  fail(spec, { action: "other", data: {} }, "action");
  fail(spec, { action: "capture-diagnostics" }, "data");
  fail(spec, { action: "capture-diagnostics", data: [] }, "data");
});

// ───────────── checkup-mops-revenue ─────────────
Deno.test("schema:checkup-mops-revenue", () => {
  const spec: Spec = {
    stockId: { required: true, type: "string", pattern: /^\d{4,6}[A-Z]?(\.(TW|TWO))?$/i, label: "stockId" },
    year: { required: false, type: "string" },
    month: { required: false, type: "string" },
  };
  ok(spec, { stockId: "2330" });
  ok(spec, { stockId: "2330.TW" });
  ok(spec, { stockId: "00878.TWO" });
  fail(spec, {}, "stockId");
  fail(spec, { stockId: "AAPL" }, "stockId");
});

// ───────────── stock-name-lookup ─────────────
Deno.test("schema:stock-name-lookup", () => {
  const spec: Spec = {
    symbols: { required: true, type: "array", minItems: 1, acceptTypes: ["string"], label: "symbols" },
  };
  ok(spec, { symbols: ["2330"] });
  ok(spec, { symbols: "2330" });
  fail(spec, {}, "symbols");
  fail(spec, { symbols: [] }, "symbols");
  fail(spec, { symbols: 123 }, "symbols");
});

// ───────────── checkup-sparkline ─────────────
Deno.test("schema:checkup-sparkline", () => {
  const spec: Spec = {
    codes: { required: true, type: "array", minItems: 1, acceptTypes: ["string"], label: "codes" },
  };
  ok(spec, { codes: ["2330"] });
  ok(spec, { codes: "2330,2317" });
  fail(spec, { codes: [] }, "codes");
  fail(spec, {}, "codes");
});

// ───────────── checkup-analyze ─────────────
Deno.test("schema:checkup-analyze", () => {
  const spec: Spec = {
    userPrompt: { required: true, type: "string", minLength: 4, altKey: "prompt", label: "userPrompt" },
    systemPrompt: { required: false, type: "string" },
  };
  ok(spec, { userPrompt: "hello" });
  ok(spec, { prompt: "hello world" }, );
  fail(spec, {}, "userPrompt");
  fail(spec, { userPrompt: "abc" }, "userPrompt"); // minLength 4
  fail(spec, { prompt: "abc" }, "userPrompt");
});

// ───────────── checkup-mops-announcements ─────────────
Deno.test("schema:checkup-mops-announcements", () => {
  const spec: Spec = {
    date: { required: true, type: "string", pattern: /^\d{8}$/, label: "date YYYYMMDD" },
  };
  ok(spec, { date: "20260607" });
  fail(spec, {}, "date");
  fail(spec, { date: "2026-06-07" }, "date");
  fail(spec, { date: "2026067" }, "date");
});

// ───────────── checkup-analyst-reports ─────────────
Deno.test("schema:checkup-analyst-reports", () => {
  const spec: Spec = {
    code: { required: true, type: "string", pattern: /^\d{4,6}[A-Z]?$/i, label: "code" },
    name: { required: true, type: "string", label: "name" },
    knownHashes: { required: false, type: "array" },
    maxItems: { required: false, type: "number" },
    maxExtract: { required: false, type: "number" },
  };
  ok(spec, { code: "2330", name: "台積電" });
  ok(spec, { code: "2330", name: "x", knownHashes: ["a"], maxItems: 5, maxExtract: 3 });
  fail(spec, { code: "bad", name: "x" }, "code");
  fail(spec, { code: "2330", name: "x", maxItems: "5" }, "maxItems");
  fail(spec, { code: "2330", name: "x", knownHashes: "a" }, "knownHashes");
});

// ───────────── checkup-knowledge ─────────────
Deno.test("schema:checkup-knowledge", () => {
  const spec: Spec = {
    action: { required: true, type: "string", oneOf: ["add"], label: "action" },
    category: { required: true, type: "string", label: "category" },
    item: { required: true, type: "object", label: "item" },
  };
  ok(spec, { action: "add", category: "tw", item: {} });
  fail(spec, { action: "remove", category: "x", item: {} }, "action");
  fail(spec, { action: "add", category: "x" }, "item");
  fail(spec, { action: "add", item: {} }, "category");
});

// ───────────── checkup-institutional ─────────────
Deno.test("schema:checkup-institutional", () => {
  const spec: Spec = {
    date: { required: true, type: "string", pattern: /^\d{8}$/, label: "date YYYYMMDD" },
  };
  ok(spec, { date: "20260607" });
  fail(spec, {}, "date");
  fail(spec, { date: "2026/06/07" }, "date");
});
