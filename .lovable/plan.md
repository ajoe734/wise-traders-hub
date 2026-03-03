

# 公司後台功能增強計畫

## 概述
在現有公司後台基礎上，新增 2 個頁面、強化 2 個現有頁面。所有改動僅限於 `/company/*` 路由，不影響其他模組。

---

## 一、操作紀錄查看頁面（新增）

路由：`/company/audit-logs`

功能：
- 從現有 `audit_logs` 資料表讀取資料，顯示所有管理操作紀錄
- 表格欄位：時間、執行者（透過 profiles 對應名稱）、動作類型、目標類型、詳情
- 支援搜尋（動作類型、執行者名稱）
- 按時間倒序排列，載入最近 100 筆

不需要建立新資料表，`audit_logs` 已存在且有 RLS 政策。

---

## 二、營收數據視覺化（強化現有頁面）

頁面：`/company/revenue`

新增內容：
- 月營收趨勢折線圖（使用已安裝的 recharts）
- 各分析師營收貢獻佔比圓餅圖
- MRR（月經常性收入）指標卡片
- 保留現有的統計卡片和分析師一覽表格

資料來源：現有 `payment_transactions` + `experts` + `member_subscriptions`，不需要新資料表。

---

## 三、退款功能（強化現有頁面）

頁面：`/company/payments`（交易紀錄 tab）

新增內容：
- 已付款的交易新增「退款」按鈕
- 點擊後跳出確認 Dialog，填寫退款原因
- 確認後將交易狀態更新為 `refunded`
- 同時寫入 audit_logs 紀錄退款操作
- 已退款的交易不顯示退款按鈕

不需要新資料表，使用現有 `payment_transactions` 的 `refunded` 狀態。

---

## 四、系統公告功能（新增）

路由：`/company/announcements`

需要新建資料表：
```text
announcements 表：
- id (uuid, PK)
- title (text, 必填)
- content (text, 必填)
- status (enum: draft/published, 預設 draft)
- published_at (timestamptz)
- created_by (uuid)
- created_at (timestamptz)
```

RLS 政策：company_admin 可完整 CRUD，一般登入用戶可查看已發布公告。

頁面功能：
- 公告列表（含草稿/已發布篩選）
- 新增/編輯公告 Dialog（標題 + 內容）
- 發布/取消發布切換
- 刪除公告（含確認）

---

## 五、共用修改

### CompanyLayout 側邊欄
新增兩個導航項目：
- 操作紀錄（`/company/audit-logs`，圖示：ScrollText）
- 系統公告（`/company/announcements`，圖示：Megaphone）

### App.tsx 路由
新增兩條路由，均需 `company_admin` 權限保護。

---

## 涉及檔案

| 檔案 | 動作 |
|------|------|
| `src/pages/company/AuditLogs.tsx` | 新增 |
| `src/pages/company/Announcements.tsx` | 新增 |
| `src/pages/company/Revenue.tsx` | 修改（加圖表） |
| `src/pages/company/Payments.tsx` | 修改（加退款） |
| `src/components/layouts/CompanyLayout.tsx` | 修改（加導航） |
| `src/App.tsx` | 修改（加路由） |
| DB Migration | 新增 announcements 表 + enum + RLS |

所有改動僅限公司後台，不影響分析師後台、會員端、LINE Mini-App 等其他模組。

