// deno-lint-ignore-file no-explicit-any
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  confirmLinepayPayment,
  diffConfirmEcho,
  extractConfirmEcho,
  parseConfirmBody,
} from "./linepayConfirm.ts";

Deno.env.set("AUTH_EVENT_LOGGING", "0");

// ---------------------------------------------------------------------------
// Minimal chainable Supabase mock that records every mutation.
// ---------------------------------------------------------------------------
type Mutation = { table: string; op: string; payload: unknown };

function makeSupabase(reads: Record<string, any>) {
  const mutations: Mutation[] = [];
  let subSeq = 0;

  function builder(table: string, op: string, payload?: unknown): any {
    const node: any = {
      then(resolve: any, reject: any) {
        return Promise.resolve(settle()).then(resolve, reject);
      },
    };
    for (const m of ["select", "eq", "in", "not", "lte", "gte", "order", "limit", "is", "or"]) {
      node[m] = () => node;
    }
    node.maybeSingle = () => Promise.resolve(settle(true));
    node.single = () => Promise.resolve(settle(true));

    function settle(single = false) {
      if (op !== "select") {
        mutations.push({ table, op, payload });
        if (table === "member_subscriptions" && op === "insert") {
          subSeq += 1;
          return { data: { id: `sub-${subSeq}` }, error: null };
        }
        if (table === "payment_transactions" && op === "insert") {
          return { data: { id: `tx-${mutations.length}` }, error: null };
        }
        return { data: null, error: null };
      }
      const key = single && Object.hasOwn(reads, `${table}__single`) ? `${table}__single` : table;
      const v = reads[key];
      const resolved = typeof v === "function" ? v() : v;
      if (resolved === undefined) return { data: single ? null : [], error: null };
      return { data: resolved, error: null };
    }
    return node;
  }

  const client = {
    from(table: string) {
      return {
        select: () => builder(table, "select"),
        insert: (payload: unknown) => builder(table, "insert", payload),
        update: (payload: unknown) => builder(table, "update", payload),
        upsert: (payload: unknown) => builder(table, "upsert", payload),
        delete: () => builder(table, "delete"),
      };
    },
    mutations,
  };
  return client as any;
}

const ENV: Record<string, string> = {
  LINEPAY_CHANNEL_ID: "chan",
  LINEPAY_CHANNEL_SECRET: "secret",
  LINEPAY_API_URL: "https://linepay.test",
};
const env = (k: string) => ENV[k];

const INTENT = {
  id: "intent-1",
  trade_no: "ORDER-1",
  user_id: "victim-owner",
  plan_id: "plan-1",
  expert_id: "expert-1",
  billing_cycle: "monthly",
  amount: 1200,
  original_amount: 1200,
  discount_amount: 0,
  discount_reason: null,
  attribution: null,
  product_kind: "expert_plan",
  status: "pending",
};

function okConfirmResponse(over: Record<string, unknown> = {}) {
  return {
    returnCode: "0000",
    returnMessage: "Success",
    info: {
      orderId: "ORDER-1",
      transactionId: "TX-1",
      payInfo: [{ method: "CREDIT_CARD", amount: 1200, currency: "TWD" }],
      ...over,
    },
  };
}

function fetchReturning(payload: unknown, calls: unknown[] = []) {
  return ((url: string, init: any) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));
  }) as unknown as typeof fetch;
}

