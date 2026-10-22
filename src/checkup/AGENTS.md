# src/checkup rules

### Holdings price spectrum

The drawer's default 「站牌」 mode follows `docs/valuation/three-rulers-rules.md` via the pure `src/checkup/lib/valuationStations.ts` (main-ruler pick, 1-year P20/P50/P80 × reported basis, peer list in `valuationPeerGroups.json`); target/PE/PB/PS modes share the same single TWD scale in `PriceSpectrum`; why: one written rulebook, presentation never recomputes basis.

Peer groups are keyed by permanent industry codes (`industryCodes.json`, pure `lib/industryCodes.ts`) and regenerated only by `scripts/build-peer-groups.ts` (auto members + manual include/exclude); codes are append-only, never renumbered or reused, and lookups never compare industry names as strings; why: renamed or differently-written industry labels must not silently break peer matching.

### Holdings institutional palette

Use fixed identity colors for foreign investors, investment trusts, and dealers in every drawer institutional surface; show direction with the zero line and signed values, preserving red/green exclusively for market-price and volume direction.

### Forward valuation evidence

Forward/peer valuation evidence for the holdings drawer lives in the pure `src/checkup/lib/forwardValuation.ts`; a scenario price is computed only from a named-source forward (or TTM) per-share basis × a multiple of the same period kind, and period mismatches (historical TTM multiple × forward basis) block the scenario; why: the current provider only returns reported TTM/quarter-end denominators, so forward numbers must be user-sourced and never inferred, and peer medians/highs stay unadjusted references unless a premium/discount reason is given.

### Station extras

Curated peer multiples and forward EPS reach the drawer only via `useStationExtras` (RPC `valuation_peer_multiples`, table `forward_eps_estimates`, admin-write); why: the RPC's own peer scope is not the curated list, and forward inputs must carry named sources. AI-extracted forward rows are written only by `forward-eps-extract` after all four gates in `supabase/functions/_shared/forwardEpsCore.ts` pass (verbatim quote, number-in-quote, two independent extractions agree, sanity bounds); EPS is computed by fixed formula; a stored multiple must be a broker-stated forward P/E of the same period, never derived from a target price. When no broker multiple exists, the station forward reference (pure `buildForwardReference`) falls back to named-source EPS, then monthly-revenue self EPS, × the stock's own 1-year PE P20/P50/P80, always labelled 「歷史倍數，非券商前瞻倍數」; why: free data has no broker multiples, and the substitution must stay visible.

### Valuation headline

The drawer headline and 倍數信心 derive from the same station output (`valuationHeadlineText` / `multipleConfidenceText` with the station's ruler, position and peer reference); peer insufficiency must state the concrete reason and never be reported while peer multiples are still loading; why: the headline must not contradict the stations shown below it.
