// Real @supabase/supabase-js proof against PostgREST bound to a disposable
// clone. Run with: bun db/r1/c/SB/sb_supabase_js_proof.mjs <port> <jwt-secret>
// No production endpoint is ever contacted.
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";

const port = process.argv[2] ?? "3999";
const secret = process.argv[3] ?? "clone-only-rehearsal-jwt-secret-0123456789abcdef";
const url = `http://127.0.0.1:${port}`;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (role) => {
  const p = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role, exp: 4102444800 })}`;
  return `${p}.${createHmac("sha256", secret).update(p).digest("base64url")}`;
};
// PostgREST serves at "/" while supabase-js addresses "/rest/v1"; strip the
// prefix in a custom fetch. Everything below is still real HTTP through the
// real supabase-js client (headers, auth, error decoding all unchanged).
const stripFetch = (input, init) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  u.pathname = u.pathname.replace(/^\/rest\/v1/, "");
  return fetch(u.toString(), init);
};
const client = (role) =>
  createClient(url, jwt(role), {
    auth: { persistSession: false },
    global: { fetch: stripFetch },
  });

const rows = [];
const chk = (id, ok, note) => rows.push([ok ? "PASS" : "FAIL", id, note]);

{
  const { data, error } = await client("service_role").rpc("bsr_admission_status");
  chk("JS-01 service_role rpc ok", !error && data && typeof data.blocked === "boolean",
    error ? error.message : `blocked=${data?.blocked} version=${data?.version}`);
}
for (const role of ["anon", "authenticated"]) {
  const { error } = await client(role).rpc("bsr_admission_status");
  chk(`JS-02 ${role} denied`, !!error && error.code === "42501",
    error ? `${error.code} ${error.message}` : "unexpected success");
}
{
  const { error } = await client("service_role")
    .schema("private_bsr").rpc("gate_blocked");
  chk("JS-03 private_bsr unreachable via js", !!error,
    error ? `${error.code} ${error.message}` : "unexpected success");
}
{
  const { error } = await client("anon").from("tw_bsr_sync_queue").insert({
    stock_id: "9999", trade_date: "2026-08-17", status: "pending",
  });
  chk("JS-04 anon cannot insert queue", !!error,
    error ? `${error.code} ${error.message}` : "unexpected success");
}

for (const [ok, id, note] of rows) console.log(`${ok} ${id}  -- ${note}`);
const fails = rows.filter((r) => r[0] === "FAIL").length;
console.log(`JS SUMMARY pass=${rows.length - fails} fail=${fails}`);
process.exit(fails ? 1 : 0);
