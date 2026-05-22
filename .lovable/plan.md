# Line 綁定為什麼是「一個專家一次」？

## 先說結論：這是業務本質決定的，不是設計偷懶

平台上**每位專家／分析師都有自己獨立的 LINE 官方帳號（OA）**（資料庫欄位 `experts.line_oa_id`、`line_channel_name`、`qr_code_url` 都是 per-expert）。

所以「綁定」這件事，其實是在回答：
> 「你（user X）在 專家 A 的 LINE OA 裡，是哪一個 LINE 使用者？」

這個對應關係，**對每個專家都不一樣**——因為使用者要先去**加那位專家的官方帳號為好友**，OA 才有辦法推訊號給你。沒加好友 → 平台再怎麼綁也推不出去。

這也是為什麼程式裡是 `member_line_bindings (user_id, expert_id, line_user_id)` 三元組，而不是單純 `user.line_user_id`。

## 那「用 LINE 登入平台」呢？是同一件事嗎？

**不是，完全是兩件事。** 這在專案核心規則裡明文記載：

- **LINE 登入平台**：用的是 _LoginChannel_，回答「你是哪個 legendflow 帳號」 → 一次就好。
- **LINE 訊號綁定**：用的是 _各專家的 MessagingChannel（OA）_，回答「你在這位專家的 OA 裡是誰」 → 訂幾個專家就要綁幾次。

兩邊的 LINE userId 在技術上甚至不一樣（同一個人在不同 channel 會拿到不同 ID），所以**就算你用 LINE 登入了，也無法自動推斷你在「股海老牛」OA 裡是誰**。

## 真正令人困惑的是 UI，不是業務邏輯

目前 `/account/profile` 那張「LINE 綁定（即將開放）」假卡片，把人誤導去以為「綁定 = 一鍵一次搞定」。實際機制其實已經完整實作了，只是入口爛。

## 提案：把 Profile 的 LINE 區塊改成這樣

把現在那張死卡片換成「我訂閱中的專家 LINE 通知狀態」清單：

```text
┌─ LINE 訊號通知 ──────────────────────────────────┐
│ 為什麼每位專家要分別綁定？                       │
│ 每位專家有自己的 LINE 官方帳號，你需要先加他的   │
│ 好友，平台才能透過該 OA 推訊號給你。             │
│                                                  │
│ ┌──────────────────────────────────────────┐    │
│ │ [頭] 股海老牛 OA          ✓ 已綁定        │    │
│ │      LINE 暱稱：Wayne                     │    │
│ │                              [解除綁定]   │    │
│ └──────────────────────────────────────────┘    │
│ ┌──────────────────────────────────────────┐    │
│ │ [頭] 阿格力 OA            未綁定          │    │
│ │      加入好友：@agriculture   [QR]        │    │
│ │                            [取得驗證碼]   │    │
│ └──────────────────────────────────────────┘    │
│ ┌──────────────────────────────────────────┐    │
│ │ [頭] 某顧問 OA            尚未訂閱        │    │
│ │                              [前往訂閱]   │    │
│ └──────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

每張卡其實就是直接複用既有的 `LineBindingCard` 元件——所有邏輯（生成碼、realtime 更新、解綁、QR）都已經寫好了，只差掛載。

## 改動範圍

**單檔即可**：`src/pages/account/Profile.tsx`

1. 移除現有「LINE 綁定（即將開放）」的死卡片（lines 188–209）。
2. 換成新區塊：
   - 一段一行的說明：「每位專家有獨立 LINE 官方帳號，需分別綁定」+ 一個小 tooltip／可摺疊「為什麼？」。
   - 用 `useMemberSubscriptions()` 拉目前 active 訂閱清單。
   - 對每個訂閱中的專家，用 `expert_id / slug / name / avatar / line_oa_id / line_channel_name / qr_code_url` 渲染一個 `<LineBindingCard ... compact={false} />`。
   - 沒有任何訂閱時：顯示空狀態「你目前沒有訂閱專家，訂閱後即可在這裡設定 LINE 通知」+ 連 `/experts`。
3. `useMemberSubscriptions` 已經 join 到 `experts` 但**沒有**選 `line_oa_id / line_channel_name / qr_code_url` 三個欄位，需要小幅補上 select。

## 不在範圍

- 不動 webhook / 推播邏輯（本來就 OK）。
- 不動 LINE 平台登入流程。
- 不動其他頁面已掛載的 `LineBindingCard`（例如 ExpertDetail）。

## 技術備註

- `useMemberSubscriptions.ts` 的 select 從 `experts(id, slug, name, avatar_url, role, status)` 擴成 `experts(id, slug, name, avatar_url, role, status, line_oa_id, line_channel_name, qr_code_url)`，並在 `MemberSubExpert` interface 補欄位。這三個欄位是公開可讀的（experts 表的公開 profile 欄位），不會踩 RLS。
- `Profile.tsx` 從 `@/hooks/useMemberSubscriptions` import。
- 純前端 + 顯示用既有 hook，不需要 migration、不需要 edge function 改動。

確認方向 OK 就直接做。
