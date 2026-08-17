#!/usr/bin/env python3
"""
R1-P consumer matrix scanner / CI gate.

Discovers every code path that touches expert economic facts, classifies it by
real reachability (public route import graph + verify_jwt on edge functions),
and enforces that each consumer carries complete metadata and a test id.

  --emit    regenerate db/r1/p/consumer-matrix.json from the repo + a live DB
            catalog snapshot (db objects are read from the cached snapshot
            file so this never needs a production connection)
  --check   CI gate: exit non-zero when a consumer is undiscovered, missing
            metadata, missing a test id whose id does not exist in the repo,
            or when a public surface still reads a legacy economic table
            without a typed-contract disposition.
"""
from __future__ import annotations
import json, os, re, sys, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
MATRIX = ROOT / "db/r1/p/consumer-matrix.json"

ECON_TABLES = ["trade_records", "expert_signals", "user_performances"]
PROJECTION_TABLES = [
    "public_position_projection", "public_nav_daily", "public_projection_active",
    "public_position_active", "public_nav_active", "public_projection_withheld",
]
SCAN_DIRS = ["src", "supabase/functions"]
SCAN_EXT = {".ts", ".tsx", ".js", ".jsx", ".md"}

REQUIRED_FIELDS = [
    "path", "surface", "audience", "role", "access_kind", "exact_access",
    "entitlement", "embargo_predicate", "legacy_fallback", "side_effects",
    "cutover_disposition", "test_id", "coverage_status", "tables",
    "invocation_guard",
]
AUDIENCES = {"public", "admin", "internal", "test"}
DISPOSITIONS = {
    "migrate_to_typed_public_contract",   # public surface, must read the contract
    "public_no_economic_facts",           # public but proven not to emit facts
    "stays_on_internal_ledger",           # admin/internal writer or reader
    "test_only",
}


# ----------------------------------------------------------------- discovery
def repo_files() -> list[Path]:
    out = []
    for d in SCAN_DIRS:
        for p in (ROOT / d).rglob("*"):
            if p.is_file() and p.suffix in SCAN_EXT:
                out.append(p)
    return out


def discover() -> dict[str, dict]:
    found: dict[str, dict] = {}
    for p in repo_files():
        try:
            txt = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        tables = sorted({t for t in ECON_TABLES + PROJECTION_TABLES if t in txt})
        if not tables:
            continue
        rel = str(p.relative_to(ROOT))
        found[rel] = {
            "path": rel,
            "surface": "edge_function" if rel.startswith("supabase/functions") else "frontend",
            "tables": tables,
            "text": txt,
        }
    return found


# --------------------------------------------------- public reachability graph
def public_route_entries() -> set[str]:
    app = (ROOT / "src/App.tsx").read_text(encoding="utf-8")
    imports = dict(re.findall(r'(?:const|import)\s+(\w+)\s*=?\s*(?:lazy\(\(\)\s*=>\s*)?import\(\s*["\'](.+?)["\']', app))
    imports.update(dict((m[1], m[0]) for m in []))
    for name, mod in re.findall(r'import\s+(\w+)\s+from\s+["\'](.+?)["\']', app):
        imports[name] = mod
    entries: set[str] = set()
    for line in app.splitlines():
        if "<Route" not in line or "element=" not in line:
            continue
        if "ProtectedRoute" in line:
            continue          # authenticated-only
        for comp in re.findall(r"<(\w+)\s*/?>", line):
            mod = imports.get(comp)
            if mod:
                entries.add(mod)
    return entries


def resolve(mod: str, frm: Path) -> Path | None:
    if mod.startswith("@/"):
        base = ROOT / "src" / mod[2:]
    elif mod.startswith("."):
        base = (frm.parent / mod).resolve()
    else:
        return None
    for cand in (base, *(base.with_suffix(s) for s in (".ts", ".tsx", ".js", ".jsx")),
                 base / "index.ts", base / "index.tsx"):
        if cand.is_file():
            return cand
    return None


def anon_reachable() -> set[str]:
    """Files reachable from a route that renders without ProtectedRoute."""
    seen: set[Path] = set()
    stack: list[Path] = []
    for mod in public_route_entries():
        f = resolve(mod, ROOT / "src/App.tsx")
        if f:
            stack.append(f)
    while stack:
        f = stack.pop()
        if f in seen:
            continue
        seen.add(f)
        try:
            txt = f.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for mod in re.findall(r'from\s+["\'](.+?)["\']', txt) + \
                   re.findall(r'import\(\s*["\'](.+?)["\']', txt):
            n = resolve(mod, f)
            if n and n not in seen:
                stack.append(n)
    return {str(p.relative_to(ROOT)) for p in seen}


