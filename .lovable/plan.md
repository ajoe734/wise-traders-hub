# Plan：HoldingCardHeader 導入 per-signal 教學片段徽章

## 需求
在 `HoldingCardHeader` 的 `.wb-tags` 列末端新增 `.wb-tip` 教學徽章：
- **資料源**：優先讀 `meta.tip`（字串）或 `meta.tips[]`（陣列，取第 0 個顯示、其餘進 title 換行）。
- **Fallback**：兩者皆缺 → 依 `actionLabel` 分流靜態文案（見下）。
- **aria-label 不變**：不影響卡片外層 `aria-label`；徽章自身用獨立 `aria-label`。

## Fallback 文案表（依 action，全繁中）
```
ADD / BUY / 加碼 / 買進     → 「進場前先確認風險比例」
REDUCE / SELL / 減碼 / 賣出 → 「分批減碼保留紀律」
HOLD / 續抱                 → 「續抱請設好停損」
其他 / 空字串               → 「持倉檢視小提醒」
```
分流放在 `getFallbackTip(actionLabel)` 純函式，方便單測窮舉。

## 元件變更（`HoldingCardHeader.tsx`）

1. `useMemo` 派生 `tipInfo`：
   ```ts
   const tipInfo = useMemo(() => {
     const list = Array.isArray(meta?.tips) ? meta.tips.filter(s => typeof s === 'string' && s.trim()) : [];
     const single = typeof meta?.tip === 'string' && meta.tip.trim() ? meta.tip.trim() : '';
     const primary = single || list[0] || '';
     const source = primary ? 'meta' : 'fallback';
     const text = primary || getFallbackTip(actionLabel);
     const extra = list.slice(single ? 0 : 1);   // hover title 顯示更多
     return { text, source, extra };
   }, [meta?.tip, meta?.tips, actionLabel]);
   ```
   deps 僅含 `meta.tip / meta.tips / actionLabel`，符合現有 ref-stability 憲法。

2. 徽章 DOM（放在 `{onReportMeta && ...}` 之前，屬於 `wb-tags` 內、`marginLeft: 'auto'` 之前）：
   ```tsx
   <span
     className="wb-tip"
     data-tip-source={tipInfo.source}
     data-tip-action={actionLabel || ''}
     title={[tipInfo.text, ...tipInfo.extra].join('\n') || undefined}
     aria-label={`教學提示：${tipInfo.text}`}
     style={{
       fontSize: 10, color: tagColor, letterSpacing: '0.08em',
       padding: '4px 8px', background: tagBg,
       border: `1px dashed ${reportBorder}`, borderRadius: 0,
       opacity: tipInfo.source === 'fallback' ? 0.7 : 1,
     }}
   >{tipInfo.text}</span>
   ```
   - `data-tip-source ∈ {"meta","fallback"}`：測試 hook。
   - `hasTags` 需擴充為 `industries.length > 0 || meta?.strategy || onReportMeta || true`（徽章恆存在），因此改為總是渲染 `.wb-tags` 容器。
   - 為避免視覺回歸，若 industries 與 strategy 都空且無 onReportMeta，仍渲染容器 + 徽章 —— 這是新規範。

3. Fallback 函式：
   ```ts
   export function getFallbackTip(actionLabel) {
     const k = String(actionLabel || '').trim().toUpperCase();
     if (/^(ADD|BUY)$/.test(k) || /加碼|買進/.test(actionLabel || '')) return '進場前先確認風險比例';
     if (/^(REDUCE|SELL)$/.test(k) || /減碼|賣出/.test(actionLabel || '')) return '分批減碼保留紀律';
     if (/^HOLD$/.test(k) || /續抱/.test(actionLabel || '')) return '續抱請設好停損';
     return '持倉檢視小提醒';
   }
   ```
   放在同檔頂部 `export`，方便單測 import。

## 卡片外層 aria-label 不變的守門
- Header 只設 `.wb-tip` 自己的 `aria-label`；卡片外層由 `HoldingCard.tsx` 控制，不改。
- 新增回歸測試斷言：注入 tip 前後 `card.getAttribute('aria-label')` 完全相同。

## 新增測試

### `__tests__/HoldingCardHeader.tip.test.tsx`（單元）
1. `getFallbackTip` 表格測試：ADD/BUY/加碼/買進/REDUCE/SELL/減碼/賣出/HOLD/續抱/空字串/未知 12 條案例，逐一比對。
2. Render 案例：
   - `meta.tip='自訂A'` → 徽章文字=自訂A、`data-tip-source=meta`、`aria-label=教學提示：自訂A`。
   - `meta.tips=['A','B','C']` → 徽章文字=A、`title` 含 `A\nB\nC`、source=meta。
   - `meta` 缺、`actionLabel='ADD'` → 文字=進場前先確認風險比例、source=fallback、opacity=0.7 style。
   - `meta={}`、`actionLabel=''` → 文字=持倉檢視小提醒。
   - 卡片外層 `aria-label` 不受影響（比對前後值全等）。
   - `industries=[]`、`strategy` 空、`onReportMeta` 未傳 → `.wb-tags` 仍渲染且含 `.wb-tip`（新規範）。
3. Ref-stability：追加至既有 `HoldingCard.refStability.test.tsx` 對應 case —— 改 `pctVal` 不重算 `tipInfo`（deps 不含 pctVal）；改 `meta.tip` 才會變更 tipInfo 引用。

### `e2e/freecheckup-tip-badge.spec.ts`（Playwright，390 寬）
1. 導頁 demo → 收集所有 `.wb-card`：每張都有 `.wb-tip`，`data-tip-source ∈ {meta, fallback}`。
2. 對每張卡：`card.aria-label` 與從 seed 推得的預期值一致（沿用 sparkline-signs 的採樣邏輯）—— 這守住外層 aria 不被 Header 變更污染。
3. `.wb-tip` `aria-label` 開頭必為 `教學提示：`，文字非空。
4. Fallback 分流：以 `data-tip-action` + `data-tip-source=fallback` 篩出卡片，斷言其文字對應 `getFallbackTip` 表。
5. 新增 project `iphone-390-tip-badge`（沿用 `freecheckup-sparkline-signs` 的 viewport 設定與 IO stub）。

## `playwright.config.ts` 變更
新增一個 project 條目：
```ts
{ name: 'iphone-390-tip-badge',
  testMatch: /freecheckup-tip-badge\.spec\.ts/,
  use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
```

## 非目標 / 明確不動
- 不改卡片外層 `HoldingCard.tsx` 的 `aria-label` 邏輯。
- 不動 sparkline / ROI / footer 派生。
- 不建雲端表、不改 seed 資料（tip 由呼叫端後續慢慢供）。
- 不加動畫、不加點擊展開 Modal（後續 iteration 再議）。

## 驗收
```
bunx vitest run src/checkup/components/freecheckup/_ui/holdingCard/__tests__/HoldingCardHeader.tip.test.tsx
bunx vitest run src/checkup/components/freecheckup/_ui/holdingCard/__tests__/HoldingCard.refStability.test.tsx
bunx playwright test --project=iphone-390-tip-badge --reporter=list
bunx playwright test --project=iphone-390-sparkline --project=iphone-390-a11y --reporter=list   # 迴避回歸
```
全綠即完成。