function baseReads(over: Record<string, any> = {}) {
  return {
    payment_transactions: null,
    payment_intents: INTENT,
    payment_providers: { id: "prov-1" },
    member_subscriptions: [],
    payment_settings: null,
    plan_split_overrides: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// parse-level red tests
// ---------------------------------------------------------------------------
Deno.test("parseConfirmBody rejects client-controlled simulate/userId/planId/amount", () => {
  for (const extra of [{ simulate: true }, { userId: "attacker" }, { planId: "p" }, { amount: 1 }]) {
    const r = parseConfirmBody({ orderId: "O", transactionId: "T", ...extra });
    assertEquals(r.ok, false);
    assertEquals((r as any).code, "UNKNOWN_FIELD");
  }
});

Deno.test("parseConfirmBody accepts exactly orderId+transactionId", () => {
  const r = parseConfirmBody({ orderId: " O ", transactionId: "T" });
  assert(r.ok);
  assertEquals((r as any).value, { orderId: "O", transactionId: "T" });
});

Deno.test("parseConfirmBody requires both fields", () => {
  assertEquals(parseConfirmBody({ orderId: "O" }).ok, false);
  assertEquals(parseConfirmBody({ transactionId: "T" }).ok, false);
  assertEquals(parseConfirmBody(null).ok, false);
  assertEquals(parseConfirmBody([]).ok, false);
});

Deno.test("diffConfirmEcho flags every mismatching field", () => {
  const echo = extractConfirmEcho(okConfirmResponse({ orderId: "OTHER" }));
  assertEquals(
    diffConfirmEcho(echo, { orderId: "ORDER-1", transactionId: "TX-1", amount: 1200, currency: "TWD" }),
    ["orderId"],
  );
  const echo2 = extractConfirmEcho(okConfirmResponse({ payInfo: [{ amount: 1, currency: "JPY" }] }));
  assertEquals(
    diffConfirmEcho(echo2, { orderId: "ORDER-1", transactionId: "TX-1", amount: 1200, currency: "TWD" }).sort(),
    ["amount", "currency"],
  );
});

// ---------------------------------------------------------------------------
// handler-level red tests: every failure path must be zero-mutation
// ---------------------------------------------------------------------------
Deno.test("simulate+victim userId cannot mint a subscription (zero mutation)", async () => {
  const supabase = makeSupabase(baseReads());
  const calls: unknown[] = [];
  const out = await confirmLinepayPayment(
    { supabase, fetchFn: fetchReturning(okConfirmResponse(), calls), env },
    { orderId: "ORDER-1", transactionId: "TX-1", simulate: true, userId: "victim", planId: "plan-1", amount: 1 },
  );
  assertEquals(out.status, 400);
  assertEquals(out.body.code, "UNKNOWN_FIELD");
  assertEquals(supabase.mutations.length, 0);
  assertEquals(calls.length, 0);
});

Deno.test("fake transactionId with no intent → 404, zero mutation", async () => {
  const supabase = makeSupabase(baseReads({ payment_intents: null }));
  const calls: unknown[] = [];
  const out = await confirmLinepayPayment(
    { supabase, fetchFn: fetchReturning(okConfirmResponse(), calls), env },
    { orderId: "NOPE", transactionId: "TX-FAKE" },
  );
  assertEquals(out.status, 404);
  assertEquals(out.body.code, "INTENT_NOT_FOUND");
  assertEquals(supabase.mutations.length, 0);
  assertEquals(calls.length, 0, "provider must not be called before intent resolves");
});

Deno.test("intent missing user/plan → 409, zero mutation", async () => {
  const supabase = makeSupabase(baseReads({ payment_intents: { ...INTENT, user_id: null, plan_id: null } }));
  const out = await confirmLinepayPayment(
    { supabase, fetchFn: fetchReturning(okConfirmResponse()), env },
    { orderId: "ORDER-1", transactionId: "TX-1" },
  );
  assertEquals(out.status, 409);
  assertEquals(out.body.code, "INTENT_INCOMPLETE");
  assertEquals(supabase.mutations.length, 0);
});

Deno.test("missing channel config → 503, zero mutation, no provider call", async () => {
  const supabase = makeSupabase(baseReads());
  const calls: unknown[] = [];
  const out = await confirmLinepayPayment(
    { supabase, fetchFn: fetchReturning(okConfirmResponse(), calls), env: () => undefined },
    { orderId: "ORDER-1", transactionId: "TX-1" },
  );
  assertEquals(out.status, 503);
  assertEquals(out.body.code, "PROVIDER_CONFIG_MISSING");
  assertEquals(supabase.mutations.length, 0);
  assertEquals(calls.length, 0);
});

Deno.test("no active line_pay provider row → 503, zero mutation", async () => {
  const supabase = makeSupabase(baseReads({ payment_providers: null }));
  const out = await confirmLinepayPayment(
    { supabase, fetchFn: fetchReturning(okConfirmResponse()), env },
    { orderId: "ORDER-1", transactionId: "TX-1" },
  );
  assertEquals(out.status, 503);
  assertEquals(out.body.code, "PROVIDER_NOT_CONFIGURED");
  assertEquals(supabase.mutations.length, 0);
});

Deno.test("provider timeout → 502, zero mutation", async () => {
  const supabase = makeSupabase(baseReads());
  const out = await confirmLinepayPayment(
    {
      supabase,
      fetchFn: (() => Promise.reject(new Error("timeout"))) as unknown as typeof fetch,
      env,
    },
    { orderId: "ORDER-1", transactionId: "TX-1" },
  );
  assertEquals(out.status, 502);
  assertEquals(out.body.code, "PROVIDER_UNAVAILABLE");
  assertEquals(supabase.mutations.length, 0);
});

Deno.test("provider non-0000 → 402, zero mutation", async () => {
  const supabase = makeSupabase(baseReads());
  const out = await confirmLinepayPayment(
    { supabase, fetchFn: fetchReturning({ returnCode: "1104", returnMessage: "nope" }), env },
    { orderId: "ORDER-1", transactionId: "TX-1" },
  );
  assertEquals(out.status, 402);
  assertEquals(out.body.code, "PROVIDER_DECLINED");
  assertEquals(supabase.mutations.length, 0);
});

Deno.test("amount / currency / orderId mismatch → 409, zero mutation", async () => {
  for (
    const over of [
      { payInfo: [{ amount: 1, currency: "TWD" }] },
      { payInfo: [{ amount: 1200, currency: "JPY" }] },
      { orderId: "ORDER-OTHER" },
      { transactionId: "TX-OTHER" },
    ]
  ) {
    const supabase = makeSupabase(baseReads());
    const out = await confirmLinepayPayment(
      { supabase, fetchFn: fetchReturning(okConfirmResponse(over)), env },
      { orderId: "ORDER-1", transactionId: "TX-1" },
    );
    assertEquals(out.status, 409, JSON.stringify(over));
    assertEquals(out.body.code, "PROVIDER_MISMATCH");
    assertEquals(supabase.mutations.length, 0);
  }
});

Deno.test("happy path creates exactly one subscription + one transaction", async () => {
  const supabase = makeSupabase(baseReads());
  const calls: unknown[] = [];
  const out = await confirmLinepayPayment(
    { supabase, fetchFn: fetchReturning(okConfirmResponse(), calls), env },
    { orderId: "ORDER-1", transactionId: "TX-1" },
  );
  assertEquals(out.status, 200);
  assertEquals(out.body.success, true);
  assertEquals(calls.length, 1);
  const subInserts = supabase.mutations.filter((m: Mutation) => m.table === "member_subscriptions" && m.op === "insert");
  const txInserts = supabase.mutations.filter((m: Mutation) => m.table === "payment_transactions" && m.op === "insert");
  assertEquals(subInserts.length, 1);
  assertEquals(txInserts.length, 1);
  assertEquals((txInserts[0].payload as any).provider_tx_id, "TX-1");
  assertEquals((txInserts[0].payload as any).amount, 1200);
  // user comes from the intent, never from the body
  assertEquals((subInserts[0].payload as any).user_id, "victim-owner");
});


// ---------------------------------------------------------------------------
// REV2 — echo 四欄 fail-closed
// ---------------------------------------------------------------------------
const EXPECTED = { orderId: "ORDER-1", transactionId: "TX-1", amount: 1200, currency: "TWD" };

Deno.test("REV2: diffConfirmEcho flags每一個缺欄（null 不得 fail-open）", () => {
  assertEquals(
    diffConfirmEcho({ orderId: null, transactionId: "TX-1", amount: 1200, currency: "TWD" }, EXPECTED),
    ["orderId"],
  );
  assertEquals(
    diffConfirmEcho({ orderId: "ORDER-1", transactionId: null, amount: 1200, currency: "TWD" }, EXPECTED),
    ["transactionId"],
  );
  assertEquals(
    diffConfirmEcho({ orderId: "ORDER-1", transactionId: "TX-1", amount: null, currency: "TWD" }, EXPECTED),
    ["amount"],
  );
  assertEquals(
    diffConfirmEcho({ orderId: "ORDER-1", transactionId: "TX-1", amount: 1200, currency: null }, EXPECTED),
    ["currency"],
  );
  assertEquals(
    diffConfirmEcho({ orderId: null, transactionId: null, amount: null, currency: null }, EXPECTED).sort(),
    ["amount", "currency", "orderId", "transactionId"],
  );
  assertEquals(diffConfirmEcho({ ...EXPECTED }, EXPECTED), []);
});

Deno.test("REV2: 空 info（provider 回應完全無 echo）→ 409 PROVIDER_MISMATCH, zero mutation", async () => {
  const supabase = makeSupabase(baseReads());
  const out = await confirmLinepayPayment(
    { supabase, fetchFn: fetchReturning({ returnCode: "0000", returnMessage: "Success", info: {} }), env },
    { orderId: "ORDER-1", transactionId: "TX-1" },
  );
  assertEquals(out.status, 409);
  assertEquals(out.body.code, "PROVIDER_MISMATCH");
  assertEquals(supabase.mutations.length, 0);
});

Deno.test("REV2: 逐欄缺漏的 provider echo 全部 409, zero mutation", async () => {
  const overrides: Array<Record<string, unknown>> = [
    { orderId: null },
    { transactionId: null },
    { payInfo: [] },                                      // amount 無來源
    { payInfo: [{ amount: 1200 }] },                      // currency 缺
    { payInfo: [{ amount: "abc", currency: "TWD" }] },    // amount 非數值
  ];
  for (const over of overrides) {
    const supabase = makeSupabase(baseReads());
    const out = await confirmLinepayPayment(
      { supabase, fetchFn: fetchReturning(okConfirmResponse(over)), env },
      { orderId: "ORDER-1", transactionId: "TX-1" },
    );
    assertEquals(out.status, 409, JSON.stringify(over));
    assertEquals(out.body.code, "PROVIDER_MISMATCH", JSON.stringify(over));
    assertEquals(supabase.mutations.length, 0, JSON.stringify(over));
  }
});

// ---------------------------------------------------------------------------
// REV2 — intent status gate
// ---------------------------------------------------------------------------
Deno.test("REV2: 不允許的 intent status → 409 INTENT_STATUS_INVALID, zero mutation, no provider call", async () => {
  for (const status of ["completed", "expired", "failed", "refunded", "", null]) {
    const supabase = makeSupabase(baseReads({ payment_intents: { ...INTENT, status } }));
    const calls: unknown[] = [];
    const out = await confirmLinepayPayment(
      { supabase, fetchFn: fetchReturning(okConfirmResponse(), calls), env },
      { orderId: "ORDER-1", transactionId: "TX-1" },
    );
    assertEquals(out.status, 409, String(status));
    assertEquals(out.body.code, "INTENT_STATUS_INVALID", String(status));
    assertEquals(supabase.mutations.length, 0);
    assertEquals(calls.length, 0);
  }
});

Deno.test("REV2: abandoned intent 仍可救回（allowed status）", async () => {
  const supabase = makeSupabase(baseReads({ payment_intents: { ...INTENT, status: "abandoned" } }));
  const out = await confirmLinepayPayment(
    { supabase, fetchFn: fetchReturning(okConfirmResponse()), env },
    { orderId: "ORDER-1", transactionId: "TX-1" },
  );
  assertEquals(out.status, 200);
  assertEquals(out.body.success, true);
});

// ---------------------------------------------------------------------------
// REV2 — replay 必須綁定同一張已驗證 order，且不得回傳任何 internal id
// ---------------------------------------------------------------------------
const BOUND_SUB = { id: "sub-1", user_id: "victim-owner", plan_id: "plan-1" };

Deno.test("three replays of the same provider transaction → 200 no-op, no second renewal, no id leak", async () => {
  const supabase = makeSupabase(baseReads());
  const out1 = await confirmLinepayPayment(
    { supabase, fetchFn: fetchReturning(okConfirmResponse()), env },
    { orderId: "ORDER-1", transactionId: "TX-1" },
  );
  assertEquals(out1.status, 200);
  const afterFirst = supabase.mutations.length;

  const replayed = makeSupabase(baseReads({
    payment_transactions: { id: "tx-1", subscription_id: "sub-1" },
    member_subscriptions__single: BOUND_SUB,
  }));
  const calls: unknown[] = [];
  for (let i = 0; i < 3; i++) {
    const out = await confirmLinepayPayment(
      { supabase: replayed, fetchFn: fetchReturning(okConfirmResponse(), calls), env },
      { orderId: "ORDER-1", transactionId: "TX-1" },
    );
    assertEquals(out.status, 200);
    assertEquals(out.body.replay, true);
    assertEquals(out.body.idempotent, true);
    // Step 3 不得回傳任何 user / plan / subscription / transaction id
    assertEquals(Object.keys(out.body).sort(), ["idempotent", "replay", "success"]);
    assertEquals(JSON.stringify(out.body).includes("sub-1"), false);
    assertEquals(JSON.stringify(out.body).includes("victim-owner"), false);
  }
  assertEquals(replayed.mutations.length, 0, "replays must not mutate");
  assertEquals(calls.length, 0, "replays must not re-confirm with the provider");
  assert(afterFirst > 0);
});

Deno.test("REV2: 別人的 transactionId 拿到自己的 order → 409 REPLAY_ORDER_MISMATCH, zero mutation", async () => {
  // 攻擊者的 intent（自己的 order），卻附上屬於受害者訂閱的 transactionId。
  const attackerIntent = { ...INTENT, trade_no: "ORDER-ATTACKER", user_id: "attacker", plan_id: "plan-1" };
  const supabase = makeSupabase(baseReads({
    payment_intents: attackerIntent,
    payment_transactions: { id: "tx-victim", subscription_id: "sub-victim" },
    member_subscriptions__single: { id: "sub-victim", user_id: "victim-owner", plan_id: "plan-1" },
  }));
  const calls: unknown[] = [];
  const out = await confirmLinepayPayment(
    { supabase, fetchFn: fetchReturning(okConfirmResponse(), calls), env },
    { orderId: "ORDER-ATTACKER", transactionId: "TX-VICTIM" },
  );
  assertEquals(out.status, 409);
  assertEquals(out.body.code, "REPLAY_ORDER_MISMATCH");
  assertEquals(JSON.stringify(out.body).includes("sub-victim"), false);
  assertEquals(JSON.stringify(out.body).includes("victim-owner"), false);
  assertEquals(supabase.mutations.length, 0);
  assertEquals(calls.length, 0);
});

Deno.test("REV2: 同 user 不同 plan 的 transaction 不得被當成本 order 的 replay", async () => {
  const supabase = makeSupabase(baseReads({
    payment_transactions: { id: "tx-9", subscription_id: "sub-9" },
    member_subscriptions__single: { id: "sub-9", user_id: "victim-owner", plan_id: "plan-OTHER" },
  }));
  const out = await confirmLinepayPayment(
    { supabase, fetchFn: fetchReturning(okConfirmResponse()), env },
    { orderId: "ORDER-1", transactionId: "TX-1" },
  );
  assertEquals(out.status, 409);
  assertEquals(out.body.code, "REPLAY_ORDER_MISMATCH");
  assertEquals(supabase.mutations.length, 0);
});

Deno.test("REV2: transaction 無 subscription 綁定 → 409 REPLAY_UNVERIFIABLE, zero mutation", async () => {
  const supabase = makeSupabase(baseReads({
    payment_transactions: { id: "tx-orphan", subscription_id: null },
  }));
  const out = await confirmLinepayPayment(
    { supabase, fetchFn: fetchReturning(okConfirmResponse()), env },
    { orderId: "ORDER-1", transactionId: "TX-1" },
  );
  assertEquals(out.status, 409);
  assertEquals(out.body.code, "REPLAY_UNVERIFIABLE");
  assertEquals(supabase.mutations.length, 0);
});

Deno.test("REV2: replay 綁定的 subscription 查無此列 → 409 REPLAY_ORDER_MISMATCH, zero mutation（不得 fail-open 成 200）", async () => {
  const supabase = makeSupabase(baseReads({
    payment_transactions: { id: "tx-1", subscription_id: "sub-1" },
    member_subscriptions__single: undefined,
  }));
  const out = await confirmLinepayPayment(
    { supabase, fetchFn: fetchReturning(okConfirmResponse()), env },
    { orderId: "ORDER-1", transactionId: "TX-1" },
  );
  assertEquals(out.status, 409);
  assertEquals(out.body.code, "REPLAY_ORDER_MISMATCH");
  assertEquals(supabase.mutations.length, 0);
});
