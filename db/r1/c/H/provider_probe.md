# Institutional (法人) provider probe — 3 independent GETs per endpoint

Production touch: none. Raw bodies under `/tmp/probe2/*.raw`; machine-readable
run log `db/r1/c/H/inst_probe.json`
(sha256 `777814df361f00a7d1493b2b2f5dc6a39b6acd52091e140ed36482e003677f8d`).
Headers on every request: `Accept: application/json`,
`User-Agent: Mozilla/5.0 (compatible; legendflow-probe/1.0)`; ~30 s between rounds.

| # | target | UTC | status | content-type | bytes | latency | body sha256 (16) | body prefix |
|---|---|---|---|---|---|---|---|---|
| 1 | TWSE T86 openapi `openapi.twse.com.tw/v1/exchangeReport/T86` | 10:45:56Z | 200 | text/html | 1,006 | 2,038 ms | `17d98e3942c583c3` | `<!DOCTYPE html … XHTML 1.0 Transitional` |
| 2 | 同上 | 10:46:57Z | 200 | text/html | 1,006 | 2,022 ms | `17d98e3942c583c3` | 同上 |
| 3 | 同上 | 10:48:06Z | 200 | text/html | 1,006 | 2,012 ms | `17d98e3942c583c3` | 同上 |
| 1 | TWSE T86 JSON `www.twse.com.tw/rwd/zh/fund/T86?date=20260817&selectType=ALL&response=json` | 10:46:02Z | 200 | application/json | 1,976,483 | 2,086 ms | `0da055a80cc671fc` | `{"stat":"OK","date":"20260817","title":"115年08月17日 三大法人買賣超日報"…` |
| 2 | 同上 | 10:47:03Z | 200 | application/json | 1,976,483 | 2,657 ms | `0da055a80cc671fc` | 同上 |
| 3 | 同上 | 10:48:12Z | 200 | application/json | 1,976,483 | 1,994 ms | `0da055a80cc671fc` | 同上 |
| 1 | TPEx 3insti openapi `www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading` | 10:46:08Z | 200 | application/json | 862,844 | 3,775 ms | `f81402afea10e707` | `[{"Date":"1150817","SecuritiesCompanyCode":"00679B"…` |
| 2 | 同上 | 10:47:09Z | 200 | application/json | 862,844 | 5,276 ms | `f81402afea10e707` | 同上 |
| 3 | 同上 | 10:48:18Z | 200 | application/json | 862,844 | 6,627 ms | `f81402afea10e707` | 同上 |
| 1 | TPEx www JSON `…/www/zh-tw/insti/dailyTrade?type=Daily&sect=EW&date=20260817&response=json` | 10:46:14Z | 200 | application/json | 147,347 | 766 ms | `e18e1698ebcfb92c` | `{"columnNum":25,"tables":[{"title":"三大法人買賣明細資訊","date":"115/08/17"…` |
| 2 | 同上 | 10:47:36Z | — | — | — | 1,031 ms | — | `URLError: SSL CERTIFICATE_VERIFY_FAILED (Missing Subject Key Identifier)` |
| 3 | 同上 | 10:48:28Z | 200 | application/json | 147,347 | 3,795 ms | `e18e1698ebcfb92c` | 同上 |

## Parsed semantics

| endpoint | latest date field | raw rows | distinct normalized symbols | duplicates | stable JSON |
|---|---|---|---|---|---|
| TWSE T86 openapi | — (HTML error page, no JSON) | — | — | — | **0/3** |
| TWSE T86 JSON | `date=20260817` / `title=115年08月17日` | 15,386 | 15,386 | 0 | **3/3** |
| TPEx 3insti openapi | `Date=1150817` (ROC) | 911 | 911 | 0 | **3/3** |
| TPEx www JSON | `tables[0].date=115/08/17` | 911 | 911 | 0 | 2/3 (one TLS failure) |

Composition, cross-checked against the ISIN registry (`h1_eligibility.md`):

- TWSE T86 15,386 rows = 1,046 股票 + 14,057 權證 + 229 ETF + 30 創新板 + 9 ETN
  + 7 特別股 + 7 TDR + 1 REIT, 0 unclassified. The earlier "15,637 rows" figure
  was the same warrant-dominated payload, **not** 15k ordinary stocks.
- TPEx 3insti 911 rows = 791 股票 + 117 ETF + 3 ETN, 0 warrants, 0 unclassified.
  (TPEx publishes warrant institutional data on a separate endpoint.)

## Verdict

- **TWSE T86 JSON (`/rwd/zh/fund/T86?…response=json`): 3/3 stable** — usable.
- **TPEx 3insti openapi: 3/3 stable** — usable.
- The `openapi.twse.com.tw/v1/exchangeReport/T86` variant returns an HTML error
  page on all three attempts: **do not use it**.
- The TPEx `www/.../insti/dailyTrade` variant is 2/3 (transient TLS chain
  failure): acceptable only as a secondary source behind the openapi one.

Institutional provider reliability is therefore **not** a blocker on the two
green endpoints, but the SLO must be written against those exact URLs. H4 stays
gated until the enqueue/worker path is wired to them; price/master work is
independent and may proceed.