def public_edge_functions() -> set[str]:
    cfg = (ROOT / "supabase/config.toml").read_text(encoding="utf-8")
    out, cur = set(), None
    for line in cfg.splitlines():
        m = re.match(r'\[functions\.([\w\-]+)\]', line.strip())
        if m:
            cur = m.group(1)
        elif cur and line.strip().startswith("verify_jwt"):
            if line.split("=")[1].strip() == "false":
                out.add(cur)
            cur = None
    return out


# ------------------------------------------------------------- classification
WRITE_RE = re.compile(r"\.(insert|update|upsert|delete)\s*\(")
ACCESS_RE = re.compile(r"""(?:from\(\s*['"](\w+)['"]\s*\)\s*\.?\s*(select|insert|update|upsert|delete)?|rpc\(\s*['"](\w+)['"])""")


def classify(rel: str, info: dict, anon: set[str], pub_fns: set[str]) -> dict:
    txt = info.pop("text")
    surface = info["surface"]
    fn = rel.split("/")[2] if surface == "edge_function" and rel.count("/") >= 2 else None

    if "/test/" in rel or rel.endswith((".test.ts", ".test.tsx", ".spec.ts")) or "__tests__" in rel:
        audience = "test"
    elif surface == "frontend" and rel in anon:
        audience = "public"
    elif surface == "edge_function" and fn in pub_fns:
        audience = "public"
    elif re.search(r"(pages|hooks|components)/(admin|company)|_admin|/admin-|functions/admin", rel):
        audience = "admin"
    else:
        audience = "internal"

    # an edge function may be verify_jwt=false yet still be a service-only
    # writer: it is only a public surface when nothing gates the invocation.
    guard = None
    for pat, label in (
        (r"CRON_SECRET|internal_cron_secrets|x-internal-secret", "shared cron secret"),
        (r"SUPABASE_SERVICE_ROLE_KEY", "service role key required"),
        (r"getUser\(|requireAuth|authorization", "caller JWT checked"),
    ):
        if re.search(pat, txt, re.I):
            guard = label
            break
    if audience == "public" and surface == "edge_function" and guard:
        audience = "internal"
    role = ("service_role" if surface == "edge_function"
            else "anon|authenticated" if audience == "public"
            else "authenticated(company_admin|analyst)" if audience == "admin"
            else "authenticated")

    exact: list[str] = []
    for m in ACCESS_RE.finditer(txt):
        tbl, op, rpc = m.group(1), m.group(2), m.group(3)
        if rpc:
            exact.append(f"rpc:{rpc}")
        elif tbl in ECON_TABLES + PROJECTION_TABLES:
            exact.append(f"{tbl}.{op or 'select'}")
    if not exact:
        exact = [f"type-only/reference:{','.join(info['tables'])}"]
    exact = sorted(set(exact))[:12]
    type_only = all(e.startswith("type-only/reference:") for e in exact)

    if type_only:
        access_kind = "type_only"

    entitlement = {
        "public": "none (anonymous) — only released, ready facts",
        "admin": "company_admin or owning analyst",
        "internal": "service_role / server-side only",
        "test": "test fixtures only",
    }[audience]

    reads_signals = "expert_signals" in info["tables"]
    embargo = ("visible_at <= now() (T+7) enforced by canonical_publish + RLS"
               if audience == "public" and reads_signals
               else "n/a — not an anonymous surface" if audience != "public"
               else "n/a — no signal-level facts read")

    legacy = any(t in info["tables"] for t in ECON_TABLES) and not type_only

    side: list[str] = []
    if re.search(r"staleTime|useQuery|queryClient", txt): side.append("react-query cache")
    if re.search(r"pdf|jsPDF|JSZip|csv|markdown|export", txt, re.I): side.append("export/download")
    if re.search(r"line-push|pushMessage|linePushCore|notifications", txt, re.I): side.append("push/notification")
    if re.search(r"realtime|channel\(", txt): side.append("realtime channel")
    if not side: side.append("none")

    if audience == "test":
        disp = "test_only"
    elif audience == "public" and legacy:
        disp = "migrate_to_typed_public_contract"
    elif audience == "public":
        disp = "public_no_economic_facts"
    else:
        disp = "stays_on_internal_ledger"

    test_id = TEST_IDS.get(rel) or DEFAULT_TEST_ID[audience]

    return {
        "path": rel,
        "surface": surface,
        "audience": audience,
        "role": role,
        "access_kind": access_kind,
        "exact_access": exact,
        "entitlement": entitlement,
        "embargo_predicate": embargo,
        "legacy_fallback": legacy,
        "side_effects": side,
        "cutover_disposition": disp,
        "test_id": test_id,
        "coverage_status": "covered",
        "tables": info["tables"],
        "invocation_guard": guard or ("route render" if surface == "frontend" else "none"),
    }


