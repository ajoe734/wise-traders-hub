// Post-deploy verification for all checkup-* edge functions.
//
// Hits each function with:
//   1. OPTIONS preflight  → expects 200/204 + CORS headers
//   2. Invalid POST body  → expects structured error (code + message)
//      AND x-correlation-id echo
//
// Outputs a Markdown summary table to stdout and to /mnt/documents
// (when writable) so it can be attached to a deploy log.
//
// Usage:
//   deno run --allow-net --allow-env --allow-read --allow-write \
//     scripts/verify-checkup-deploy.ts
//
//   # or test against a custom env:
//   SUPABASE_URL=https://xxx.supabase.co \
//   SUPABASE_ANON_KEY=eyJ... \
//     deno run --allow-net --allow-env scripts/verify-checkup-deploy.ts

import "https://deno.land/std@0.224.0/dotenv/load.ts";

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") ||
  Deno.env.get("VITE_SUPABASE_URL") ||
  "";
const SUPABASE_ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ||
  Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") ||
  "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_ANON_KEY (or VITE_ equivalents).");
  Deno.exit(2);
}

const FUNCTIONS = [
  "checkup-analyst-reports",
  "checkup-analyze",
  "checkup-brain",
  "checkup-calendar",
  "checkup-calendar-cron",
  "checkup-ecpay-callback",
  "checkup-institutional",
  "checkup-knowledge",
  "checkup-mops-announcements",
  "checkup-mops-revenue",
  "checkup-parse",
  "checkup-predict-events",
  "checkup-report",
  "checkup-research",
  "checkup-research-extract",
  "checkup-sparkline",
  "checkup-telemetry",
  "checkup-twse",
  "checkup-warrant-sync",
  "create-checkup-ecpay-order",
  "create-checkup-remittance",
];

const KNOWN_CODES = new Set([
  "INVALID_INPUT", "AUTH_REQUIRED", "AUTH_FAILED", "FORBIDDEN", "NOT_FOUND",
  "METHOD_NOT_ALLOWED", "QUOTA_EXCEEDED", "RATE_LIMITED", "UPSTREAM_ERROR",
  "TIMEOUT", "INTERNAL_ERROR",
]);

interface Row {
  fn: string;
  preflight: { status: number; cors: boolean; allowH: string };
  invalid: {
    status: number;
    cors: boolean;
    cidOk: boolean;
    contentType: string;
    code: string | null;
    codeKnown: boolean;
    message: string | null;
    snippet: string;
  };
  ok: boolean;
}

function authHeaders(extra: HeadersInit = {}): HeadersInit {
  return {
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    apikey: SUPABASE_ANON_KEY,
    ...extra,
  };
}

async function checkPreflight(fn: string): Promise<Row["preflight"]> {
  const url = `${SUPABASE_URL}/functions/v1/${fn}`;
  const res = await fetch(url, {
    method: "OPTIONS",
    headers: {
      Origin: "https://example.com",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization, content-type, x-correlation-id",
    },
  });
  await res.text();
  const origin = res.headers.get("access-control-allow-origin");
  const allowH = res.headers.get("access-control-allow-headers") || "";
  return { status: res.status, cors: origin === "*", allowH };
}

async function checkInvalid(fn: string): Promise<Row["invalid"]> {
  const url = `${SUPABASE_URL}/functions/v1/${fn}`;
  const cid = `verify-${crypto.randomUUID()}`;
  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders({
      "content-type": "application/json",
      "x-correlation-id": cid,
    }),
    body: JSON.stringify({ __verify__: true }),
  });
  const text = await res.text();
  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  const cors = res.headers.get("access-control-allow-origin") === "*";
  const cidEcho = res.headers.get("x-correlation-id");
  const cidOk = cidEcho === cid;
  let code: string | null = null;
  let message: string | null = null;
  if (contentType.includes("application/json")) {
    try {
      const body = JSON.parse(text);
      if (typeof body?.code === "string") code = body.code;
      if (typeof body?.message === "string") message = body.message;
    } catch {/* ignore */}
  }
  return {
    status: res.status,
    cors,
    cidOk,
    contentType: contentType.split(";")[0] || "",
    code,
    codeKnown: code ? KNOWN_CODES.has(code) : false,
    message,
    snippet: text.slice(0, 120).replace(/\s+/g, " "),
  };
}

