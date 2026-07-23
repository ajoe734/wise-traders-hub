## 根因（已驗證）

### A. ChipsSection「假 sync」— 3443 案例
- `tw_bsr_sync_queue` / `tw_bsr_fetch_failures` / `tw_bsr_daily` where stock_id='3443' 全 0 rows
- `tw_institutional_daily` 有 4 天資料
- `ChipsSection.tsx:393-398` 走 `hasInst` 分支硬印「BSR 自動同步中 · 每 10 分鐘一輪」，實際上該檔從未排入 queue

### B. 「20 檔 vs 3 需要動作 + 其餘 16」帳不平
`HoldingsTab.tsx:296` 用 `H.length − (exitListCount + reviewListCount)`：分子是全部 exit/review 檔數，但上方只渲染 top 3 中 EXIT/REVIEW 的子集；第 4 個以後的 exit/review 檔既沒渲染在上方、又從下方摘要扣掉 → 卡片在畫面上真的消失。

---

## 修法

### Step 0 — 先查 schema（不假設）

執行前透過 read_query 確認：`tw_bsr_sync_queue` 是否確有 `priority / status / next_run_at / updated_at`；`tw_bsr_fetch_failures` 是否確有 `next_retry_at / resolved_at / reason`。若欄位命名不同，migration 與 RPC 對應調整；若欄位缺失，先在同一 migration 補齊。

### Step 1 — 互斥且完整的持倉分組（B 案根治）

在 `useHoldingsDerivations.js` 產出兩個實際渲染陣列，**topKeys 從原始 holding 計算**：

```ts
const uniqKey = (h) => `${h.market || 'TW'}:${h.code}`;
const uniqueHoldings = dedupBy(globalSortedList, uniqKey);

// 先在原始 holding 上決定 top 3，再轉換為顯示物件
const topRaw = uniqueHoldings
  .map((h) => ({ h, tag: tagOf(h, decisionsMap) }))
  .filter(({ tag }) => tag === 'EXIT' || tag === 'REVIEW')
  .slice(0, 3);

const topKeys = new Set(topRaw.map(({ h }) => uniqKey(h))); // ← 從原始 h 取，不從 buildActionItem 後的物件

const topActionableItems = topRaw.map(({ h, tag }) => buildActionItem(h, tag));
const remainingItems = uniqueHoldings.filter((h) => !topKeys.has(uniqKey(h)));

// invariant
console.assert(topActionableItems.length + remainingItems.length === uniqueHoldings.length);
```

- 上方「今日待辦」渲染 `topActionableItems`，`HoldingsActionPriority` 移除內部 `actionable.filter`
- 下方摘要與其他區塊改吃 `remainingItems` / `uniqueHoldings`
- `holdCount = remainingItems.length`
- **驗證條件**：第 4 個以後的 EXIT/REVIEW 必須真的以卡片形式出現在下方，不只是數字對

### Step 2 — Migration：清理重複 → 加 unique index → RPC

**先清理再建 index**（否則直接建會失敗）：

```sql
-- 0. 先確認欄位存在（read-only 檢查已在 Step 0 完成；此處假設 priority/status/next_run_at/updated_at 存在）

-- 1. 清理既有重複 active job：同 stock_id 保留最新 updated_at 一筆
WITH ranked AS (
  SELECT ctid, stock_id,
         ROW_NUMBER() OVER (PARTITION BY stock_id ORDER BY updated_at DESC, ctid DESC) AS rn
  FROM public.tw_bsr_sync_queue
  WHERE status IN ('pending','running')
)
DELETE FROM public.tw_bsr_sync_queue q
USING ranked r
WHERE q.ctid = r.ctid AND r.rn > 1;

-- 2. Partial unique index：一檔一 active job
CREATE UNIQUE INDEX IF NOT EXISTS ux_tw_bsr_sync_queue_active_stock
  ON public.tw_bsr_sync_queue (stock_id)
  WHERE status IN ('pending','running');

-- 3. Eligibility helper：查真實 metadata，區分原因
CREATE OR REPLACE FUNCTION public.tw_bsr_eligibility(p_stock_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_meta record;
BEGIN
  IF p_stock_id IS NULL OR NOT (p_stock_id ~ '^[0-9A-Za-z]{3,10}$') THEN
    RETURN jsonb_build_object('eligible', false, 'ineligible_reason', 'invalid_stock_id');
  END IF;

  -- 依實際 stock_names / stock_industry 判斷 asset type
  SELECT security_type, name INTO v_meta
    FROM public.stock_names
    WHERE stock_id = p_stock_id
    LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('eligible', false, 'ineligible_reason', 'missing_instrument');
  END IF;

  -- FinMind 分點僅覆蓋一般個股；ETF / 權證 / 受益憑證 / 可轉債 / DR 不 eligible
  IF v_meta.security_type IN ('ETF','warrant','beneficiary','convertible','dr','preferred') THEN
    RETURN jsonb_build_object('eligible', false, 'ineligible_reason', 'unsupported_asset_type',
                              'security_type', v_meta.security_type);
  END IF;

  RETURN jsonb_build_object('eligible', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.tw_bsr_eligibility(text) TO authenticated, anon;

-- 4. ensure_bsr_queued：advisory lock + ON CONFLICT DO NOTHING 兩層冪等
CREATE OR REPLACE FUNCTION public.ensure_bsr_queued(p_stock_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_elig jsonb;
  v_active record;
  v_failure record;
  v_next timestamptz := now();
  v_reason text;
  v_inserted integer;
BEGIN
  v_elig := public.tw_bsr_eligibility(p_stock_id);
  IF (v_elig->>'eligible')::boolean IS DISTINCT FROM true THEN
    RETURN v_elig || jsonb_build_object('created', false);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('bsr_queue:' || p_stock_id));

  SELECT status INTO v_active FROM public.tw_bsr_sync_queue
    WHERE stock_id = p_stock_id AND status IN ('pending','running')
    ORDER BY updated_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('eligible', true, 'created', false, 'status', v_active.status);
  END IF;

  -- 尊重 fetch_failures 冷卻
  SELECT next_retry_at, reason INTO v_failure FROM public.tw_bsr_fetch_failures
    WHERE stock_id = p_stock_id AND resolved_at IS NULL
    ORDER BY trade_date DESC LIMIT 1;
  IF FOUND AND v_failure.next_retry_at IS NOT NULL AND v_failure.next_retry_at > now() THEN
    v_next := v_failure.next_retry_at;
    v_reason := v_failure.reason;
  END IF;

  INSERT INTO public.tw_bsr_sync_queue (stock_id, priority, status, next_run_at, created_at, updated_at)
  VALUES (p_stock_id, 'high', 'pending', v_next, now(), now())
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object(
    'eligible', true,
    'created', v_inserted > 0,
    'status', 'pending',
    'next_run_at', v_next,
    'respected_backoff_reason', v_reason
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_bsr_queued(text) TO authenticated;
```

