// deno-lint-ignore-file no-explicit-any
/**
 * weekly-journal-export — 權限守衛的 exact evidence（SECURITY_ACCESS_FIX REV2 item 2）。
 *
 * 兩層證據：
 *  A. 行為層：以 spy 注入 resolveExportCaller 的依賴，證明
 *     anon → 401、一般訂閱者 → 403 FORBIDDEN_ADMIN、admin / cron → 放行，
 *     且被拒絕的路徑「副作用計數 == 0」（沒有任何 DB / storage / notification 呼叫）。
 *  B. 結構層：靜態讀 index.ts 原始碼，證明 resolveExportCaller 出現在
 *     serviceClient() / storage.upload / notifications.insert / storage.remove
 *     之前 —— 即權限失敗時不可能已經產生副作用。
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AuthError } from "../_shared/authGuard.ts";
import { resolveExportCaller } from "../_shared/exportAuthz.ts";

Deno.env.set("AUTH_EVENT_LOGGING", "0");

/** 記錄所有「權限通過後才被允許」的副作用。任何拒絕路徑都必須維持 0。 */
function makeSideEffectSpy() {
  const calls: string[] = [];
  return {
    calls,
    serviceClient: () => {
      calls.push("serviceClient");
      return {
        from: () => ({ insert: () => { calls.push("db.insert"); return Promise.resolve({ error: null }); } }),
        storage: {
          from: () => ({
            upload: () => { calls.push("storage.upload"); return Promise.resolve({ error: null }); },
            remove: () => { calls.push("storage.remove"); return Promise.resolve({ error: null }); },
            list: () => { calls.push("storage.list"); return Promise.resolve({ data: [] }); },
          }),
        },
      };
    },
  };
}

/** 完整重演 index.ts 的守衛序：先 authz，通過才碰 serviceClient。 */
async function runGuardedHandler(req: Request, deps: any, spy: ReturnType<typeof makeSideEffectSpy>) {
  try {
    const caller = await resolveExportCaller(req, deps);
    spy.serviceClient(); // 只有通過守衛才會走到這一行
    return { status: 200, mode: caller.mode };
  } catch (e) {
    if (e instanceof AuthError) return { status: e.status, code: e.code, error: e.message };
    throw e;
  }
}

const noCron = () => { throw new AuthError(401, "NO_CRON_KEY", "missing cron key"); };
const okCron = () => {};

// ---------------------------------------------------------------------------
// A. 行為層 evidence
// ---------------------------------------------------------------------------
Deno.test("anon（無 JWT、無 cron key）→ 401，副作用 0", async () => {
  const spy = makeSideEffectSpy();
  const out = await runGuardedHandler(new Request("http://x", { method: "POST" }), {
    requireCronKeyFn: noCron,
    requireCallerFn: () => Promise.reject(new AuthError(401, "UNAUTHENTICATED", "missing bearer token")),
    isCompanyAdminFn: () => Promise.resolve(true), // 即使 admin 檢查會放行也到不了
  }, spy);
  assertEquals(out.status, 401);
  assertEquals(out.code, "UNAUTHENTICATED");
  assertEquals(spy.calls, []);
});

Deno.test("一般登入訂閱者（非 admin）→ 403 FORBIDDEN_ADMIN，副作用 0", async () => {
  const spy = makeSideEffectSpy();
  const adminChecks: string[] = [];
  const out = await runGuardedHandler(new Request("http://x", { method: "POST" }), {
    requireCronKeyFn: noCron,
    requireCallerFn: () => Promise.resolve("subscriber-uid"),
    isCompanyAdminFn: (uid: string) => { adminChecks.push(uid); return Promise.resolve(false); },
  }, spy);
  assertEquals(out.status, 403);
  assertEquals(out.code, "FORBIDDEN_ADMIN");
  assertEquals(adminChecks, ["subscriber-uid"], "必須真的查過角色，不是靠 JWT claim");
  assertEquals(spy.calls, []);
});