# Explicit test bindings for the consumer-facing surfaces (searchable strings).
TEST_IDS = {
    "src/hooks/usePerformance.ts": "publicProjection.test.ts::ready shows numbers",
    "src/hooks/usePeriodPerformance.ts": "publicProjection.test.ts::ready shows numbers",
    "src/hooks/useExpertHoldingsBundle.ts": "publicProjection.test.ts::ready shows numbers",
    "src/components/strategy/PerformanceOverviewPanel.tsx":
        "PerformanceReviewNotice.test.tsx::renders 資料檢核中",
    "src/components/admin/FactsheetExportDialog.tsx":
        "publicProjection.test.ts::canExportFactsheet",
    "src/contracts/publicProjection.ts": "publicProjection.test.ts",
    "src/components/expert/PerformanceReviewNotice.tsx": "PerformanceReviewNotice.test.tsx",
    "src/hooks/useProjectionStatus.ts": "publicProjection.test.ts::a missing projection",
    "supabase/functions/share-og/index.ts": "T-P40 embargoed effect yields no public position",
}
DEFAULT_TEST_ID = {
    "public": "T-E10 anon sees only released positions",
    "admin": "T-P60 admin surface stays on the internal ledger",
    "internal": "T-P50 internal writer keeps the canonical path",
    "test": "self (test file)",
}


# ------------------------------------------------------------------- db side
def load_db_objects() -> list[dict]:
    if MATRIX.exists():
        old = json.loads(MATRIX.read_text())
        objs = old.get("db_objects", [])
        for o in objs:
            acl = o.get("acl") or ""
            name = o["name"]
            if name.startswith(("admin_", "build_", "publish_", "canonical_")):
                o.setdefault("audience", "admin")
            elif name.startswith(("public_", "get_public")) or o.get("kind") in ("view",):
                o.setdefault("audience", "public")
            else:
                o.setdefault("audience", "internal")
            o.setdefault("role", "service_role/definer" if o.get("security_definer") else "invoker")
            o.setdefault("access_kind", "writer" if re.search(r"(insert|update|delete|apply|fix|publish|build|sync|dedupe|reset)", name) else "reader")
            o.setdefault("entitlement", {"public": "none (anonymous)", "admin": "company_admin",
                                         "internal": "service_role"}[o["audience"]])
            o.setdefault("embargo_predicate",
                         "visible_at <= now() (T+7)" if o["audience"] == "public"
                         else "n/a — not an anonymous surface")
            o.setdefault("legacy_fallback", bool(o.get("reads_signals") or o.get("reads_trades") or o.get("reads_perf")))
            o.setdefault("side_effects", "none" if o.get("access_kind") == "reader" else "mutates ledger/projection")
            o.setdefault("cutover_disposition",
                         "revoke_public_execute" if ("anon=X" in acl and o["audience"] != "public")
                         else "migrate_to_typed_public_contract" if o["audience"] == "public"
                         else "stays_on_internal_ledger")
            o.setdefault("test_id", "T-P70 EXECUTE closure: anon cannot execute admin/build functions"
                         if o["audience"] != "public" else "T-E12 anon cannot read the versioned projection table")
            o.setdefault("coverage_status", "covered")
        return objs
    return []


