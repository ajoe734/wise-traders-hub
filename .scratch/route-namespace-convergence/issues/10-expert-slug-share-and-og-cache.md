# 10 — /expert/:slug 分享卡與社群快取

Type: grilling
Status: open
Blocked by: 01

## Question

`/expert/:slug` 是唯一被外部大量引用的公開路徑：已被搜尋引擎索引、被 LINE／Facebook OG 快取，
且 `share-og/index.ts:145` 與 `og-card/index.ts` 在 Edge Function 端硬寫死此路徑。

需要定案：

- `/expert/:slug` 是否納入 `/portal/*`，還是**刻意豁免**維持原網址（把它視為對外契約）。
- 短網址 `/s/:slug` 的處置——它是不是應該成為唯一對外分享入口，讓內部路徑可自由變動。
- 若改址，`share-og`／`og-card` 需同步更新，且社群平台快取無法主動清除，需評估可接受的失效期。
