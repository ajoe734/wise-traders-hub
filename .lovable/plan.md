## 問題

點分析師後台的「訂閱者預覽」會開新分頁到 `/app/expert/:slug`，畫面立刻被 AppErrorBoundary 接住顯示「頁面發生錯誤」。

根因在 `src/pages/app/ExpertDetail.tsx`：
- `useExpert`, `useQuery`, `useState`, `useEffect` 都在最上方。
- 但 **L131 的 `usePreviewMode()` 寫在三個 early return（`isLoading` / `isError` / `!expert`）之後**。
- 第一次 render 時 `isLoading=true` → 走 L103 return，這次只跑了前面那批 hooks。
- 資料載入完成第二次 render，跳過 early return → 才呼叫 `usePreviewMode()`。
- React 偵測到「render 次數間 hooks 數量不同」拋錯，整頁 unmount，AppErrorBoundary 接手。

這是純 Rules of Hooks 違規，跟資料、權限、preview 邏輯都無關，是新分頁進來必然觸發。

## 修正

把 `usePreviewMode()` 連同它衍生出來的純計算（`previewMatch` / `isSubscribedToFollower` / `hasHealthCheck` / `isSubscribedToCultivator` / `isSubscribed`）全部上移到所有 early return 之前，跟其他 hooks 放在一起。

- `usePreviewMode()` 在 `useExpert` 下方、第一個 `if (isLoading)` 之前呼叫。
- `previewMatch` 等 const 維持原來的算法不動，只是位置上移；它們用到的 `slug`、`subscribedPlanTypes` 在 early return 之前都已可用。
- `isAdvisor`、`mainPlan`、`mainMeta`、`isSubscribed` 因為依賴 `expert` 非 null，仍需放在 `!expert` 那個 return 之後；只有 hook 呼叫本身上移。

## 順手檢查（避免漏網）

同一份檔案的其他 hooks 已經在最上方，沒有別處違規。其他放有「訂閱者預覽模式」橫幅的頁面 `src/pages/PlanDetail.tsx`、`src/pages/ExpertProfile.tsx`、`src/pages/app/JournalDetail.tsx`、`src/pages/app/SignalDetail.tsx` 會一併快速掃一次 `usePreviewMode` / `useAuth` 等 hook 是否也被放在 early return 之後，有就一起修；目前看過 `JournalDetail.tsx` 沒問題，其餘兩個尚未細看，修檔時順帶確認。

## 驗證

1. 起 Playwright，注入 session 後直接訪問 `/app/expert/master-brcto`、`/app/expert/sharkgu`、`/app/expert/master-zhou` 三條真實 mentor slug，確認都不再出現「頁面發生錯誤」字串，且 console 無 `Rendered more hooks` / `Rendered fewer hooks` 警告。
2. 模擬從分析師後台流程：先寫入 `sessionStorage.previewExpertSlug`，再開 `/app/expert/<slug>`，畫面要顯示「已訂閱此專家」綠卡（preview 解鎖）且不報錯。

## 不動的範圍

- AppErrorBoundary、runtimeLogger、diagnostics 上傳機制不動。
- 訂閱者預覽的權限判定邏輯與按鈕本身不動。
