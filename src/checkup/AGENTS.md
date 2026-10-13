# src/checkup rules

### Holdings price spectrum

The drawer's default 「站牌」 mode follows `docs/valuation/three-rulers-rules.md` via the pure `src/checkup/lib/valuationStations.ts` (main-ruler pick, 1-year P20/P50/P80 × reported basis, curated peer list in `valuationPeerGroups.json`); target/PE/PB/PS modes share the same single TWD scale in `PriceSpectrum`; why: one written rulebook, presentation never recomputes basis.

### Holdings institutional palette

Use fixed identity colors for foreign investors, investment trusts, and dealers in every drawer institutional surface; show direction with the zero line and signed values, preserving red/green exclusively for market-price and volume direction.

### Forward valuation evidence

Forward/peer valuation evidence for the holdings drawer lives in the pure `src/checkup/lib/forwardValuation.ts`; a scenario price is computed only from a named-source forward (or TTM) per-share basis × a multiple of the same period kind, and period mismatches (historical TTM multiple × forward basis) block the scenario; why: the current provider only returns reported TTM/quarter-end denominators, so forward numbers must be user-sourced and never inferred, and peer medians/highs stay unadjusted references unless a premium/discount reason is given.

### Station extras

Curated peer multiples and forward EPS reach the drawer only via `useStationExtras` (RPC `valuation_peer_multiples`, table `forward_eps_estimates`, admin-write); why: the RPC's own peer scope is not the curated list, and forward inputs must carry named sources.