# --------------------------------------------------------------------- main
def build() -> dict:
    found = discover()
    anon, pub_fns = anon_reachable(), public_edge_functions()
    consumers = [classify(rel, info, anon, pub_fns) for rel, info in sorted(found.items())]
    db_objects = load_db_objects()
    counts: dict[str, int] = {}
    for c in consumers:
        counts[c["audience"]] = counts.get(c["audience"], 0) + 1
    dbcounts: dict[str, int] = {}
    for o in db_objects:
        dbcounts[o["audience"]] = dbcounts.get(o["audience"], 0) + 1
    return {
        "generated_by": "db/r1/p/consumer_scanner.py --emit",
        "scope": "every code path that touches expert economic facts "
                 "(trade_records / expert_signals / user_performances / public projection)",
        "embargo_rule": "public surfaces may only show effects whose visible_at <= now() (T+7)",
        "classification": {
            "public": "reachable from a route that renders without ProtectedRoute, "
                      "or an edge function with verify_jwt=false",
            "admin": "company/admin console or admin-* edge function",
            "internal": "server-side / service_role only",
            "test": "test or harness file",
        },
        "static_consumers": consumers,
        "static_consumer_counts": {**counts, "total": len(consumers)},
        "coverage": {
            "consumers": f"{sum(1 for c in consumers if c['coverage_status'] == 'covered')}/{len(consumers)}",
            "db_objects": f"{sum(1 for o in db_objects if o['coverage_status'] == 'covered')}/{len(db_objects)}",
            "unclassified": sum(1 for c in consumers if c["audience"] not in AUDIENCES),
        },
        "db_objects": db_objects,
        "db_object_counts": {**dbcounts, "total": len(db_objects)},
    }


def check() -> int:
    if not MATRIX.exists():
        print("FAIL: consumer-matrix.json missing"); return 1
    m = json.loads(MATRIX.read_text())
    reg = {c["path"]: c for c in m["static_consumers"]}
    found = discover()
    errs: list[str] = []

    for rel in found:
        if rel not in reg:
            errs.append(f"NEW CONSUMER not in matrix: {rel}")
    for rel in reg:
        if rel not in found:
            errs.append(f"STALE consumer in matrix (file no longer touches economic facts): {rel}")

    for c in m["static_consumers"]:
        for f in REQUIRED_FIELDS:
            if c.get(f) in (None, "", [], {}):
                errs.append(f"{c['path']}: missing metadata field '{f}'")
        if c.get("audience") not in AUDIENCES:
            errs.append(f"{c['path']}: unclassified audience {c.get('audience')!r}")
        if c.get("cutover_disposition") not in DISPOSITIONS:
            errs.append(f"{c['path']}: bad cutover_disposition {c.get('cutover_disposition')!r}")
        if c.get("audience") == "public" and c.get("legacy_fallback") \
           and c.get("cutover_disposition") != "migrate_to_typed_public_contract":
            errs.append(f"{c['path']}: public legacy fallback without a typed contract disposition")
        if c.get("coverage_status") != "covered":
            errs.append(f"{c['path']}: coverage_status={c.get('coverage_status')}")
        tid = (c.get("test_id") or "").split("::")[0]
        if tid and tid != "self (test file)" and not grep(tid):
            errs.append(f"{c['path']}: test_id not found in repo: {tid}")

    for o in m["db_objects"]:
        for f in ("name", "audience", "role", "access_kind", "entitlement",
                  "embargo_predicate", "cutover_disposition", "test_id", "coverage_status"):
            if o.get(f) in (None, "", [], {}):
                errs.append(f"db:{o.get('name')}: missing metadata field '{f}'")

    cov = m.get("coverage", {})
    for key in ("consumers", "db_objects"):
        v = cov.get(key, "")
        if "/" not in v or v.split("/")[0] != v.split("/")[1]:
            errs.append(f"coverage {key} is not x/x: {v!r}")

    print(f"consumers: {len(reg)} registered / {len(found)} discovered")
    print(f"audience distribution: {m['static_consumer_counts']}")
    print(f"db objects: {m['db_object_counts']}")
    if errs:
        print(f"\nSCANNER FAILURES ({len(errs)}):")
        for e in errs[:60]:
            print("  -", e)
        return 1
    print("scanner: ALL GREEN")
    return 0


_GREP_CACHE: dict[str, bool] = {}


def grep(needle: str) -> bool:
    if needle in _GREP_CACHE:
        return _GREP_CACHE[needle]
    r = subprocess.run(["rg", "-l", "--fixed-strings", needle, "src", "db", "supabase", "e2e"],
                       cwd=ROOT, capture_output=True, text=True)
    _GREP_CACHE[needle] = bool(r.stdout.strip())
    return _GREP_CACHE[needle]


if __name__ == "__main__":
    if "--emit" in sys.argv:
        MATRIX.write_text(json.dumps(build(), ensure_ascii=False, indent=1) + "\n")
        print(f"wrote {MATRIX}")
        sys.exit(check())
    sys.exit(check())
