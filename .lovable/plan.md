## 真正的元兇（從 network + 程式碼確認）

進 `/expert/sharkgu` 慢的原因**不是 bundle 大小**，是執行期的三個 bug，請看 network 證據：

```text
profiles?...   GET 200  784ms
user_roles?... GET 200  785ms
profiles?...   GET 200  924ms     ← 同一筆 user 重打第 2 次
user_roles?... GET 200 1048ms
profiles?...   GET 200 1091ms     ← 第 3 次
user_roles?... GET 200 1215ms
```

**`fetchUserProfile` 在進入頁面時被觸發 3 次並行**，每次都是 (profiles + user_roles) 一對，合計 6 個請求，串行延遲到 1.2 秒。這是進頁面卡住的主因。

### Bug #1 ─ AuthContext dedupe guard 設計錯誤（最致命）

`src/contexts/AuthContext.tsx` line 152–184：

```ts
if (!forceReload && loadingUserRef.current === userId && user) {
  return;  // ← 守衛條件包含 `&& user`
}
loadingUserRef.current = userId;   // ← 但 ref 是在 await 之前才寫
setIsLoading(true);
const profile = await fetchUserProfile(...)  // ~800ms
setUser(profile)                              // ← user 在這之後才有值
```

進場 0~800ms 內 supabase 會連續觸發 `INITIAL_SESSION`、`SIGNED_IN`、`USER_UPDATED`、`TOKEN_REFRESHED` 等多次事件，每次走 `setTimeout(() => loadProfile, 0)`。由於 `user` 還是 `null`，守衛失效，**全部都進到 fetchUserProfile 並行打 supabase**。

**修法**：把守衛拆成兩段，並把 ref 在 await **之前**就 commit：

```ts
const inFlightRef = React.useRef<Promise<void> | null>(null);

const loadProfile = useCallback(async (sbUser, forceReload = false) => {
  const userId = sbUser.id;
  // 同 user 已在飛 → 回傳同一個 promise（不再發第 2 個請求）
  if (!forceReload && loadingUserRef.current === userId && inFlightRef.current) {
    return inFlightRef.current;
  }
  loadingUserRef.current = userId;
  setSupabaseUser(sbUser);
  setIsLoading(true);

  inFlightRef.current = (async () => {
    try {
      const profile = await fetchUserProfile(userId, sbUser.email || '');
      if (loadingUserRef.current === userId) setUser(profile);
    } finally {
      if (loadingUserRef.current === userId) setIsLoading(false);
      inFlightRef.current = null;
    }
  })();

  return inFlightRef.current;
}, []);   // ← 去掉 [user] 依賴，避免每次 setUser 都重建 callback
```

預期：6 個 auth 請求 → **2 個（一對 profiles + user_roles）**，省 ~3.5 秒。

### Bug #2 ─ `PerformanceOverviewPanel` 立刻載 recharts（394KB raw / 107KB gz）

`ExpertProfile.tsx:350` 在 Hero 下方第二屏就 render `<PerformanceOverviewPanel>`，這個元件靜態 import recharts。即便使用者沒捲下去，整個 vendor-recharts chunk 都被拉進來，**首屏多 1.5 秒 script 解析**（network 顯示 recharts.js 1505ms）。

**修法**：包 `LazyOnVisible` + `React.lazy`：

```tsx
const PerformanceOverviewPanel = React.lazy(() =>
  import('@/components/strategy/PerformanceOverviewPanel')
    .then(m => ({ default: m.PerformanceOverviewPanel }))
);
// 使用時
<LazyOnVisible minHeight={400} rootMargin="200px">
  <Suspense fallback={<div className="h-96 animate-pulse bg-muted/30 rounded-lg" />}>
    <PerformanceOverviewPanel ... />
  </Suspense>
</LazyOnVisible>
```

預期：recharts chunk 從首屏移除，**首屏 -107 KB gz**。實際只有使用者捲到「績效總覽」區段才下載。

### Bug #3 ─ Footer CLS 0.214（needs improvement）

`browser--performance_profile` 抓到 footer 在頁面 render 後位移 0.214。應該是 `PortalLayout` 的 footer 高度沒鎖定，等到字型或 logo 載入後才膨脹。

**修法**：給 footer 容器 `min-height` 鎖死（或 `aspect-ratio`），確認 logo `<img>` 有顯式 width/height。

### 不會動的（避免誤會）

- ExpertProfile 主查詢已經有正確的 `cancelled` flag，且 expert→plans→subs+count 已盡量並行，**這段沒問題**。
- supabase client 本身（先前提案的 P5-A）不動，因為 ROI 太低。

### 預期成效

| 指標 | 現在 | 修完後 |
|---|---|---|
| auth 請求數（進頁面） | 6 串行 | 2 |
| auth 耗時 | ~5 秒 | ~0.8 秒 |
| 首屏需載 recharts | 是 | 否（捲動才載） |
| Footer CLS | 0.214 | < 0.05 |
| 首屏 JS 量 | 含 recharts | -107 KB gz |

要我直接動手嗎？三個 bug 都改，預期進 `/expert/:slug` 從「很久」變「<1 秒首屏」。