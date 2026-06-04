## 1. Bug 現場還原

兩張截圖完整還原問題：

- 圖 1：在 iOS LINE in-app browser（IAB）裡點 LINE 登入，OAuth 回到 `legendflow.tw` 時 iOS 跳「要在 LINE 中打開嗎？」系統對話框（Universal Link / `line://` scheme 攔截）
- 圖 2：點下去之後到了 `/auth/line-callback?token_hash=…&type=magiclink`，畫面顯示「登入驗證失敗，請重試」

那行字是 `src/pages/auth/LineCallback.tsx:74` 的分支——也就是 `supabase.auth.verifyOtp({ token_hash, type: 'magiclink' })` 回了 error。

## 2. 為什麼上一次「修好了」其實沒修

目前流程：

```text
LINE OAuth
  └─ edge: line-login-callback
       └─ generateLink({type:'magiclink', email}) → hashed_token
       └─ 302  /auth/line-callback?token_hash=X&type=magiclink
            └─ client verifyOtp({token_hash})   ← 單次性、消耗一次就死
```

`hashed_token` 是 Supabase 的**單次性 OTP**，在以下任一情境會被消耗或失效：

1. **LINE IAB / iOS link preview / Universal Link handover** 會先 GET 一次目標 URL → 第一次 verifyOtp 已經被消耗
2. iOS 系統對話框「要在 LINE 中打開嗎？」造成頁面被開兩次（取消 → 打開、或不同 webview 各開一次）
3. React useEffect deps 變動觸發二次 mount（即使非 StrictMode）
4. 使用者按重整、返回再進

只要這個 token 在 client 暴露，第二次呼叫就一定失敗。前一輪的修復（client-side guard / sessionStorage 去重）治不了 IAB 在另一個 webview 預讀的情況——那個 webview 不共享 sessionStorage。

**結論：token 不能交到 client 手上，必須在 server 完成 OTP→session 交換，client 只拿可重複使用的 access/refresh token。**

## 3. 徹底修復方案：server-side nonce 流程

### 流程圖

```text
LINE OAuth
  └─ edge: line-login-callback (改造)
       ├─ LINE code → profile → user upsert（既有，不動）
       ├─ generateLink({type:'magiclink', email})  取得 action_link
       ├─ server-side fetch action_link，redirect:'manual'
       │     從 Location 的 fragment 解出 access_token / refresh_token
       ├─ INSERT into line_login_nonces (nonce, access_token, refresh_token,
       │                                 user_id, expires_at = now()+60s)
       └─ 302  /auth/line-callback?nonce=UUID&return_to=…

Client /auth/line-callback (改造)
  └─ POST  edge: line-login-exchange-nonce { nonce }
       ├─ service role: SELECT … FOR UPDATE + DELETE 一次性
       ├─ 過期或已用 → 404
       └─ 回 { access_token, refresh_token }
  └─ supabase.auth.setSession({access_token, refresh_token})
  └─ waitForSession → window.location.replace(return_to)
```

關鍵差異：

- IAB 預讀拿到的 URL 只含 `nonce`，預讀那一次會把 nonce 消掉，但 `access_token` / `refresh_token` 還沒寫進 client。使用者真正打開時 nonce 已死 → 顯示明確錯誤並導回登入。
- 但如果預讀**沒有發生**（多數情境），真實使用者第一次打開就成功。
- access_token / refresh_token 是 durable session token，client 拿到後就算重整或 IAB 再開一次都不會失效。
- verifyOtp 整個從 client 移除，根本沒有「token 被消耗」的 race。

### 邊界處理

- nonce TTL：60 秒（足夠 client redirect + fetch；過期不能用）
- nonce 一次性：`DELETE … RETURNING *`，第二次取不到
- 防止舊 `token_hash` 流量：保留向後相容分支（顯示「登入連結已過期，請重新登入」並導回登入入口），但新流程一律走 nonce
- IAB 預讀仍可能消掉 nonce → 此時錯誤訊息要清楚（「登入連結已使用或過期，請重新登入」），並提供一鍵重新登入按鈕
- nonce 表只能 service_role 讀寫，anon/authenticated 完全無權限

## 4. 改動清單

### 4.1 Migration（新表 + 清理 job）

`line_login_nonces`：

| 欄位 | 型別 |
|---|---|
| nonce | uuid PK |
| user_id | uuid |
| access_token | text |
| refresh_token | text |
| expires_at | timestamptz |
| consumed_at | timestamptz null |
| created_at | timestamptz default now() |

RLS：enable，**不建立任何 anon/authenticated policy**，只 service_role 可讀寫。

GRANT：`GRANT ALL ON public.line_login_nonces TO service_role;`（不 GRANT 給 anon/authenticated）。

