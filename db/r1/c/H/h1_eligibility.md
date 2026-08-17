# H1 — market eligibility from an authoritative security-type source

Production touch: none. Clone/probe only. Captured 2026-08-17 UTC.

## Source

Authoritative security-type / listing registry (TWSE ISIN service, the official
"有價證券代號及名稱" publication, which is the same registry the exchange uses to
publish security types):

| id | url | bytes | sha256 |
|---|---|---|---|
| TWSE_listed_isin | https://isin.twse.com.tw/isin/C_public.jsp?strMode=2 | 3,145,3xx (see sectype.json) | `6824ecf7854e62db82d15c1f12251d75cca02549570735c0fdcdc6902455fa5a` |
| TPEX_otc_isin | https://isin.twse.com.tw/isin/C_public.jsp?strMode=4 | see sectype.json | `7979da266ab828efeccf6bc672a5727bcc8bd007c016e845652dd7b0b7d45a2d` |

Machine-readable summary: `db/r1/c/H/sectype.json` (sha256
`40ae354359eebfc2ce15fa3f481bbb190507706b94e59ba237ecc8908e5baaac`).

## Distinct counts per official security type

Listed (strMode=2):

| official type | instrument_class | distinct symbols | eligibility |
|---|---|---|---|
| 股票 | common | 1,055 | true |
| 創新板 | emerging | 30 | true |
| ETF | etf / etf_leveraged | 237 | true |
| ETN | etn | 15 | false |
| 特別股 | preferred | 28 | false |
| 臺灣存託憑證(TDR) | tdr | 10 | false |
| 受益證券-不動產投資信託 | reit | 6 | false |
| 上市認購(售)權證 | warrant | 31,733 | false |

OTC (strMode=4):

| official type | instrument_class | distinct symbols | eligibility |
|---|---|---|---|
| 股票 | common | 890 | true |
| ETF | etf / etf_leveraged | 118 | true |
| ETN | etn | 6 | false |
| 特別股 | preferred | 1 | false |
| 受益證券-資產基礎證券 | abs | 8 | false |
| 上櫃認購(售)權證 | warrant | 9,705 | false |

Code length is **not** used for classification. `002_h1_market_master.sql`
persists `instrument_class` supplied by the loader and its CHECK now enumerates
`common / etf / etf_leveraged / etn / warrant / preferred / tdr / reit / abs /
cb / emerging / unknown`.

## 10-symbol decision table

Rule: `instrument_class` = official type of the ISIN section the symbol appears
in; `eligibility` = class ∈ {common, emerging, etf, etf_leveraged}; a symbol not
found in either registry is `unknown` and **fail-closed** (`eligibility=false`,
`register_symbol_demand` reports `unsupported`, no queue row).

| symbol | registry hit | official type | instrument_class | eligibility |
|---|---|---|---|---|
| 2330 台積電 | listed | 股票 | common | true |
| 2317 鴻海 | listed | 股票 | common | true |
| 6505 台塑化 | listed | 股票 | common | true |
| 2891 中信金 | listed | 股票 | common | true |
| 0050 元大台灣50 | listed | ETF | etf | true |
| 00631L 元大台灣50正2 | listed | ETF | etf_leveraged (name fallback) | true |
| 00679B 元大美債20年 | otc | ETF | etf | true |
| 3105 穩懋 | otc | 股票 | common | true |
| 5483 中美晶 | otc | 股票 | common | true |
| 03007 (warrant code) | none | — | unknown | false (fail-closed) |

## Fallback and false-positive risk (must stay in the record)

The ISIN registry does **not** carry a leverage/inverse flag: 正2 / 反1 / 2X
products all sit under plain `ETF`. `etf_leveraged` is therefore derived by a
**name-suffix fallback** (`正2`, `反1`, `2X`, `L`/`R` code suffix).

- False positive: an ordinary ETF whose Chinese name contains those tokens for
  another reason would be misclassified as leveraged.
- False negative: a leveraged product renamed without the token stays `etf`.
- Blast radius is bounded: both classes are eligible, so a misclassification
  changes labelling/priority only, never whether the symbol is fetched.
- CB (可轉換公司債) has no section in these two registries; it stays `unknown`
  and is fail-closed until a CB-specific authoritative feed is added.