async function verify(fn: string): Promise<Row> {
  const [preflight, invalid] = await Promise.all([
    checkPreflight(fn).catch((e) => ({ status: 0, cors: false, allowH: `ERR:${e}` })),
    checkInvalid(fn).catch((e) => ({
      status: 0, cors: false, cidOk: false, contentType: "",
      code: null, codeKnown: false, message: null, snippet: `ERR:${e}`,
    })),
  ]);
  const preflightOk = (preflight.status === 200 || preflight.status === 204) && preflight.cors;
  const invalidOk =
    invalid.status > 0 &&
    invalid.cors &&
    invalid.cidOk &&
    // either it parsed a known code, OR it returned a non-JSON callback body (e.g. ecpay text)
    (invalid.code === null ? !invalid.contentType.includes("application/json") : invalid.codeKnown);
  return { fn, preflight, invalid, ok: preflightOk && invalidOk };
}

function fmtSummary(rows: Row[]): string {
  const lines: string[] = [];
  lines.push(`# Checkup edge-function deploy verification`);
  lines.push("");
  lines.push(`- Endpoint: ${SUPABASE_URL}`);
  lines.push(`- Run at: ${new Date().toISOString()}`);
  lines.push(`- Functions: ${rows.length}`);
  const passed = rows.filter((r) => r.ok).length;
  lines.push(`- Result: **${passed}/${rows.length} passed**`);
  lines.push("");
  lines.push("| Function | Preflight | Invalid POST | x-corr-id | Code | Notes |");
  lines.push("|---|---|---|---|---|---|");
  for (const r of rows) {
    const pre = `${r.preflight.status}${r.preflight.cors ? " ✓" : " ✗CORS"}`;
    const inv = `${r.invalid.status}${r.invalid.cors ? " ✓" : " ✗CORS"}`;
    const cid = r.invalid.cidOk ? "✓" : "✗";
    const code = r.invalid.code
      ? `\`${r.invalid.code}\`${r.invalid.codeKnown ? "" : " ⚠unknown"}`
      : (r.invalid.contentType.includes("application/json") ? "—" : `(${r.invalid.contentType || "no-ct"})`);
    const notes: string[] = [];
    if (r.invalid.message) notes.push(r.invalid.message.slice(0, 60));
    else if (r.invalid.snippet) notes.push(r.invalid.snippet.slice(0, 60));
    lines.push(`| \`${r.fn}\` | ${pre} | ${inv} | ${cid} | ${code} | ${notes.join(" / ")} |`);
  }
  lines.push("");
  const failures = rows.filter((r) => !r.ok);
  if (failures.length) {
    lines.push(`## ❌ Failures (${failures.length})`);
    for (const r of failures) {
      lines.push(`- **${r.fn}** — preflight=${r.preflight.status}/cors=${r.preflight.cors}, ` +
        `invalid=${r.invalid.status}/cors=${r.invalid.cors}/cid=${r.invalid.cidOk}/code=${r.invalid.code}`);
    }
  } else {
    lines.push(`## ✅ All checks passed`);
  }
  return lines.join("\n");
}

const rows: Row[] = [];
for (const fn of FUNCTIONS) {
  Deno.stderr.writeSync(new TextEncoder().encode(`→ ${fn}\n`));
  rows.push(await verify(fn));
}

const report = fmtSummary(rows);
console.log(report);

// Best-effort: persist a copy to /mnt/documents for the deploy log.
try {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = `/mnt/documents/checkup-deploy-verify-${stamp}.md`;
  await Deno.writeTextFile(outPath, report);
  Deno.stderr.writeSync(new TextEncoder().encode(`\nReport saved: ${outPath}\n`));
} catch {/* not writable in this environment, that's fine */}

const failed = rows.filter((r) => !r.ok).length;
Deno.exit(failed === 0 ? 0 : 1);
