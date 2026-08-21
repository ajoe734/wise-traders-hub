# 行銷頁文案落差清單（Phase 0 記錄，不阻擋 Phase 1-3）

本檔僅作**記錄與待人工法遵確認清單**。不改既有已上線合約語句、不下法律結論。

## 1. 「T+7／延遲 7 天以上」 vs 「週五 20:00／週六 08:00 統一發布」

| 位置 | 現況字串 | 落差 |
|---|---|---|
| `src/pages/Experts.tsx`（角色說明段，實戰導師） | 「T+7 延遲修煉派週記，純教學用途，非投資建議」 | 與 `publishingWindow.ts` 的「每週固定週次統一公開」不是同一機制 |
| `src/pages/ExpertProfile.tsx` `getPlanFeatures('mentor_weekly_journal')` | 「T+7 延遲實戰週記」 | 同上 |
| `src/pages/ExpertProfile.tsx` `getPlanLabel('mentor_weekly_journal')` | 「T+7 延遲・週記式教學」 | 同上 |
| `src/pages/ExpertProfile.tsx` `getPlanNote()` | 「所有內容均延遲 7 天以上（T+7），僅作為歷史案例教學用途，不構成即時投資建議。」 | 同上 |
| `src/components/JournalCard.tsx`（訂閱後內容區） | T+7 相關字樣 | **本次不動**（no-touch），避免在未確認前改動已上線合約語句 |
| `src/lib/publishingWindow.ts` | 「週五 20:00 統一開放發布」／「週六 08:00 統一開放發布」 | 實際排程語意 |

**狀態：需人工法遵確認。** Phase 1-3 的新增文案一律走 `src/lib/complianceCopy.ts`，
cadence 句由 `nextPublishMomentLabel()` 產生；既有 T+7 字串保持原樣，不在本次改寫。

## 2. 本次新增文案的禁用字契約

禁用：推薦、跟單（mentor 文案內）、保證、目標價、下週出手、任何「因法規所以…」的法律結論。
守門：`src/test/unit/complianceCopy.test.ts` 對 `allCopyStrings()` 逐字掃描。

## 3. 免責句

既有「過去績效不代表未來表現…」與「教學研究用途／不構成投資建議」保留原位置，
另在 `complianceCopy.ts` 收斂為 `DISCLAIMER_SHORT` / `DISCLAIMER_TEACHING` 供 marketing 頁引用。

## 4. 不得發明的資料（Phase 1-3 硬邊界）

- 匿名可讀的週記節錄：不存在 → 只做**結構樣本**（欄位骨架 + 遮蔽塊）。
- 最近公開週次／本週筆數：兩支公開 RPC 都不回傳 → 一律顯示「每週固定更新」，不顯示任何數字。
- 前瞻欄位：`expert_signals` 無此語意欄位 → 前台只描述「會員每週會拿到的結構」。