清理：可選擇加進現有 `traffic-cleanup` cron，或直接靠 expires_at 篩選讀取（每次讀都過濾掉過期的）。

### 4.2 Edge function `line-login-callback`（改）

在現有檔尾（generate magic link 那段）改成：

1. `generateLink({type:'magiclink', email})` 拿 `properties.action_link`
2. `fetch(action_link, { redirect: 'manual' })` → 從 302 Response.headers.get('Location') 解析 fragment（`#access_token=…&refresh_token=…&expires_in=…&token_type=bearer&type=magiclink`）
3. 解出 access_token / refresh_token，insert nonces 列
4. 302 到 `${siteUrl}/auth/line-callback?nonce=${nonce}&return_to=${safeReturnTo}`

失敗情境（fetch 失敗、fragment 缺欄位）→ 302 `?line_error=session_failed`，行為跟現在一樣。

### 4.3 Edge function `line-login-exchange-nonce`（新）

- POST `{ nonce: uuid }`
- service role atomic `DELETE … WHERE nonce=$1 AND expires_at > now() RETURNING access_token, refresh_token`
- 找不到 → 410 + `{ error: 'nonce_expired_or_used' }`
- 找到 → 200 `{ access_token, refresh_token }`
- `verify_jwt = false`（client 還沒登入）

`supabase/config.toml` 加：

```toml
[functions.line-login-exchange-nonce]
verify_jwt = false
```

### 4.4 Client `src/pages/auth/LineCallback.tsx`（改）

- 讀 `nonce`；若無 nonce 但有舊的 `token_hash` → 顯示「登入連結已過期，請重新登入」並導回 `/auth/login`（向後相容，不再呼叫 verifyOtp）
- 用 `useRef` guard 確保 exchange 只觸發一次
- 用 `supabase.functions.invoke('line-login-exchange-nonce', { body: { nonce } })`
- 拿回 tokens → `supabase.auth.setSession(...)`
- waitForSession → `window.location.replace(safeReturnTo)`
- error 文案改成中性的暗色（不是綠色）：「登入連結已使用或過期，請重新登入」+ 一個「重新登入」按鈕，按下去回 `/auth/login`

### 4.5 不動

- `line-login-authorize`：完全不動
- LINE OA webhook、LINE expert subscription binding：完全不動
- Email login、Google login：完全不動
- 首頁、pricing、持股看板、收盤分析：不動

## 5. QA 清單（強制窮舉）

| 場景 | 預期 |
|---|---|
| Safari 桌面，新 LINE 使用者第一次登入 | 成功，建帳號 |
| Safari 桌面，既有 LINE 使用者再登入 | 成功，不重複建帳號 |
| iOS Safari，IAB 預讀不發生 | 成功 |
| iOS LINE IAB 點登入 → iOS 「在 LINE 中打開？」對話框 | 不管選哪邊，最終成功（最多一次失敗訊息，導回後重來成功） |
| Callback 頁面被重整 | 顯示「連結已使用，請重新登入」，按鈕一鍵回登入頁 |
| 等 70 秒再開 callback URL | 顯示過期提示 |
| Email 登入 | 不受影響 |
| LINE OA 訂閱綁定 | 不受影響 |
| `line_login_nonces` 表 anon 直接讀 | 403/權限拒絕 |
| `line_login_nonces` 表 authenticated 直接讀 | 403/權限拒絕 |
| `line-login-exchange-nonce` 用相同 nonce 連呼兩次 | 第二次 410 |

## 6. 風險與相容

- **Migration**：新表 + GRANT + RLS enable，無 production data 異動。
- **Production data**：不動既有 profiles / auth.users / line bindings。
- **既有「待消化」的 token_hash URL**（極少）：上線後 60 秒內若有人剛收到舊格式 URL，會看到過期提示——可接受。
- **Security**：access_token 短暫存在 server-only DB 表（≤60s），用 service_role 隔離；比目前把 OTP 暴露在 URL 安全等級相同或更好。
- **Bundle**：client 端少了 verifyOtp 失敗分支，多了 invoke，net 變化 < 1KB。
- **不影響**：security findings、traffic 監控、checkup 配額、e2e。

## 7. 部署順序

1. Migration（新表）
2. Deploy `line-login-exchange-nonce`
3. Deploy `line-login-callback`（改）
4. Deploy client（`LineCallback.tsx` 改）

順序很重要：先表、再新函式、再改舊函式、最後 client，避免 client 拿到 nonce 但函式還沒上。

## 8. 完成定義

- 在 iOS LINE IAB → 系統對話框 → 任一選項 → 最終成功登入，console 看到 `[LINE-CB] ✅ Session ready`
- 主動重整 callback URL 看到清楚錯誤訊息與重新登入按鈕，不再是無動作的綠色文字
- 上述 QA 清單全綠
