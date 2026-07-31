import { assertEquals, assertThrows } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  accountNotificationsUrl,
  accountUrl,
  adminCapitalUrl,
  adminSignalsUrl,
  assertNotificationLink,
  buildNotificationRow,
  checkupRenewalUrl,
  checkupUrl,
  companyUrl,
  expertDetailUrl,
  renewalUrl,
  validateNotificationLink,
} from "./routes.ts";

// ── renewal ────────────────────────────────────────────────────────────────
Deno.test("renewalUrl 指向公開結帳路徑", () => {
  assertEquals(renewalUrl("foo", "p1"), "/checkout/foo/p1");
  assertEquals(checkupRenewalUrl("p1"), "/checkout/checkup/p1");
});

// ── notification link builders ─────────────────────────────────────────────
Deno.test("expertDetailUrl 無 slug 時退回通知中心", () => {
  assertEquals(expertDetailUrl("laozhou"), "/app/expert/laozhou");
  assertEquals(expertDetailUrl(null), "/account/notifications");
  assertEquals(expertDetailUrl(""), "/account/notifications");
});

Deno.test("checkupUrl 組出 job / autorun query", () => {
  assertEquals(checkupUrl(), "/holding-checkup");
  assertEquals(checkupUrl({ autorun: true }), "/holding-checkup?autorun=1");
  assertEquals(checkupUrl({ jobId: "abc" }), "/holding-checkup?job=abc");
});

Deno.test("admin 連結一定帶 expertSlug（route 是 /admin/:expertSlug/...）", () => {
  assertEquals(adminSignalsUrl("benny"), "/admin/benny/signals");
  assertEquals(adminCapitalUrl("benny"), "/admin/benny/profile#capital");
  // 無 slug 不可產生會 404 的 /admin/signals
  assertEquals(adminSignalsUrl(null), "/account/notifications");
  assertEquals(adminCapitalUrl(undefined), "/account/notifications");
});

Deno.test("companyUrl 只接受白名單頁面", () => {
  assertEquals(companyUrl("journals-export"), "/company/journals-export");
  assertThrows(() => companyUrl("nope" as never));
});

Deno.test("accountUrl / accountNotificationsUrl 為既有 route", () => {
  assertEquals(accountUrl(), "/app/account");
  assertEquals(accountNotificationsUrl(), "/account/notifications");
});

// ── validation ─────────────────────────────────────────────────────────────
Deno.test("validateNotificationLink 擋掉所有已知 404 樣式", () => {
  assertEquals(validateNotificationLink("/app/expert/x"), null);
  assertEquals(validateNotificationLink(""), "empty");
  assertEquals(validateNotificationLink("https://x.co/file.md"), "absolute_url");
  assertEquals(validateNotificationLink("app/account"), "not_relative");
  assertEquals(validateNotificationLink("//evil.com"), "double_slash");
  assertEquals(validateNotificationLink("/me/signals"), "legacy_me_path");
  assertEquals(validateNotificationLink("/admin/signals"), "admin_missing_slug");
  assertEquals(validateNotificationLink("/admin/profile#capital"), "admin_missing_slug");
  // 帶 slug 的 admin 路徑合法
  assertEquals(validateNotificationLink("/admin/benny/signals"), null);
});

Deno.test("assertNotificationLink 對非法連結丟錯", () => {
  assertEquals(assertNotificationLink("/holding-checkup?autorun=1"), "/holding-checkup?autorun=1");
  assertThrows(() => assertNotificationLink("/admin/signals"));
  assertThrows(() => assertNotificationLink("https://example.com/a.zip"));
});

// ── payload builder ────────────────────────────────────────────────────────
Deno.test("buildNotificationRow 產生驗證過的 payload", () => {
  const row = buildNotificationRow({
    userId: "u1", title: "t", body: "b", type: "warning", link: adminSignalsUrl("benny"),
  });
  assertEquals(row, {
    user_id: "u1", title: "t", body: "b", type: "warning", link: "/admin/benny/signals",
  });
});

Deno.test("buildNotificationRow 預設 type=info、link 可為空", () => {
  const row = buildNotificationRow({ userId: "u1", title: "t", body: "b" });
  assertEquals(row.type, "info");
  assertEquals(row.link, null);
});

Deno.test("signed URL 只能放 downloadUrl，不可放 link", () => {
  const signed = "https://x.supabase.co/storage/v1/object/sign/a.md?token=t";
  const row = buildNotificationRow({
    userId: "u1", title: "t", body: "b", link: companyUrl("journals-export"), downloadUrl: signed,
  });
  assertEquals(row.link, "/company/journals-export");
  assertEquals(row.download_url, signed);
  assertThrows(() => buildNotificationRow({ userId: "u1", title: "t", body: "b", link: signed }));
});

Deno.test("buildNotificationRow 需要 userId", () => {
  assertThrows(() => buildNotificationRow({ userId: "", title: "t", body: "b" }));
});
