# 訂閱者預覽 — 模擬已訂閱使用者進 App

## 現況問題
`AdminLayout` 的「訂閱者預覽」按鈕只是把分析師自己（已登入狀態）導去公開銷售頁 `/expert/{slug}?preview=1`，那是**未訂閱訪客的銷售頁**，所以看起來像「沒登入」。實際上分析師是登入的，只是沒模擬「已訂閱」身分進 App。

## 目標
分析師／公司管理員按下按鈕 → 用自己的帳號、但被視為「該 expert 的已訂閱者」進入 `/app`，能看到訂閱者實際會看到的訊號／週記／專家頁。

## 實作步驟

### 1. AdminLayout 按鈕行為調整
- 點擊時 `sessionStorage.setItem('previewExpertSlug', slug)`，然後 `window.open('/app/expert/' + slug, '_blank')`。
- 開新分頁仍共用 localStorage 的登入 session（已登入）。

### 2. 新增 `usePreviewMode(slug)` hook
- 讀 `sessionStorage.previewExpertSlug`。
- 驗證 `user.expertSlug === previewSlug || hasRole('company_admin')`，否則回傳 `false`（防偽造）。
- 預覽僅是「UI 層解鎖」，不寫 DB、不發訂閱。

### 3. 全域 `<PreviewBanner />`
- 掛在 `UnifiedAppLayout` / `AppLayout` 頂部。
- 顯示：「預覽中：以 {專家名稱} 訂閱者身分檢視 ・ [退出預覽]」。
- 退出 = 清 sessionStorage + 關分頁（或 `navigate('/admin/'+slug)`）。

### 4. 受影響頁面強制視為已訂閱
在這些頁面把訂閱判斷改為 `isSubscribed || isPreviewForThisExpert`：
- `src/pages/app/ExpertDetail.tsx` — `isSubscribed` 強制 true，隱藏 CTA、顯示「已訂閱」卡片。
- `src/pages/app/Signals.tsx` + `SignalsDashboard.tsx` — 該 expert 的 advisor 訊號放行。
- `src/pages/app/Journals.tsx` + `JournalDetail.tsx` — 該 expert 的 mentor 週記放行。
- `src/pages/app/AppHome.tsx` — 該 expert 出現在「我的訂閱」清單。
- `src/pages/app/SignalDetail.tsx` — 同上放行。

### 5. RLS 確認（重要技術風險）
分析師對「自己的」signals／mentor_journals 在 owner 角度本來就有 SELECT 權，所以查得到。但要確認：
- `signals`、`mentor_journals` 的 SELECT policy 對 owner/company_admin 是否放行（不需訂閱）。
- 若被擋，預覽會「畫面解鎖但資料是空的」。
- 若有缺，補一條 `USING (is_owner_or_admin(expert_id))` 的 SELECT policy（不影響既有訂閱者規則）。

→ 計畫第一版先實作 1–4，並在 5 跑一次實機驗證；若資料載不出來再追加 RLS migration。

## 技術細節
```text
[後台]                           [新分頁 /app]
按「訂閱者預覽」                  ┌─ PreviewBanner 顯示
  │                              │  「預覽中：以 ○○ 身分檢視」
  │ 寫入                         │
  ▼                              │
sessionStorage                    │
 previewExpertSlug = slug         │
  │                              │
  └─ window.open('/app/expert/'+slug)
                                  │
                                  ▼
                       usePreviewMode(slug) 驗證身分
                       → isPreview = true
                       → 各頁面把 isSubscribed 視為 true
```

## 不做的事
- 不假登入、不切換 Supabase session（會洩漏分析師自己的資料權限差異）。
- 不寫測試訂閱進 DB。
- 不影響真實訂閱者。
