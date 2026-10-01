# valuation-fundamentals v2（待核准，未部署）

這個資料夾裡的程式改動會自動部署，所以先放在這裡，等核准後再套用。

套用步驟（核准後）：
1. `fundamentalsBasis.ts` → 覆蓋 `supabase/functions/_shared/fundamentalsBasis.ts`
2. `index.ts` → 覆蓋 `supabase/functions/valuation-fundamentals/index.ts`
3. 測試改從 `_shared` 匯入：`src/test/unit/valuation-fundamentals-v2.test.ts`；舊的 `valuation-fundamentals-basis.test.ts` 刪掉
4. 在 AGENTS.md「Valuation fundamentals」規則中補上：股數用官方面額換算

回復方式：用版本紀錄還原這兩個檔案，平台會自動重新部署舊版。不碰資料庫。

主要變更：
- 股數：股本 ÷ 官方面額（證交所／櫃買中心）；查不到面額或無面額就不適用
- PE／PS：用加權平均股數（淨利 ÷ EPS）；四季股數變動超過 0.5% 時，改用最新一季的追溯口徑
- 日期：今日估值標「資料期＋取得時間」；歷史樣本只用法定申報期限之後的收盤
- 倍數：同業至少 3 家，取 P25–P75；本公司歷史排除同一資料期的樣本，至少 4 季，取 P25–P75，標成「歷史情境參考」
- 效能：同業最多 6 家、同時 3 個請求、單次 8 秒逾時、同業總預算 15 秒，進行中的相同請求會合併
