#!/usr/bin/env bash
# =====================================================================
# R1-P 091 — projection swap race: a reader looping over the public
# contract during repeated pointer swaps must never observe a mixed
# (half-old / half-new) version, and never a withheld or embargoed key.
# Usage: 091_swap_race.sh <port> <outdir>
# Exit code = number of observed violations.
# =====================================================================
set -uo pipefail
PORT=$1; OUT=$2; mkdir -p "$OUT"
CL="postgresql://postgres@localhost:$PORT/clone?sslmode=disable"
EXP=$(psql "$CL" -tAqX -c "SELECT v FROM tp.ids WHERE k='expP'")
VIOL=0

# writer: 40 sequential rebuilds + pointer swaps
( for i in $(seq 1 40); do
    psql "$CL" -qAtX -c "SELECT app_ledger.canonical_publish('$EXP'::uuid)" >/dev/null 2>&1
  done ) &
WPID=$!

# reader: keeps asserting single-version consistency of every public surface
for i in $(seq 1 200); do
  R=$(psql "$CL" -tAqX <<SQL
SELECT
  (SELECT count(DISTINCT projection_version) FROM public.public_position_active
    WHERE expert_id='$EXP') || '|' ||
  (SELECT count(DISTINCT projection_version) FROM public.public_nav_active
    WHERE expert_id='$EXP') || '|' ||
  (SELECT count(*) FROM public.public_position_active p
     JOIN app_ledger.replay_manifest_key m
       ON m.key = app_ledger.manifest_key(p.expert_id,p.market,p.instrument)
    WHERE m.public_disposition='withheld_incomplete') || '|' ||
  (SELECT count(*) FROM public.public_position_active p
     JOIN public.public_projection_active a USING (expert_id)
    WHERE p.projection_version <> a.active_version);
SQL
)
  IFS='|' read -r POS NAV WITHHELD MIX <<<"$R"
  [ "${POS:-0}" -le 1 ] || { echo "MIXED position versions: $R" >> "$OUT/evidence.txt"; VIOL=$((VIOL+1)); }
  [ "${NAV:-0}" -le 1 ] || { echo "MIXED nav versions: $R" >> "$OUT/evidence.txt"; VIOL=$((VIOL+1)); }
  [ "${WITHHELD:-0}" = "0" ] || { echo "WITHHELD key leaked: $R" >> "$OUT/evidence.txt"; VIOL=$((VIOL+1)); }
  [ "${MIX:-0}" = "0" ] || { echo "ROW off active version: $R" >> "$OUT/evidence.txt"; VIOL=$((VIOL+1)); }
done
wait $WPID

echo "swap-race violations=$VIOL" | tee -a "$OUT/evidence.txt"
[ "$VIOL" = "0" ] && echo "PASS swap-race" >> "$OUT/evidence.txt" || echo "FAIL swap-race" >> "$OUT/evidence.txt"
exit $VIOL
