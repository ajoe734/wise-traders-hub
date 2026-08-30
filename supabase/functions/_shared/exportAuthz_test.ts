// deno-lint-ignore-file no-explicit-any
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canonicalBlockingRisks,
  computeRiskAckHash,
  decideForce,
  resolveExportCaller,
} from "./exportAuthz.ts";
import { AuthError } from "./authGuard.ts";
import type { ExportRiskReport } from "./journalExportCore.ts";

Deno.env.set("AUTH_EVENT_LOGGING", "0");

const req = () => new Request("https://x.test/weekly-journal-export", { method: "POST" });

const cronOk = () => {};
const cronFail = () => {
  throw new AuthError(403, "FORBIDDEN_CRON", "no key");
};

function report(over: Partial<ExportRiskReport> = {}): ExportRiskReport {
  return {
    issues: [
      {
        code: "QTY_INVALID",
        severity: "block",
        expert_id: "e1",
        expert_name: "老周",
        instrument: "2330",
        rowIds: ["r2", "r1"],
        detail: "x",
      },
      {
        code: "PENDING_IN_EXPORT",
        severity: "warn",
        expert_id: "e1",
        expert_name: "老周",
        instrument: "2330",
        rowIds: ["r9"],
        detail: "y",
      },
    ],
    blocked: true,
    summary: { block: 1, warn: 1 },
    openingBalancesProvided: true,
    ...over,
  };
}

// ── caller resolution ──────────────────────────────────────────────────────
Deno.test("cron key alone resolves as cron caller", async () => {
  const c = await resolveExportCaller(req(), {
    requireCronKeyFn: cronOk,
    requireCallerFn: () => Promise.reject(new Error("should not run")),
    isCompanyAdminFn: () => Promise.resolve(false),
  });
  assertEquals(c, { mode: "cron", userId: null });
});

Deno.test("ordinary authenticated user is rejected with 403 FORBIDDEN_ADMIN", async () => {
  const err = await assertRejects(
    () =>
      resolveExportCaller(req(), {
        requireCronKeyFn: cronFail,
        requireCallerFn: () => Promise.resolve("plain-user"),
        isCompanyAdminFn: () => Promise.resolve(false),
      }),
    AuthError,
  );
  assertEquals(err.status, 403);
  assertEquals(err.code, "FORBIDDEN_ADMIN");
});

Deno.test("anonymous caller is rejected with 401", async () => {
  const err = await assertRejects(
    () =>
      resolveExportCaller(req(), {
        requireCronKeyFn: cronFail,
        requireCallerFn: () => Promise.reject(new AuthError(401, "UNAUTHENTICATED", "no jwt")),
        isCompanyAdminFn: () => Promise.resolve(true),
      }),
    AuthError,
  );
  assertEquals(err.status, 401);
});

Deno.test("company_admin resolves as admin caller", async () => {
  const c = await resolveExportCaller(req(), {
    requireCronKeyFn: cronFail,
    requireCallerFn: () => Promise.resolve("admin-1"),
    isCompanyAdminFn: () => Promise.resolve(true),
  });
  assertEquals(c, { mode: "admin", userId: "admin-1" });
});

// ── risk ack hash ──────────────────────────────────────────────────────────
Deno.test("canonicalBlockingRisks keeps only block severity and sorts deterministically", () => {
  const c = canonicalBlockingRisks(report());
  assertEquals(c.length, 1);
  assertEquals((c[0] as any).code, "QTY_INVALID");
  assertEquals((c[0] as any).rowIds, ["r1", "r2"]);
});

Deno.test("hash is stable for identical risks and changes when risks change", async () => {
  const a = await computeRiskAckHash("2026-08-24", report());
  const b = await computeRiskAckHash("2026-08-24", report());
  assertEquals(a, b);
  const shifted = report({
    issues: [{ ...report().issues[0], rowIds: ["r1", "r2", "r3"] }],
  });
  const c = await computeRiskAckHash("2026-08-24", shifted);
  assertEquals(c === a, false);
  const otherWeek = await computeRiskAckHash("2026-08-31", report());
  assertEquals(otherWeek === a, false);
});

// ── force decision ─────────────────────────────────────────────────────────
const admin = { mode: "admin", userId: "a1" } as const;
const cron = { mode: "cron", userId: null } as const;

Deno.test("no blocking risk → export proceeds, forced=false", () => {
  assertEquals(
    decideForce({ caller: admin, force: true, riskAckHash: null, expectedHash: "h", blocked: false }),
    { allowed: true, forced: false },
  );
});

Deno.test("blocked without force → 409 EXPORT_BLOCKED and reveals the expected hash", () => {
  const d = decideForce({ caller: admin, force: false, riskAckHash: null, expectedHash: "hash1", blocked: true });
  assertEquals(d.allowed, false);
  assertEquals((d as any).code, "EXPORT_BLOCKED");
  assertEquals((d as any).expected_risk_ack_hash, "hash1");
});

Deno.test("bare force:true without hash no longer bypasses the gate", () => {
  const d = decideForce({ caller: admin, force: true, riskAckHash: null, expectedHash: "hash1", blocked: true });
  assertEquals(d.allowed, false);
  assertEquals((d as any).code, "RISK_ACK_MISSING");
});

Deno.test("stale / wrong hash is rejected", () => {
  const d = decideForce({ caller: admin, force: true, riskAckHash: "deadbeef", expectedHash: "hash1", blocked: true });
  assertEquals(d.allowed, false);
  assertEquals((d as any).code, "RISK_ACK_MISMATCH");
});

Deno.test("cron may never force", () => {
  const d = decideForce({ caller: cron, force: true, riskAckHash: "hash1", expectedHash: "hash1", blocked: true });
  assertEquals(d.allowed, false);
  assertEquals((d as any).code, "FORCE_REQUIRES_ADMIN");
  assertEquals((d as any).status, 403);
});

Deno.test("matching hash from an admin allows the forced export", () => {
  assertEquals(
    decideForce({ caller: admin, force: true, riskAckHash: "HASH1", expectedHash: "hash1", blocked: true }),
    { allowed: true, forced: true },
  );
});
