import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkupRenewalUrl, renewalUrl } from "./routes.ts";

Deno.test("renewalUrl 產出公開結帳路徑", () => {
  assertEquals(renewalUrl("foo", "bar"), "/checkout/foo/bar");
});

Deno.test("renewalUrl 絕不產出 /app/ 路徑", () => {
  assertEquals(renewalUrl("foo", "bar").includes("/app/"), false);
});

Deno.test("renewalUrl 支援 baseUrl 且不重複斜線", () => {
  assertEquals(
    renewalUrl("foo", "bar", { baseUrl: "https://legendflow.tw/" }),
    "https://legendflow.tw/checkout/foo/bar",
  );
});

Deno.test("renewalUrl 附加 query 並略過空值", () => {
  assertEquals(
    renewalUrl("foo", "bar", { query: { cycle: "yearly", utm_source: "line", x: "" } }),
    "/checkout/foo/bar?cycle=yearly&utm_source=line",
  );
});

Deno.test("renewalUrl 對 slug / planId 編碼", () => {
  assertEquals(renewalUrl("a b", "p/1"), "/checkout/a%20b/p%2F1");
});

Deno.test("renewalUrl 缺參數丟錯", () => {
  assertThrows(() => renewalUrl("", "bar"));
  assertThrows(() => renewalUrl("foo", ""));
});

Deno.test("checkupRenewalUrl 產出 /checkout/checkup/:planId", () => {
  assertEquals(
    checkupRenewalUrl("p1", { baseUrl: "https://legendflow.tw", query: { cycle: "monthly" } }),
    "https://legendflow.tw/checkout/checkup/p1?cycle=monthly",
  );
  assertThrows(() => checkupRenewalUrl(""));
});
