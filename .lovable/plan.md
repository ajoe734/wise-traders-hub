# 修復：登入後跳到會員戰情室而不是回付款頁

## 根因

`src/pages/_checkout/OrderSummaryCard.tsx` 第 124 行的「登入後付款」按鈕：

```tsx
<Button asChild>
  <Link to="/auth/login">登入後付款</Link>
</Button>
```

是純連結，**沒有寫入 `sessionStorage.redirect_after_login`**。

`Login.tsx` 登入成功後的回跳優先序是：
1. `sessionStorage.getItem('redirect_after_login')`（沒有）
2. `company_admin` → `/company`
3. `user.expertSlug` → `/admin/{slug}`
4. **fallback → `/app`** ← 你被丟到這裡

對照 `Checkout.tsx:312` 與 `CheckupCheckout.tsx:94` 的「未登入自動導向」分支都有正確設定 sessionStorage，只有這顆手動按鈕漏掉。

## 修改

**只動一個檔案**：`src/pages/_checkout/OrderSummaryCard.tsx`

把該 Button 從 `<Link>` 改成 `onClick` handler：

```tsx
const handleLoginRedirect = () => {
  sessionStorage.setItem(
    'redirect_after_login',
    `${window.location.pathname}${window.location.search}`
  );
  navigate('/auth/login');
};

<Button onClick={handleLoginRedirect} className={...} size="lg">
  登入後付款
</Button>
```

需要 `import { useNavigate } from 'react-router-dom'`。

## 驗證

1. 登出狀態進入 `/checkout/sharkgu/<planId>`
2. 點「登入後付款」
3. 完成 email/password 或 LINE 登入
4. 應該回到 `/checkout/sharkgu/<planId>`，**不是** `/app`

LINE 登入路徑也涵蓋——`Login.tsx` 的 `handleLineLogin` 已經會讀 `location.state.from`，但 sessionStorage 是更穩的 fallback（OAuth round-trip 後 location state 可能遺失）。

## 範圍外（這次不動）

- `redirect_after_login` 機制本身（已是現行慣例）
- `Login.tsx` 回跳優先序
- LINE callback 流程