Deno.test("expert / analyst 身分（非 company_admin）同樣 403，副作用 0", async () => {
  for (const uid of ["mentor-uid", "analyst-uid"]) {
    const spy = makeSideEffectSpy();
    const out = await runGuardedHandler(new Request("http://x", { method: "POST" }), {
      requireCronKeyFn: noCron,
      requireCallerFn: () => Promise.resolve(uid),
      isCompanyAdminFn: () => Promise.resolve(false),
    }, spy);
    assertEquals(out.status, 403, uid);
    assertEquals(spy.calls, [], uid);
  }
});

Deno.test("偽造 cron key → 落回 user lane，仍需 admin；非 admin 403，副作用 0", async () => {
  const spy = makeSideEffectSpy();
  const out = await runGuardedHandler(
    new Request("http://x", { method: "POST", headers: { "X-Cron-Key": "wrong-key" } }),
    {
      requireCronKeyFn: () => { throw new AuthError(401, "BAD_CRON_KEY", "bad key"); },
      requireCallerFn: () => Promise.resolve("subscriber-uid"),
      isCompanyAdminFn: () => Promise.resolve(false),
    },
    spy,
  );
  assertEquals(out.status, 403);
  assertEquals(spy.calls, []);
});

Deno.test("正確 cron key → 放行為 cron caller，且不查使用者角色", async () => {
  const spy = makeSideEffectSpy();
  let callerFnUsed = false;
  const out = await runGuardedHandler(
    new Request("http://x", { method: "POST", headers: { "X-Cron-Key": "right" } }),
    {
      requireCronKeyFn: okCron,
      requireCallerFn: () => { callerFnUsed = true; return Promise.resolve("x"); },
      isCompanyAdminFn: () => Promise.resolve(false),
    },
    spy,
  );
  assertEquals(out.status, 200);
  assertEquals(out.mode, "cron");
  assertEquals(callerFnUsed, false);
  assertEquals(spy.calls, ["serviceClient"]);
});

Deno.test("company_admin → 放行為 admin caller", async () => {
  const spy = makeSideEffectSpy();
  const out = await runGuardedHandler(new Request("http://x", { method: "POST" }), {
    requireCronKeyFn: noCron,
    requireCallerFn: () => Promise.resolve("admin-uid"),
    isCompanyAdminFn: () => Promise.resolve(true),
  }, spy);
  assertEquals(out.status, 200);
  assertEquals(out.mode, "admin");
  assertEquals(spy.calls, ["serviceClient"]);
});

// ---------------------------------------------------------------------------
// B. 結構層 evidence：授權必須早於所有副作用
// ---------------------------------------------------------------------------
Deno.test("index.ts 中 resolveExportCaller 早於任何副作用", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const guardAt = src.indexOf("await resolveExportCaller(req)");
  assert(guardAt > 0, "handler 必須呼叫 resolveExportCaller");

  for (const sideEffect of [
    "const supabase = serviceClient();",
    "await supabase.storage",
    'supabase.from("notifications").insert(notifRows)',
    'supabase.storage.from("journal-exports").remove(toDelete)',
  ]) {
    const at = src.indexOf(sideEffect);
    assert(at > 0, `找不到副作用標記: ${sideEffect}`);
    assert(at > guardAt, `副作用 ${sideEffect} 出現在授權守衛之前`);
  }

  // 守衛失敗必須直接 return，不得往下 fall-through。
  const guardBlock = src.slice(guardAt, guardAt + 600);
  assert(guardBlock.includes("return new Response"), "AuthError 必須直接 return");
  assert(guardBlock.includes("status: e.status"), "必須沿用 401/403 狀態碼");
});

Deno.test("force 判定在 storage/notification 副作用之前", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const decideAt = src.indexOf("decideForce(");
  assert(decideAt > 0);
  for (const sideEffect of ['await supabase.storage', 'supabase.from("notifications").insert(notifRows)']) {
    assert(src.indexOf(sideEffect) > decideAt, `force gate 必須早於 ${sideEffect}`);
  }
});
