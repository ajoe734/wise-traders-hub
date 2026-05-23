## 問題
`src/pages/app/Account.tsx` 的「我的訂閱」卡片只是純展示，頭像、名字、卡片本體都沒有 `Link`，所以無法點擊跳到老師頁面。

## 修改範圍
只改 `src/pages/app/Account.tsx`（純 UI，無 schema / 無 edge function）。

## 做法
在訂閱卡片內把老師頭像 + 名字包成 `<Link to={\`/app/expert/${sub.expert.slug}\`}>`：

- 頭像 `<img>`（L316-322）→ 包 Link，加 hover ring。
- 名字 `<h3>` (L325)→ 包 Link，加 `hover:underline`。
- `sub.expert.slug` 為空時不渲染 Link（fallback 純文字），避免連到 `/app/expert/`。

路由用 `/app/expert/:slug`（訂閱者專用，已在 `App.tsx` L228 註冊，與帳號頁同屬 AppLayout，導航體驗一致）；不採用 `/expert/:slug`（公開介紹頁）以維持登入後的 app 內導覽。

不更動：取消訂閱按鈕、續訂提醒、其他卡片樣式。

