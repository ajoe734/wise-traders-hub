## 目標
新增 Playwright E2E `e2e/journal-detail-title-collapse.spec.ts`，鎖定 `JournalDetail` 頁：
1. 任何長度的 `reason_summary` 全文都存在於 DOM，不會再被 `richHtmlPreview` 加 `…` 截斷。
2. 長標題預設折疊（`line-clamp-2`），出現「顯示全部」按鈕；點擊後展開，按鈕變「收合」；再點回折疊。
3. 短標題不出現折疊按鈕。

## 覆蓋範圍（不准偷懶清單）
| 案例 | reason_summary 長度 | 期望 |
|---|---|---|
| A. 短標題 | ~30 字 | 完整可見；無「顯示全部/收合」按鈕；`h1` 無 `line-clamp-2` |
| B. 中等 | 剛好 80 字（threshold 邊界） | 不出現按鈕（`> 80` 才觸發） |
| C. 長標題 | ~300 字（含全形標點、英數混排） | 預設 `h1` 帶 `line-clamp-2`；「顯示全部」按鈕存在；`h1.textContent` 完整、不含 `…`；點擊後 `h1` 不再有 `line-clamp-2` 且顯示「收合」；再點回覆折疊 |
| D. 極長 HTML（含 `<p>`, `<strong>`, `<br>`） | ~800 字 | `h1.textContent` 為完整純文字（HTML 已 flatten），不含 `<` 標籤字面；折疊 / 展開行為正常 |

每個案例額外驗證：
- 頁面沒有出現「找不到此週記」
- 沒有 `pageerror`

## 技術細節

### 檔案
- 新增：`e2e/journal-detail-title-collapse.spec.ts`
- 沿用 helpers：`e2e/helpers/supabase-mock.ts` 的 `seedSession` + `installRoutes`

### Mock 資料
用參數化 fixture 產出 4 種 signal：

```text
buildSignal(len, opts) → {
  id, expert_id: 'expert-1', instrument: 'TEST',
  action: 'buy', published_at: <週三>,
  reason_summary: <指定長度純文字或 HTML>,
  reason_detail: '整體摘要文字',
  learning_points: '重點 1\n重點 2',
  status: 'published',
  experts: { name:'測試導師', slug:'test-mentor', role:'mentor', avatar_url:null }
}
```

### REST handlers（`installRoutes`）
- `profiles` → 單筆 admin 測試用
- `user_roles` → `[{ role: 'company_admin' }]`（避開訂閱檢查）
- `expert_signals`：依 `url.searchParams`
  - 含 `id=eq.<id>` 且 `single` → 回主 signal
  - 含 `expert_id=eq.expert-1` → 回 `[主 signal]`（週內只一筆即可）
- `experts`、`member_subscriptions`、`get_expert_detail_bundle` 給最小空回應避免其他頁面依賴爆炸（`UnifiedAppLayout` 可能拉 header 資料）

### 測試流程（每個案例）
```text
1. seedSession
2. installRoutes（吃入該案例的 signal）
3. page.goto(`/app/journal/${signal.id}`)
4. await heading level 1 visible
5. 讀 h1.textContent，assert 等於期望完整純文字（用 normalize 去掉多餘空白）
6. assert !text.endsWith('…') && !text.includes('<')
7. 依案例判斷「顯示全部」按鈕是否存在
8. 若存在：
   - 讀 h1 的 computed class → 應含 line-clamp-2
   - click 按鈕 → 讀 button.textContent 為「收合」、h1 class 不再含 line-clamp-2
   - 再 click → 回到「顯示全部」+ line-clamp-2
```

### 註記
- 不做視覺快照（避免與 freecheckup 快照專案衝突），改用 DOM assertions（class 與 textContent），穩定且能真實反映「不截斷」語意。
- 邊界 80 字案例是為了固定 `TITLE_COLLAPSE_THRESHOLD = 80` 判斷，未來若調整常數，本測試會提醒同步修改。
- 執行方式：`bunx playwright test e2e/journal-detail-title-collapse.spec.ts`

## 驗收
- 4 個 case 全部 pass
- 若後續 `JournalDetail` 誤加回 `richHtmlPreview(..., N)` 讓長標題結尾出現 `…`，case C/D 立即紅燈
- 若移除折疊按鈕或折疊 class，case C/D 也會失敗
