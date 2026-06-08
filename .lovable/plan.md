
## 結論：不是雲端壞掉，是跨帳號 LocalStorage 洩漏

### 根因（已用 DB 驗證）

我直接比對受害帳號的雲端資料：

- 受害者 `d877ab36-…` 雲端 `pf-holdings-v2` = **0 筆**（正確，他剛登入沒輸入）
- 但 `checkup_trade_memos` 卻有 **28 筆**，最後寫入 2026-06-08 08:22
- 另一個帳號 `368462f1-…` 也是 **28 筆**，且兩邊 `(date, action, code, qty, price)` **28/28 完全相同**

→ 100% 是同一支手機上「上一個 LINE/Email 帳號」的交易被當成新帳號的初始資料寫進雲端。

#### Bug 位置：`src/hooks/useFreeCheckupBootstrap.js` L156、L159

```js
const { data } = await supabase.from("checkup_trade_memos").select("*")...;
if (data && data.length > 0) {
  l = data.map(...);
} else {
  l = loadLocal("pf-log-v2", []);   // ← 未隔離 owner！
}
} catch {
  l = loadLocal("pf-log-v2", []);   // ← 同上
}
```

其他 pf-* key 都用 `loadScopedLocal`（檢查 `pf-ls-owner` 是否等於當前 uid），唯獨 trade memos fallback 漏掉。新帳號 hydrate 後 800ms auto-save 就把上一個帳號的資料寫進自己的雲端。

#### 「交易紀錄雲端同步失敗」toast 是副作用

`FreeCheckup.jsx` L842 在 insert 時保留了客端 `l.id` UUID：

```js
...(typeof l.id === "string" && l.id.length === 36 ? { id: l.id } : {}),
```

洩漏進來的 `l.id` 已經屬於原帳號的 row，PK 全表唯一，delete `.eq('user_id', uid)` 只清得掉自己的，但 insert 撞到別人的 id → unique violation → throw → toast。

看板顯示「22 / 50 positions」是 UI 用這 28 筆交易反推出來的持倉。

---

## 修復計畫

### 1. bootstrap fallback 改 scoped（`src/hooks/useFreeCheckupBootstrap.js`）

L156、L159 的 `loadLocal("pf-log-v2", [])` 改成 `loadScopedLocal("pf-log-v2", [], userId)`，與 holdings/targets/news 一致。

### 2. trade memos insert 永不帶客端 id（`src/pages/FreeCheckup.jsx` L841-852）

拿掉 `...(typeof l.id === "string" && l.id.length === 36 ? { id: l.id } : {})`，永遠讓 DB 用 `gen_random_uuid()` 產 id。本機 state 不靠這個 id 對映，移除無副作用，可徹底擋掉任何 cross-user PK 衝突。

### 3. 一次性 LocalStorage sweeper（`useHoldingsMigration` 加 v3 標記）

進 `FreeCheckup` 時若 `pf-ls-owner` 缺失或與當前登入 uid 不符，主動清掉所有 `pf-*` key（保險：即使有其他 fallback 漏網之魚也不會中招）。

### 4. 受害客戶資料清理（migration / insert tool）

對 `d877ab36-8aee-4392-9042-4a7d9b728bae`：
- `DELETE FROM checkup_trade_memos WHERE user_id = 'd877ab36-…'`（28 筆都是洩漏的）
- 同時把 `checkup_storage` 內 key in ('pf-log-v2', 'pf-holdings-v2', 'pf-targets-v1', 'pf-news-events-v1', 'pf-analysis-history-v1', 'pf-reversal-v1', 'pf-brain-v1', 'pf-calendar-v1', 'pf-calendar-holdings') 的列一併刪除，確保下次登入 hydrate 出空白狀態
- 也請客服請客戶在手機按一次「重置」（或仰賴第 3 步的 sweeper 自動清掉）

### 5. 全面巡查（不准偷懶）

`rg -n "loadLocal\\(" src` 把所有「未 scoped 的 loadLocal 呼叫」逐個檢視，只要該 key 名單在 `CLOUD_SYNC_KEYS` 內、又有 fallback 寫雲行為的，一律改 scoped。回報前列出所有命中點與處置決定。

---

## 驗證

- 模擬：A 帳號登入 → 加 5 筆交易 → 登出 → B 帳號登入，B 看到 0 holdings、0 trade memos，雲端 `checkup_trade_memos` 不會被寫入 A 的紀錄
- 連點 saveTradeLogToCloud 10 次：無 PK 衝突、無 toast
- 對 `d877ab36` 跑清理 SQL 後，請客戶重整 → 看板回到空狀態
- `bunx playwright test e2e/freecheckup-card.spec.ts` 不可 regression

---

## 風險

- 拿掉客端 id 後，舊客端在重整瞬間可能看到 row 順序變動（800ms debounce + 全量 replace，重整即一致），可接受
- v3 sweeper 會清掉 owner 不符的 pf-* localStorage — 但那本來就不屬於當前帳號，是正確行為

按「實作此計畫」我就動工，第 4 步的 DELETE 會用 migration 流程提出讓你核可。
