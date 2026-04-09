
<plan>

## 公司資訊放置規劃

**公司名稱**：海洋福星生物科技股份有限公司  
**統一編號**：83479669

---

### 需要修改的位置

#### 1. PortalLayout 全站 Footer（影響所有公開頁面）
**檔案**：`src/components/layouts/PortalLayout.tsx`
- 將 copyright 行加入公司全名與統編：  
  `© 2026 海洋福星生物科技股份有限公司（統編：83479669）`
- 「關於我們」欄位下方可加一行公司資訊

#### 2. Legal 法律聲明頁 — 聯絡資訊
**檔案**：`src/pages/Legal.tsx`
- 將 `support@example.com` 替換為正式信箱（或保留待確認）
- 「聯絡我們」區塊加入公司全名與統編
- 加入公司登記地址（如有提供）

#### 3. CompanyLayout 公司後台 Sidebar Header
**檔案**：`src/components/layouts/CompanyLayout.tsx`
- 將「公司管理後台」改為顯示公司簡稱或保留現狀（內部使用，影響較小）

#### 4. 公司後台 Dashboard
**檔案**：`src/pages/company/Dashboard.tsx`
- 可在標題下方加一行公司名稱與統編，作為內部辨識

---

### 不需修改
- 前台首頁品牌名「智富股市實戰學院」維持不變（這是產品品牌名，非公司法人名稱）
- AdminLayout（分析師後台）不需要放公司資訊

### 技術細節
- 修改 4 個檔案，純文字替換，無資料庫或邏輯變動
- Footer 的 copyright 是全站共用，改一處即生效於所有使用 PortalLayout 的頁面

</plan>
