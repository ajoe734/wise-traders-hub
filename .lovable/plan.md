

# 修正權限 UI：禁用而非隱藏

## 設計原則

「無權限」操作按鈕應**保留可見、視覺禁用、點擊提示**，而非直接隱藏。讓使用者明確知道「有這個功能，只是你不能用」，而非以為功能不存在。

## 問題盤點

目前以下頁面對「非擁有者且非 company_admin」直接隱藏按鈕：

| 檔案 | 被隱藏的操作 |
|---|---|
| `src/pages/admin/Plans.tsx` | 「新增方案」、列表「編輯」、「啟用」開關 |
| `src/pages/admin/Profile.tsx` | 「儲存變更」、頭像上傳、各輸入欄位變唯讀 |
| `src/pages/admin/Signals.tsx` | 「發布訊號／週記」、列表「編輯」、「收回」 |

## 變更方案

### 通用模式
1. **按鈕**：保留渲染，加 `disabled={isReadOnly}`，並包 `<Tooltip>`：「您沒有此操作的權限」
2. **輸入欄位**：保留可見，加 `readOnly` 或 `disabled`；不再條件性隱藏
3. **開關 (Switch)**：保留可見，加 `disabled`
4. **點擊兜底**：若按鈕無法用 `disabled`（例如 `<Link>` 卡片），改為 `onClick` 攔截並 `toast.error("您沒有權限執行此操作")`

### 視覺規範
- 沿用 shadcn `disabled:opacity-50 disabled:cursor-not-allowed`
- Tooltip 統一文案：「僅限方案擁有者或公司管理員操作」
- 唯讀欄位顯示淡灰底（`bg-muted/50`），右側不放儲存按鈕者改放灰色「唯讀」徽章

### 個別調整
- **Plans.tsx**：Dialog 內所有欄位若 `isReadOnly` 改 readOnly，Footer 的「儲存」改 disabled + Tooltip
- **Profile.tsx**：頭像上傳區塊改顯示但 disabled；表單欄位全部 readOnly；底部「儲存變更」disabled + Tooltip
- **Signals.tsx**：「發布」按鈕 disabled + Tooltip；列表行內「編輯／收回」disabled + Tooltip

## 不在範圍

- 後端 RLS 變更（DB 層級權限維持不變）
- 新增權限角色或調整 `company_admin` 範圍
- 其他頁面（`admin/Subscribers.tsx`、`admin/Performance.tsx` 等本來就無寫入操作）

## 變更檔案

- `src/pages/admin/Plans.tsx`
- `src/pages/admin/Profile.tsx`
- `src/pages/admin/Signals.tsx`

