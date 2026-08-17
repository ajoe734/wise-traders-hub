# H-1 Provider capability probe — hminus1-20260817T100242Z

started=2026-08-17T10:02:42.363432+00:00 ended=2026-08-17T10:03:40.683994+00:00 production_touch=none

## Endpoints

| id | kind | market | http | bytes | rows | symbols | latency_ms | auth |
|---|---|---|---|---|---|---|---|---|
| twse_stock_day_all | price_volume | listed | 200 | 319703 | 1378 | 1378 | 26643 | none |
| twse_bwibbu_all | fundamentals | listed | 200 | 116662 | 1083 | 1083 | 5054 | none |
| twse_t86 | institutional | listed | 200 | 2009890 | 15637 | 15637 | 6200 | none |
| tpex_daily_close | price_volume | otc | 200 | 4104390 | 10512 | 10512 | 16704 | none |
| tpex_3insti | institutional | otc | 200 | 862844 | 911 | 911 | 3586 | none |

## 10 representative instruments

| symbol | class | master | price/volume | institutional | fundamentals | broker BSR | verdict |
|---|---|---|---|---|---|---|---|
| 2330 | listed_common | yes | yes | yes | yes | no | eligible |
| 2317 | listed_common | yes | yes | yes | yes | no | eligible |
| 0050 | listed_etf | yes | yes | yes | no | no | eligible |
| 00631L | listed_etf_leveraged | yes | yes | yes | no | no | eligible |
| 6488 | otc_common | yes | yes | yes | no | no | eligible |
| 5347 | otc_common | yes | yes | yes | no | no | eligible |
| 6510 | otc_common | yes | yes | yes | no | no | eligible |
| 053040 | warrant | no | no | yes | no | no | unsupported |
| 6515 | listed_common | yes | yes | yes | yes | no | eligible |
| AAPL | us_equity | no | no | no | no | no | unsupported |

## Blockers

- **BLOCKER-E1** broker-level BSR: no verified license-free source (FinMind HTTP 400 permanent_auth). Unsupported instruments must return `unsupported`, never queue.
