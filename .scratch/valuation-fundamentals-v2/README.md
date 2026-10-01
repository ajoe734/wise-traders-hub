# valuation-fundamentals v2（待核准，未部署）

這個資料夾裡的程式改動會自動部署，所以先放在這裡，等核准後再套用。

套用步驟（核准後）：
1. `fundamentalsBasis.ts` → 覆蓋 `supabase/functions/_shared/fundamentalsBasis.ts`
2. `index.ts` → 覆蓋 `supabase/functions/valuation-fundamentals/index.ts`
3. 測試改從 `_shared` 匯入：`src/test/unit/valuation-fundamentals-v2.test.ts`；舊的 `valuation-fundamentals-basis.test.ts` 刪掉
4. AGENTS.md「Valuation fundamentals」規則補：股數用官方面額換算、淨利須核對 origin_name、歷史證據以資料期計

回復：用版本紀錄還原這兩個檔案，平台會自動重新部署舊版。不碰資料庫。

規則摘要：
- 淨利：EquityAttributableToOwnersOfParent 必須是「淨利（淨損）歸屬於母公司業主」，且 母公司＋非控制權益＝本期淨利（≤1%）；綜合損益、同期多口徑、對不平 → PE 不適用
- 股數：股本 ÷ 官方面額 − 庫藏股；加權股數須落在上季末～本季末之間；特別股 → PE/PB 不適用
- EPS 股數基準：扣除 EPS 兩位小數進位誤差後四季差 >0.5% → PE 不適用（不冒稱追溯口徑）；PS 改最新季末股數並與官方核對
- 同業：核心業務（主分類）入圍、題材不列條件；先排序、排除興櫃，再取 6 家；需獲利且營收年增相近
- 歷史：月末代表點，同一資料期只算一份證據；≥4 期取 P25–P75；離散 >2 倍或 <6 期 → 倍數信心低、主圖不合成
- 效能：冷查單檔 23 次 HTTP（目標 3＋官方 2＋同業 6×3），實測 7.6–8.0 秒；官方名錄與目標財報並行
