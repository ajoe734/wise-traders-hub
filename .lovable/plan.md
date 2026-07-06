## 現況（誠實說明）

族群/題材分類目前的資料鏈：

1. **`src/checkup/seedData.js` 裡的 `STOCK_META`**：手 key 的 43 檔對照表，每檔**只有一個 `industry` + 一個 `strategy`**。這是 demo 唯一資料源，也是登入用戶「未 override」時的 fallback。
2. **`holding_meta_overrides` 資料庫表**：使用者可以在 `/company/meta-overrides` 手動蓋掉單檔的 industry/strategy，一樣**單值**。
3. **`themes.json` / `companyProfiles.json` / `supplyChain.json`**：檔案存在但**內容是空 `{}`**，從來沒被填。

所以你看到的問題不是 bug、是**根本缺乏維護機制**：
- 分類是我（前一輪）憑印象手 key 的，沒對過任何權威來源
- Schema 只支援單一族群，像鴻海（AI 伺服器 + 電子代工 + 車用）這種本來就多族群的個股必然錯
- 沒有更新排程，公司轉型（例如生技轉 AI）不會反映

要真正解決，需要三件事一起做：**資料模型改多對多、灌入權威來源、建立更新流程**。

---

## 計畫

### Step 1 — 資料模型改為多族群（schema 變更）

現況 `STOCK_META[code] = { industry: 'AI/伺服器', strategy: '成長股' }` 改成：

```
STOCK_META[code] = {
  industries: ['AI/伺服器', 'PCB/材料'],   // 排序 = 營收佔比降冪
  primaryIndustry: 'AI/伺服器',            // 快取，= industries[0]
  themes: ['AI', 'CoWoS', '護國群山'],     // 題材（可 0-N 個）
  strategy: '成長股',                       // 策略仍單值
  revenueMix: [                             // 供聚合加權用（選填）
    { industry: 'AI/伺服器', pct: 55 },
    { industry: 'PCB/材料', pct: 30 },
  ],
  source: 'twse-2026-06',                   // 資料來源標記
  updatedAt: '2026-06-15',
}
```

`holding_meta_overrides` 表加欄位 `industries text[]`、`themes text[]`、`revenue_mix jsonb`，舊 `industry` 欄保留供回溯。

### Step 2 — `HoldingsSectorSummary` 聚合改用加權

- **有 `revenueMix`** → 每檔的市值按 pct 拆到多個產業桶
- **沒 revenueMix、只有 industries[]** → 平均拆分（例：兩產業各 50%）
- **只有 primaryIndustry** → 全額計入單一產業（舊行為）
- 題材另做一區「題材曝險（依檔數）」，同一檔可命中多個題材

集中警示改用「單一產業 > 25%」而不是舊的檔數判斷。

### Step 3 — 資料來源與更新流程

分類要「最新且正確」只有兩條路，選一條：

**A. 半自動：TWSE / TPEx 產業別 + 人工題材**
- 產業別走公開資料：TWSE 上市個股「產業類別」欄位、TPEx 上櫃相同欄位（每月抓一次夠用）
- 建 `scripts/refresh-stock-industry.mjs`：抓官方 CSV → 產生 `src/checkup/data/stockIndustry.json`
- 題材（AI、CoWoS、CPO…）走**人工白名單**放 `src/checkup/data/themes.json`：`{ "AI/伺服器": [2317, 2382, 2454, ...] }`，每月人工 review
- 更新頻率：產業別每月 1 號、題材每兩週或事件驅動（例：新台幣升值題材、颱風災後重建）
- 納入 `docs/demo-data-maintenance.md` SOP，跟 demo 每月更新一起做

**B. 全自動：接第三方 API（如 FinMind、Goodinfo 爬蟲、CMoney）**
- 好處：題材、營收比重都能自動抓
- 壞處：要處理 rate limit、費用、資料授權；題材定義各家不同、還是要人工映射
- 我建議先做 A，等量大再考慮 B

### Step 4 — 使用者手動修正入口

在持倉卡片新增「回報分類錯誤」小按鈕 → 開 modal → 直接寫 `holding_meta_overrides`（多族群 + 題材）。這樣你不用等我改 seed，看到錯的當場改。

### Step 5 — Demo 資料同步修正

Step 1-4 完成後，用同一份資料把 `DEMO_HOLDINGS` 用到的 20+ 檔全部 review 一次，錯的補正、多族群補齊。

### Step 6 — 驗收

- [ ] Schema migration 過 typecheck
- [ ] 抓一次 TWSE 產業別資料，diff 顯示哪幾檔跟舊 STOCK_META 不一致
- [ ] 你 spot-check 5 檔多族群個股（鴻海 2317、台積 2330、廣達 2382、聯發科 2454、國巨 2327）分類正確
- [ ] `HoldingsSectorSummary` 在 demo 資料下顯示：鴻海市值有拆到多桶、AI 集中警示仍會觸發
- [ ] `/company/meta-overrides` 能編輯多族群 + 題材

---

## 需要你先決定的三件事

1. **資料源選 A（TWSE + 人工題材）還是 B（第三方 API）？** 我推 A。
2. **多族群拆分要不要有 `revenueMix`？** 沒有的話就平均拆，簡單但不精準；有的話要人工維護每檔營收比重。我推「先平均拆、只對 top 20 檔重要持倉維護 revenueMix」。
3. **使用者回報分類錯誤的按鈕現在做還是之後做？** 我建議這一輪就做，否則你只能等我下一輪。

決定之後我會照你的選擇進 build mode 施工。
