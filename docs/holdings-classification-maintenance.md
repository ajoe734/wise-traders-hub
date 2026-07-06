# 持倉族群分類資料維護 SOP

**目的**：確保 `/holding-checkup` 上方「產業／題材分佈」聚合看到的分類是最新且正確的。

## 資料鏈（合併優先順序，高 → 低）

1. **`holding_meta_overrides` DB 表**：使用者手動 override（下一輪支援多族群 UI）
2. **`src/checkup/data/stockIndustry.json`**：人工校訂的多族群 + `revenueMix` 覆蓋層
3. **`src/checkup/data/twse-industry-map.json`**：TWSE / TPEx 官方 ISIN 表產出的主產業（單值）
4. **`src/checkup/seedData.js` `STOCK_META`**：Demo / 兜底用手 key 表

## 更新流程

### 每月 1 號 — 產業別（自動）

```bash
node scripts/refresh-stock-industry.mjs
```

抓 TWSE mode=2（上市）+ mode=4（上櫃）的 ISIN 表，產出 `twse-industry-map.json`。
Diff 前後版本，把新增 / 變更的個股補進 `stockIndustry.json` 並補多族群 + `revenueMix`。

### 每兩週 — 題材白名單（人工）

在 `stockIndustry.json` 對應個股的 `themes[]` 補題材（AI、CoWoS、CPO、高股息、車用…）。
事件驅動時（新台幣升值、颱風災後重建、政策題材）加碼 review。

### Top 20 持倉的 `revenueMix`

只有 Top 20 熱門持倉個股需要人工維護 `revenueMix`（依公司年報 / 法說會營收比重）。
其餘個股只需列 `industries[]`，聚合會自動平均拆分。

## 常見坑

- **CHECK constraint 不會擋分類錯誤**：資料正確性是流程問題，程式碼只負責顯示。
- **TWSE 產業別只有單值**：像鴻海分類為「電子零組件」但實際上跨伺服器/車用/AI，必須靠 `stockIndustry.json` 手動補多族群。
- **題材無官方標準**：CMoney / 鉅亨 / Goodinfo 各家定義不同，統一以「使用者能看懂」為準，不追求全網一致。

## 驗收

- 抓完 TWSE 後，隨機抽 10 檔用 Goodinfo / 公開資訊觀測站對照
- Top 20 熱門持倉 spot-check 多族群拆分是否合理
- `/holding-checkup` 顯示「N 檔跨多族群」與加權後的產業條
