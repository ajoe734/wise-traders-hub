## 根因

`src/checkup/components/CoachMarks.jsx` 用 `position:fixed; inset:0; rgba(0,0,0,0.55); zIndex:10000` 全螢幕遮罩。第一次進 `/free-checkup` 必彈，蓋住配額卡的「升級 →」、用盡時的「查看升級方案」與整張持倉看板。`localStorage[checkup-coach-seen-v1]` 一被清就再彈。

## 我之前漏掉的測試（將一次補齊）

| # | 場景 | 預期 |
|---|------|------|
| 1 | free（無 checkup_subscriptions） | 配額卡顯示「升級 →」可點，導向 /pricing#checkup |
| 2 | basic（active） | tier badge=Basic、升級→ 文案改「升級 Pro」 |
| 3 | pro | 完全隱藏所有升級 CTA |
| 4 | 強制 remaining=0（free） | 用盡卡顯示「查看升級方案」大按鈕可點 |
| 5 | 429 QUOTA_EXCEEDED | quotaModal 跳出，CTA 可點 |
| 6 | /pricing#checkup（basic 登入） | 「目前方案」標 Basic、Basic 卡 disabled、Pro 卡可訂閱 |
| 7 | /checkout/checkup/:planId（已是該 plan） | 應 redirect 或顯示提示（驗證有無破口） |
| 8 | 第一次進 vs 關過 CoachMarks | 升級 CTA 在兩種狀態都應可點 |

## 修改

### 1. CoachMarks 改為「不遮頁面的底部 toast」
`src/checkup/components/CoachMarks.jsx`
- 移除全螢幕黑色遮罩（不用 `inset:0` + `rgba(0,0,0,.55)`）
- 改成定位在底部中央的卡片（`position:fixed; bottom:16px; left:50%; transform:translateX(-50%); zIndex:50`），不擋頁面其他互動
- 卡片寬度 360 / 不滿版；保留 STEP 1/3、略過、下一步、進度條
- 維持點「略過 / 開始使用」寫 `localStorage[checkup-coach-seen-v1]='1'`
- 移除 `onClick={close}` 在背景的關閉行為（沒背景了）

### 2. 補測試
新增 `src/test/components/CoachMarks.test.tsx`
- assert 元件不渲染 `inset:0` 全螢幕遮罩
- assert 已存 `checkup-coach-seen-v1` 時不渲染
- assert 點「略過」會寫入 localStorage 並 unmount

### 3. 手動驗證 SOP（我會跑）
- 用 `supabase--read_query` 找測試帳號，臨時 insert 一筆 `checkup_subscriptions`（basic active）→ 重整頁面截圖
- 直接改 `checkup_usage` 灌一筆讓 free remaining=0 → 截圖
- pro 場景：`profiles.is_tester=true` 即 tier=pro → 截圖
- 截 `/pricing#checkup` 三 tier 樣貌
- `/checkout/checkup/:planId` 進入時若已是該 plan，檢查當前行為（若無攔截則回報，視回饋再修）

### 4. 不改的部分
- `useCheckupMode` / `check_checkup_quota` RPC 邏輯維持原樣（驗證後若有 bug 再單獨提）
- ProtectedRoute 已修，admin 可進 `/free-checkup`，不再動

## 交付
- 修一支 `CoachMarks.jsx`
- 新增 `CoachMarks.test.tsx`
- 在回應中附上 free / basic / pro / remaining=0 / 429 modal 共 5 張驗證截圖

