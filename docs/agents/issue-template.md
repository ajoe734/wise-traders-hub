# Issue 範本：新功能

建立新功能 issue 時，複製本檔內容到 `.scratch/<feature-slug>/issues/NN-<slug>.md`，
把 `<>` 佔位符全部換掉。三個必填區塊（**驗收標準**、**頁面／路由**、**資料來源**）
缺一不可；沒填完的 issue 一律標 `needs-info`，不得標 `ready-for-agent`。

---

```markdown
# NN — <功能名稱>

Status: needs-triage
Priority: <P0 | P1 | P2 | P3>
Category: <feature | bug | enhancement | chore>
Blocked by: <NN, NN | None — can start immediately>

## What to build

<從使用者角度描述這張票做完之後「能做到什麼」，一段話，不要寫成分層實作清單。>

## 驗收標準

<!-- 可驗證的行為，每條都要能被人或測試判定過／不過；避免「優化」「改善」這種無法判定的字眼 -->

- [ ] <角色> 在 <情境> 下 <操作>，會 <可觀察的結果>
- [ ] <邊界情況：空資料／未登入／未訂閱／權限不足 時的行為>
- [ ] <錯誤情況：API 失敗、資料缺漏 時的畫面與文案>
- [ ] 手機（560 / 390 / 380px）版面正常，無溢出
- [ ] 既有測試全綠，並新增 <單元 | 整合 | e2e> 測試涵蓋上述行為

## 頁面／路由清單

<!-- 每一條新增或修改的路由都要列；沒有新路由就寫「無」並說明掛在哪個既有頁面 -->

| 路由 | 新增／修改 | 准入條件 | 說明 |
| --- | --- | --- | --- |
| `/<path>` | 新增 | 公開 / 需登入 / `subscriberOnly` / `requiredRole=company_admin` | <這頁做什麼> |
| `/<path>` | 修改 | | <改了什麼> |

深連結與導向：

- 進入點：<從哪些頁面／通知／LINE 訊息會連過來>
- 失敗導向：<未登入 → `/auth/login?next=`；無權限 → ?>
- 是否需要更新 `public/sitemap.xml`：<是／否>

## 資料來源

<!-- 讀寫的每一個來源都要列，含權限。禁止只寫「從後端拿」 -->

**讀取**

| 來源 | 型別 | 欄位／回傳 | 權限 |
| --- | --- | --- | --- |
| `<table_name>` | 資料表 | <欄位> | RLS：<policy 摘要> |
| `<rpc_name>` | RPC | | security definer？ |
| `<function-name>` | Edge Function | | 需要 JWT？cron key？ |
| <外部 API> | 第三方 | | 速率限制／快取策略 |

**寫入**

| 來源 | 動作 | 權限與稽核 |
| --- | --- | --- |
| `<table_name>` | insert / update | RLS policy、是否寫 audit log |

**衍生規則**

- 單位：<張／股／組／口，以及換算規則>
- 幣別：<TWD / USD，來源欄位與 fallback>
- 價格權威：<是否走 `priceResolver`／`useAuthoritativePrices`>
- 快取與更新頻率：<cron 時間、TTL>

## Out of scope

- <明確排除的項目，避免範圍蔓延>

## Comments

<!-- 後續討論往下追加 -->
```
