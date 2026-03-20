

## 在導覽列新增「試用版」頁面（iframe 嵌入第三方網站）

### 你需要向對方取得的資料

| 項目 | 說明 |
|------|------|
| **完整網址 (URL)** | 例如 `https://demo.theirsite.com`，這是 iframe 的 `src` |
| **允許 iframe 嵌入** | 對方必須確認其伺服器 **沒有** 設定 `X-Frame-Options: DENY` 或 `Content-Security-Policy: frame-ancestors 'none'`。若有，iframe 會被瀏覽器擋掉，對方需改為 `frame-ancestors https://你的網域` |
| **是否需要傳參數** | 例如 token、用戶 ID 等，透過 URL query string 傳入 |

> **重要**：如果對方網站禁止 iframe 嵌入（很多網站預設禁止），這個方案就行不通，需改為「新分頁開啟」。建議先請對方確認。

### 實作步驟

1. **新增頁面 `src/pages/Trial.tsx`**
   - 全螢幕 iframe，`src` 指向對方提供的 URL
   - 設定 `sandbox` 屬性以控制安全性（依需求開放 `allow-scripts allow-same-origin` 等）

2. **新增路由**
   - 在 `App.tsx` 加入 `/trial` 路由，使用 `PortalLayout` 包裹

3. **更新導覽列**
   - 在 `PortalLayout.tsx` 的 `navLinks` 陣列中新增 `{ href: '/trial', label: '試用版' }`
   - 桌面版與手機版選單會自動套用

### 對方需要做的事（給對方的 checklist）

```text
1. 提供可公開存取的完整 URL
2. 在伺服器設定中允許 iframe 嵌入：
   - Nginx:  add_header X-Frame-Options "ALLOW-FROM https://你的網域";
   - 或用 CSP: Content-Security-Policy: frame-ancestors https://你的網域;
3. 確認 HTTPS（HTTP 會被瀏覽器 mixed-content 政策擋掉）
4. 若需要登入或傳遞參數，告知參數格式
```

