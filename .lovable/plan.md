# 訂閱者管理頁：同一人可能有兩個帳號的提示

## 背景（本次客訴的真實成因，已用資料庫查證）

- 邱郁惠有兩個帳號：Email `ajv1005@gmail.com`（彥愷「修煉派」active，9/02–10/02）與 LINE 帳號「Charlene 邱郁惠 🎀」（無任何訂閱）。
- 9/20 她先登入 LINE 帳號、再登入 Email 帳號；用 LINE 帳號看當然是空的。
- 可見性規則本身正確（mentor 七天回溯對 9/18 那批回傳 true），彥愷 110 篇全部已發布、0 篇待發布。
- 這次不合併帳號，改請她固定用 Email 登入。要做的是讓客服下次一眼看得出「這人有兩個身分」。

## 要做的事

### 1. 後端：新增重複身分偵測

在 `supabase/functions/admin-manage-users/index.ts` 新增 action `find_duplicate_identities`（company_admin 限定，唯讀）：

- 母體：`profiles` + `auth.users`（沿用現有 `listUsers` 取 email 的做法）。
- 判定為「疑似同一人」的訊號，任一命中即成立，並回傳命中原因：
  - 同一個 `line_user_id`（最強訊號）。
  - 顯示名稱正規化後相同或互相包含（去空白、去 emoji、去「Charlene」這類英文前綴後比中文姓名）。
  - email 本地部分相同（例如 `ajv1005@gmail.com` 與 `ajv1005@yahoo.com`）。
- 回傳每個群集：`user_ids`、各自 `login_method` / `email` / `display_name` / `last_sign_in_at`、各自是否有 active 訂閱。
- 只回傳「群集內至少一個有訂閱、且至少一個沒有」的群集（這才是會出事的型態）。

### 2. 前端：訂閱者列表加提示

`src/pages/company/Subscribers.tsx`：

- 新增 hook（比照 `useUserIdentities`）取重複身分群集，快取 60 秒。
- 命中的會員列，名稱旁加一個可點的標記：「可能有 2 個帳號」。點開顯示另一個身分的登入方式、email／LINE、最後登入時間、有無訂閱。
- 標記旁直接接既有的「代客綁定（合併）」按鈕，並附一行說明：合併會把資料集中到主帳號，另一個帳號登入後會是空的。
- 顏色不單獨承載意義，一律附文字。

### 3. 測試

- 單元測試：正規化與群集判定（同 LINE ID、中文姓名含英文前綴、email 本地部分相同、完全不同名不得誤判、兩邊都有訂閱不列入、兩邊都沒訂閱不列入）。
- 元件測試：命中時列上出現提示、點開顯示另一身分；未命中不得渲染任何提示。
- 以正式資料唯讀驗一次：邱郁惠這組必須被偵測到，並抽查不得出現明顯誤判。

### 4. Gate

focused tests、tsgo、`npm run check:module-boundaries`、build 全綠才算完成。不寫任何正式資料、不發通知、不 Publish。

## 不做

- 不自動合併任何帳號（合併一律由管理員手動按下）。
- 不改可見性／RLS 規則。
