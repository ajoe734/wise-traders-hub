# 一勞永逸根治 quotaModal 卡死問題

## 老實說：這次是真的一勞永逸嗎？

**是**——只要範圍涵蓋以下 6 個破口（前一版只列了 5 個，補上第 6 個）。少修任何一處，下次又會冒出來。

但要先講清楚邊界：
- 這個 plan **只修「quotaModal 全螢幕遮罩擋住整頁、上傳 tab 進不去」這條 UX bug 的所有變體**。
- **不包含** 13 位舊用戶的補償 banner / 道歉 modal（那是另一條 conversion task，用戶上一輪已分開討論）。
- **不包含** legendflow OA Messaging API channel 建置（缺 token，要等用戶提供）。

## 根因

`quotaModal` 是 `position:fixed; inset:0; zIndex:9999` 的全螢幕遮罩。三個 AI 路徑收到 429 都會觸發它（`L1026 predict` / `L1929 daily` / `L2351 parse`），而 `predict` 還是 **背景 useEffect 自動觸發**（`L1093`）—— 用戶一進 `/holding-checkup`，背景 predict 跑完拿到 429，modal 就蓋上來，連 tab bar 都點不到。配額已耗盡的 line_free 用戶（如 陳奎辰）100% 中招。

## 修復清單（6 點，缺一不可）

### 1. 完全移除 `quotaModal` state + JSX
- 刪 `L96` state、`L105-109` Esc handler
- 刪 `L3360-3475` 整段 modal JSX
- grep `quotaModal|setQuotaModal` 必須歸零

### 2. 三個 429 觸發點改成「toast + refreshQuota，不阻擋導航」
| 行號 | 路徑 | 新行為 |
|---|---|---|
| L2351 | parse（用戶主動） | `setSaved('LINE 註冊禮已用完，請查看升級方案')` 4 秒 + `refreshQuota()`；TradeTab inline banner 持續顯示 CTA |
| L1929 | daily（用戶主動） | 同上，文案改 `AI 健檢配額已用完`；DailyTab inline banner 持續顯示 CTA |
| L1026 | predict（背景自動） | `console.warn` + `refreshQuota()`，**完全不打擾 UI**（用戶沒按任何鍵） |

### 3. 背景 predict 自動觸發要 early-return（核心遺漏點）
`L1093 useEffect(() => runPredictEvents(false), ...)` 與 `L892 runPredictEvents` 內部，**在 `quota` 已載入且 `hasReachedDailyLimit === true` 時直接 return**，不發 edge call。
- 避免每分鐘對伺服器送 429
- 避免 line_free 用戶一進頁面就觸發配額耗盡 toast
- `force=true`（手動刷新行事曆）仍走原路，給明確錯誤回饋

### 4. `parseShot` 改 await refresh 再判斷（消除 race）
`L2310 parseShot` 開頭先 `const fresh = await refreshQuota()`，用 `fresh.remaining <= 0` 而不是 stale 的 `hasReachedDailyLimit` 判斷。避免「state 沒更新到、按鈕點下去才發 429」。

### 5. 上傳 tab 在配額耗盡時要有出路（避免「畫面空白沒持倉」感）
TradeTab 在 `hasReachedDailyLimit === true` 時，inline banner 下方加一顆次要按鈕「← 查看我的持倉」`onClick={() => setTab('holdings')}`，讓用戶知道資料還在、可以切回去看。

### 6. parse 按鈕在 quota 未載入前 disabled（前一版漏寫）
`disabled={parsing || !isReady || hasReachedDailyLimit}`，避免 quota 還沒抓回來就被按。

## 驗證清單（窮舉，不准只挑樣本）

| # | 動作 | 預期 |
|---|---|---|
| V1 | `rg -n "quotaModal\|setQuotaModal" src/` | 0 結果 |
| V2 | 以 `line_free` 配額=0 帳號（陳奎辰）登入 `/holding-checkup` | 進站不彈窗、上傳 tab 能進、持倉 tab 正常顯示 |
| V3 | 同帳號點上傳→選圖→解析 | toast 提示 + TradeTab banner CTA，**不出現遮罩** |
| V4 | 同帳號切到收盤分析點「開始分析」 | toast + DailyTab banner CTA |
| V5 | 同帳號背景 predict useEffect 觸發 | console.warn，**完全無 UI 變化、無 toast** |
| V6 | 以 `pro` 配額耗盡帳號重做 V2-V5 | 行為一致（文案差異） |
| V7 | 以 `william孫`（line_free 配額=1 未用）登入 | 上傳/解析正常成功、配額扣到 0、之後行為同 V2-V5 |
| V8 | `bunx playwright test e2e/line-checkup-free-gift.spec.ts e2e/freecheckup-card.spec.ts` | 全綠 |
| V9 | `bunx vitest run src/test/unit/daily-tab-line-free-copy.test.tsx src/test/unit/checkup-quota-display.test.tsx` | 全綠 |
| V10 | `bunx playwright test --grep mobile` 或 `560/390/380px` 三斷點截圖 | TradeTab/DailyTab banner 不破版 |

## 動到的檔案

- `src/pages/FreeCheckup.jsx`（唯一檔案）
- 視測試需要新增 1 個 unit test：`src/test/unit/freecheckup-quota-modal-removed.test.tsx`（grep 守護 + 三斷點 banner 渲染）

## 不會動到的東西

- `CheckupModeContext.jsx`（state 流不變）
- Edge functions（429 行為不變）
- DB / RLS（不需 migration）
- 13 位舊用戶補償流程（另一條 task）