Dead / 超過 max attempts 只允許 `admin_reset_bsr`（另拆），一般頁不建。

### Step 3 — `tw-chips-detail` 純讀取

新欄位：

```ts
type BsrSyncStatus = {
  eligible: boolean;
  ineligible_reason: 'invalid_stock_id' | 'missing_instrument' | 'unsupported_asset_type' | null;
  security_type?: string | null;
  queued: boolean;
  status: 'pending' | 'running' | 'failed' | 'dead' | 'not_queued' | 'ineligible';
  next_run_at: string | null;
  attempts: number;
  error_code: string | null;   // 白名單映射（rate_limited / empty_rows / http_block …）
  retryable: boolean;
};
```

- 查最新 queue row 用 `ORDER BY updated_at DESC LIMIT 1`
- **不回傳** `last_error` 原文；`bsr_last_failure` 對外收斂為安全欄位
- 完整 `last_error` 只在管理員 RPC 中回傳

### Step 4 — `ChipsSection.tsx` 依真實狀態渲染 + 主動 ensure

移除 `hasInst` 硬印字串。加 `useRef` 防抖（僅是體感優化，冪等真正靠 DB）：

```tsx
const ensuredRef = useRef<string | null>(null);
useEffect(() => {
  if (!data?.bsr_sync_status) return;
  const s = data.bsr_sync_status;
  const key = `${stockCode}:${s.status}:${s.queued}`;
  if (s.eligible && !s.queued && !data.bsr_as_of && ensuredRef.current !== key) {
    ensuredRef.current = key;
    supabase.rpc('ensure_bsr_queued', { p_stock_id: stockCode })
      .then(() => setTimeout(refetch, 2000));
  }
}, [data?.bsr_sync_status?.queued, data?.bsr_sync_status?.status, data?.bsr_as_of, stockCode]);
```

Header 依 `status` + `ineligible_reason` + `error_code` 映射文案；輪詢條件改成 `status ∈ {pending, running}`。

### Step 5 — 測試

**Unit — 分組守恒**：
- `topActionableItems.length + remainingItems.length === uniqueHoldings.length`
- 4+ 檔 EXIT/REVIEW 時，第 4 檔在 `remainingItems`
- 相同 code 但不同 market 視為兩檔
- topKeys 用原始 holding key 產生（測試特意讓 `buildActionItem` 拿掉 market 欄位，仍要正確去重）

**E2E — `e2e/chips-section.spec.ts`**：
- 首次進入無 queue → 呼叫 `ensure_bsr_queued` 至少一次（**不斷言恰好一次**）
- 即使前端多次觸發或併發，DB 中 `SELECT count(*) FROM tw_bsr_sync_queue WHERE stock_id=? AND status IN ('pending','running')` ≤ 1（真正的冪等保證）
- 狀態進入 `pending` 或 `running` 皆算通過
- UI 不再出現「BSR 自動同步中 · 每 10 分鐘一輪」硬編碼字串
- `ineligible`（ETF fixture）/ `dead` / `failed` 各有對應中文文案
- 完成後（mock `bsr_as_of` 出現）UI 自動刷新

**E2E — 新增 `e2e/holdings-action-priority-invariant.spec.ts`**：
20 檔含 4 檔 EXIT/REVIEW → 上方 3 檔卡片 + 下方 17 檔卡片全部可見，第 4 檔 EXIT 位於下方。

---

## 明確不做（拆下一 task）

- `BsrRateLimit.tsx` 未排入 queue 監控清單
- 管理員完整 `last_error` API
- Dead 狀態一般使用者重啟入口

## 影響檔案

- `supabase/migrations/<new>_ensure_bsr_queued.sql`
- `supabase/functions/tw-chips-detail/index.ts`
- `src/checkup/hooks/useTwChipsDetail.ts`
- `src/checkup/components/freecheckup/ChipsSection.tsx`
- `src/checkup/hooks/useHoldingsDerivations.js`
- `src/checkup/components/freecheckup/HoldingsTab.tsx`
- `src/checkup/components/freecheckup/HoldingsActionPriority.tsx`
- 新增測試檔（Step 5）