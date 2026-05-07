## 問題定位（已驗證）

DB 實況（剛查 `public.experts`）：
- 林修齊（lin-xiuqi）→ `status = suspended`
- 趙鵬博（zhao-pengbo）→ `status = suspended`
- 彥愷（sharkgu）→ `status = active`

DB RLS 沒問題：`Anyone can view active experts` policy = `status='active' OR (status='draft' AND is_tester)`，suspended 不會曝光給一般訪客。

**真正 Bug 在 `src/hooks/useExpert.ts` 的 `getVisibilityMode` / `filterExpertRows`：**

```ts
if (user?.roles.includes('company_admin') || user?.roles.includes('analyst')) {
  return 'privileged';  // ← privileged mode 直接 return rows; 不過濾任何 status
}
```

而你目前是用 `company_admin` 帳號登入（畫面右上有「管理後台」按鈕），所以：
1. RLS 放行所有 row（admin 有 full access policy）
2. `filterExpertRows('privileged')` 不過濾
3. → suspended 的林修齊、趙鵬博一起出現在 `/experts` 公開頁

換句話說 admin 自己在公開瀏覽頁看到的內容，跟一般訪客看到的不一致。同樣的問題也存在 `/app/explore`（同一個 `useExperts` hook）和 `src/pages/ExpertProfile.tsx`（雖然有 inline 檢查但同樣對 privileged 沒概念）。

## 修正計畫

### 1. `src/hooks/useExpert.ts` — 區分「公開瀏覽」與「後台管理」

公開頁面不該因為登入身分不同而看到不同的清單。把 privileged 行為從 hook 預設拿掉，只在後台明確要求時才回傳全部。

```ts
export function useExperts(opts?: { includeAllStatuses?: boolean }) { ... }
```

- 預設：忽略 `roles`，只看 `isTester`（active + tester 才看 draft）。suspended **永遠**過濾掉。
- `includeAllStatuses: true`：後台管理頁（`src/pages/company/Analysts.tsx` 等）才用，會回全部。

`useExpert(slug)` 同樣處理：公開 profile 不允許 suspended 進入，即使是 admin。

### 2. 同步調整 `src/pages/ExpertProfile.tsx`

目前 inline 條件 `status === 'active' || (status === 'draft' && isTester)`——其實已正確排除 suspended，但要再 double-check 不會因為 admin user 的 RLS full access 而誤透出。維持現狀即可，加註解。

### 3. 後台側維持原本「看得到 suspended」的能力

`src/pages/company/Analysts.tsx` 走的是直接 `supabase.from('experts').select('*')`（不經 hook），不受影響；不用改。

### 4. 更新測試

`src/test/integration/1.15-suspended-expert-visibility.test.ts` 內 `getVisibilityMode` / `filterExpertRows` 的 privileged 分支語意改了，要同步：privileged mode 在公開 hook 不再回傳 suspended；改測 `useExperts({ includeAllStatuses: true })` 才會回。

### 5. 驗證

- 用 admin 帳號重整 `/experts` → 應只剩彥愷一張卡。
- 用一般會員 → 一樣只剩彥愷。
- 用 tester → 多顯示 draft，仍不顯示 suspended。
- `/app/explore` 同步檢查。
- 後台 `/company/analysts` 仍可看到全部 3 位（含 suspended）以便管理。

## 為什麼之前「測試都過」卻仍出包

既有 drift test 只驗證 `filterExpertRows('default'/'tester')` 對 suspended 的過濾，**privileged 分支被當作 by-design 全放行**。實際使用情境：admin 開啟公開頁時，這個 by-design 就變成 bug。要把「公開頁」與「後台」的資料來源語意拆乾淨。
