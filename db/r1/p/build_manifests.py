#!/usr/bin/env python3
"""R1-P — regenerate replay-84.json and drift-26.json from production (READ-ONLY).

Runs db/r1/p/manifest_replay.sql (which itself includes
db/r1/p/instrument_class_view.sql, the security-master classification) and
augments every key with the adjudication contract:

  authoritative_qty_shares  -- NULL whenever a human must adjudicate
  candidate_qty_shares      -- the observed candidates, never an answer
  auto_correction_forbidden -- true for every manual_review key

Single ambiguity definition, basis always labelled (see manifest['ambiguity']).
"""
import json, subprocess, sys, os

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
DRIFT_CLASSES = ('multiple_apply', 'signal_only')


def run_sql(path):
    out = subprocess.run(['psql', '-X', '-At', '-f', path],
                         capture_output=True, text=True, cwd=ROOT)
    if out.returncode:
        sys.exit(out.stderr)
    return json.loads(out.stdout[out.stdout.index('{"generated_by'):])


def main():
    m = run_sql('db/r1/p/manifest_replay.sql')
    keys = m['keys']
    assert len(keys) == 84, len(keys)

    for k in keys:
        k['in_drift26'] = k['class'] in DRIFT_CLASSES
        cands = sorted({v for v in (k['stored_open_qty_shares'], k['replay_qty_shares'])
                        if v is not None})
        k['candidate_qty_shares'] = cands
        adjudicated = (k['review_status'] == 'auto_supported')
        k['authoritative_qty_shares'] = k['stored_open_qty_shares'] if adjudicated else None
        k['auto_correction_forbidden'] = not adjudicated

    m['drift_keys'] = sum(1 for k in keys if k['in_drift26'])
    amb = m['ambiguity']
    amb['market_ambiguous_keys_drift'] = sum(
        1 for k in keys if k['in_drift26'] and 'market_ambiguous' in k['reason_codes'])
    amb['unit_ambiguous_keys_drift'] = sum(
        1 for k in keys if k['in_drift26'] and 'unit_ambiguous' in k['reason_codes'])
    # live derivative OPEN positions: 4/4 TW warrants + 3/3 US option combos
    live = subprocess.run(['psql','-X','-At','-F','\t','-c',
        "select 'K-'||left(md5(tr.expert_id::text||'|'||coalesce(tr.market,'-')||'|'||tr.instrument),16),"
        "tr.instrument, coalesce(tr.market,'-') from public.trade_records tr where tr.status='open' "
        "and (split_part(tr.instrument,' ',1) ~ '^0[0-9]{5}$' or tr.instrument ~ '\\+') order by 2"],
        capture_output=True, text=True, cwd=ROOT)
    if live.returncode:
        sys.exit(live.stderr)
    by_key = {k['key']: k for k in keys}
    opens = []
    for line in live.stdout.strip().splitlines():
        kk, instrument, market = line.split('\t')
        k = by_key.get(kk)
        assert k is not None, f'open derivative key missing from manifest: {kk} {instrument}'
        opens.append({
            'key': kk, 'instrument_masked': instrument[:6] if market == 'TW' else instrument.split(' ')[0],
            'market': market, 'asset_class': k['asset_class'],
            'classification_evidence': k['classification_evidence'],
            'in_warrant_master': k['in_warrant_master'],
            'exercise_ratio': k['exercise_ratio'],
            'derivative_supported': k['supported']['derivative_supported'],
            'public_disposition': k['public_disposition'],
            'review_status': k['review_status'],
        })
    tw = [o for o in opens if o['market'] == 'TW']
    us = [o for o in opens if o['market'] == 'US']
    assert len(tw) == 4 and len(us) == 3, (len(tw), len(us))
    assert all(o['asset_class'] in ('tw_warrant', 'unknown_derivative') for o in tw)
    assert all(o['asset_class'] == 'us_option_combo' for o in us)
    assert all(o['derivative_supported'] is False for o in opens)
    assert all(o['public_disposition'] == 'withheld_incomplete' for o in opens)
    m['derivative_open_positions'] = {
        'rule': 'derivative_supported requires a complete quote+multiplier chain AND an '
                'adjudicated quantity basis (class=match, single unit). Any drifted or '
                'unit-ambiguous derivative key fails closed.',
        'tw_warrant_opens': len(tw), 'us_option_combo_opens': len(us), 'rows': opens}
    m['derivative_summary'] = {
        'tw_warrant_keys': sum(1 for k in keys if k['asset_class'] == 'tw_warrant'),
        'unknown_derivative_keys': sum(1 for k in keys if k['asset_class'] == 'unknown_derivative'),
        'us_option_combo_keys': sum(1 for k in keys if k['asset_class'] == 'us_option_combo'),
        'unclassified_instrument_keys': sum(1 for k in keys if k['asset_class'] == 'unknown_instrument'),
        'derivative_unsupported_keys': sum(
            1 for k in keys if not k['supported']['derivative_supported']),
    }
    json.dump(m, open(os.path.join(ROOT, 'db/r1/p/replay-84.json'), 'w'),
              ensure_ascii=False, indent=1)

    dk = [k for k in keys if k['in_drift26']]
    assert len(dk) == 26, len(dk)
    drift = {
        'generated_by': 'db/r1/p/build_manifests.py',
        'derived_from': 'db/r1/p/replay-84.json',
        'total_keys': len(dk),
        'class_counts': {c: sum(1 for k in dk if k['class'] == c) for c in DRIFT_CLASSES},
        'asset_class_counts': {a: sum(1 for k in dk if k['asset_class'] == a)
                               for a in sorted({k['asset_class'] for k in dk})},
        'ambiguity': {
            'definition': amb['definition'],
            'market_ambiguous_keys_drift': amb['market_ambiguous_keys_drift'],
            'unit_ambiguous_keys_drift': amb['unit_ambiguous_keys_drift'],
            'basis_note': 'drift-26 basis only. The 84-key and 76-pair numbers live in '
                          'replay-84.json["ambiguity"] and must never be mixed with these.',
        },
        'market_ambiguous_key_list': [
            {'key': k['key'], 'expert': k['expert'], 'instrument': k['instrument'],
             'market': k['market'], 'class': k['class'],
             'reason': 'same (expert, instrument) also booked under another market'}
            for k in dk if 'market_ambiguous' in k['reason_codes']],
        'invariants': {
            '6515': 'stored 50 and replay 10 are CANDIDATES ONLY; manual_review; '
                    'auto-correction forbidden; withheld from every public channel.'},
        'keys': dk,
    }
    json.dump(drift, open(os.path.join(ROOT, 'db/r1/p/drift-26.json'), 'w'),
              ensure_ascii=False, indent=1)

    print('replay-84:', len(keys), m['class_counts'])
    print('drift-26 :', len(dk), drift['class_counts'])
    print('ambiguity:', {k: v for k, v in amb.items() if k.startswith(('market', 'unit'))})
    print('derivative:', m['derivative_summary'])
    print('open derivatives:', len(m['derivative_open_positions']['rows']), 'all unsupported+withheld')


if __name__ == '__main__':
    main()
