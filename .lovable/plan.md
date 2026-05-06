## 問題

`/free-checkup` 持倉看板 (`src/pages/FreeCheckup.jsx` 的 `.wb-card` 區塊，feature 卡 L1–L5 約 3950–4055，normal 卡約 4060–4180) 目前只顯示：

- 股號 / 名稱 / 股數 / sparkline / action tag
- ROI%、累計損益
- 產業/策略 tag
- AI 說明
- 底部 TODAY（今日損益）/ VALUE（市值）

**沒有任何欄位顯示「買入成本」與「現價」**，只能看到報酬率推回去推。使用者在持倉視覺上找不到最基本的兩個數字。

## 變更

在 feature 卡與 normal 卡的 **L4 說明上方**（即 ROI/tags 之後、AI 說明之前），各插入一行 inline meta：

```text
成本 507.00  →  現價 512.50
```

規格：

- 字體 `fontSize: 11`、`tabular-nums`、`letterSpacing: 0.04em`
- 顏色：成本/現價數字 `subColor`、箭頭與 label `muteColor`
- 來源：`h.cost`（買入均價）與 `h.price`（現價）；任一為空顯示 `—`
- 數字格式：保留兩位小數（`Number(v).toFixed(2)`），與 AI 抓取規則一致（不四捨五入到整數）
- feature 卡（ink 底）與 normal 卡（白底）共用同一段 JSX，只差顏色 token，沿用既有 `subColor / muteColor / isInk` 變數
- 不動 L5 底部 TODAY/VALUE 結構，避免破壞 grid 對齊

## 檔案

- `src/pages/FreeCheckup.jsx`
  - feature 卡：在約第 3996 行 L3 tags 之前 / L2 ROI 之後插入新 meta 行
  - normal 卡：在約第 4122 行 L3 tags 之前 / L2 ROI 之後插入新 meta 行

## QA（依 mem://qa/checkup/freecheckup-mobile-regression-checklist 強制）

修改 `.wb-card` 必須跑：

1. 560 / 390 / 380 px 三斷點靜態檢查（`scripts/check-freecheckup-rwd.mjs`）
2. 三斷點視覺截圖人工檢查無溢出
3. `bunx playwright test e2e/freecheckup-card.spec.ts`

新增的 inline 行只用 `fontSize: 11`，遠低於 32px 門檻，不需新增 media-query，但仍會跑完整 RWD 回歸確認沒有把 L5 baseline 擠歪。
