## 目標

- 為 5 個 email 帳號重設統一密碼 `Mentor2026!`
- 為全部 6 個帳號（含 Line 登入的永維 Vincent）建立 mentor expert profile，狀態為 `pending` 等待後台審核上架

## 範圍

### A. 密碼重設（僅 5 個 email 帳號）

用 Supabase Admin API 把以下 5 個 user 的密碼統一設為 `Mentor2026!`：

| Email | display_name | user_id |
|---|---|---|
| sean.17371@gmail.com | Sean | 66905de9... |
| 888666crypto@gmail.com | MK | 76cc078d... |
| q0985956958@gmail.com | Ele | 60287045... |
| aa7545aa@gmail.com | 老佛爺 | d84454e0... |
| 8999.penguin@gmail.com | Benny | d8fa2533... |

> Line 登入的 `line_u8ed4e25...@line.local`（永維 Vincent）跳過密碼設定 — 他用 Line 登入即可。

實作方式：寫一支一次性的 Node 腳本（`scripts/reset-mentor-passwords.mjs`），用 `SERVICE_ROLE_KEY` 呼叫 `supabase.auth.admin.updateUserById(id, { password })`，跑完即可丟棄。

### B. 建立 expert mentor profile（6 個全做）

對每個帳號 INSERT 一筆 `public.experts`：

- `user_id` = 該帳號 id
- `name` = `profiles.display_name`
- `slug` = display_name 轉小寫拉丁化；若含中文則 fallback 到 `mentor-{user_id 前 8 碼}`，遇衝突補 `-2/-3`
- `role` = `mentor`
- `status` = `pending`（後台審核後再上架）
- `starting_capital` = `1000000`
- 其他欄位（bio / markets / avatar_url 等）留空，本人或後台之後補

實作方式：用 `supabase--insert` 直接 INSERT 6 筆，slug 我先查衝突再決定後綴。

## 流程

1. 先用 `supabase--insert` 建立 6 筆 expert pending profile（含 slug 衝突檢查）
2. 寫 `scripts/reset-mentor-passwords.mjs` 並用 `code--exec` 跑一次重設 5 個密碼
3. 回報每位導師的登入資訊（email + 統一密碼 + expert slug）給你，方便你通知本人

## 通知這 5 位導師時可用的訊息範本

```
您的 LegendFlow 實戰導師帳號已開通：
登入 Email：{email}
初始密碼：Mentor2026!
首次登入後請至「帳號設定」自行修改密碼。
帳號目前為待審核狀態，由後台確認資料後正式上架。
```

永維 Vincent 直接告知「用 Line 登入即可，導師帳號已建立、待審核上架」。
