
# /free-checkup 持倉決策工作台重構

## 核心原則（不可偏離）
1. **決策工具優先**：所有設計選擇，優先考慮「掃描速度」與「可讀性」
2. **報酬率一眼可見**：即使細字風格，數字必須是視覺主軸
3. **1 秒理解狀態**：exit / review / hold 透過位置 + 顏色 + 標籤同時表達
4. **資訊密度不可犧牲**：qty / cost / 市值 永遠在卡片底部固定位置
5. **節奏穩定**：避免為設計感加入不必要變化
6. **體驗優先於風格**：衝突時一律以使用體驗為優先

---

## 一、設計系統（克制版色票）

```
背景 Paper:    #EFEDE8 (溫暖米白)
卡面 Surface:  #FFFFFF / #F7F5F0
墨色 Ink:      #1E1E1D (主文字、ink 卡背)
次文字 Mute:   #6B6862
細線 Hair:     rgba(30,30,29,0.08)
強調 Accent:   #EC662D (僅用於 review 卡與小圓點)
漲 Up:         #C0392B (台股紅，僅數字)
跌 Down:       #2E7D5B (台股綠，僅數字)
```

字級：
- 報酬率主數字：32–48px / weight 400（細但夠大）
- 卡片標題：15px / weight 500
- 次資訊：11–12px / weight 400 / `tabular-nums`

---

## 二、版面結構

### 桌面版（≥1024px）
```
┌─────────────────────────────────────────────────┐
│  Hero 摘要列 (高 120–140px)                     │
│  總市值・總報酬・今日損益・部位數                │
└─────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────┐
│  今日優先 (橫向 chip 列, 高 56–64px)            │
│  ● 2330 出場  ● 2454 檢視  ● 3008 檢視         │
└─────────────────────────────────────────────────┘
┌──────────────────────────────┬──────────────────┐
│  持倉卡片牆 (3 欄 grid)      │  Detail Panel    │
│  ┌────┐┌────┐┌────┐         │  (sticky 360px)  │
│  │exit││rev ││hold│         │                  │
│  │span2          │          │  選中股票        │
│  └────────┘                 │  研究筆記         │
│  ┌────┐┌────┐┌────┐         │                  │
│  └────┘└────┘└────┘         │                  │
└──────────────────────────────┴──────────────────┘
```

### 手機版（<768px）
- Hero 縮為兩行摘要
- 今日優先：橫向滑動 chip
- 卡片：單欄直向流，每張 high 約 160px
- 點擊 → 全螢幕 Detail Drawer

---

## 三、卡片設計（統一版型）

每張卡片 **固定 4 個區塊由上而下**，無論大小卡都一致：

```
┌───────────────────────────────┐
│ 2330 台積電         [出場]    │  ← Header (代碼名稱 + 狀態標籤)
│                               │
│ -8.42%                        │  ← Hero (報酬率，最大字)
│ -NT$ 12,500                   │     (絕對損益，次大)
│                               │
│ 半導體・短線・10 天            │  ← Tags (細字一行)
│ ─────────────────────────     │
│ 100 股 · 成本 580 · 市值 53k │  ← Footer (資訊密度，固定)
└───────────────────────────────┘
```

### 視覺變體（嚴格配額）
| 變體 | 用途 | 數量上限 | 樣式 |
|------|------|----------|------|
| `ink` | 最高優先 exit | **1 張** | 黑底白字、span 2 欄、報酬率 48px |
| `accent` | 最緊急 review | **最多 2 張** | 橘色細左邊條 + 白底、span 1 欄、報酬率 36px |
| `plain` | 其他全部 | 不限 | 白底細外框、span 1 欄、報酬率 32px |

**配額邏輯**（於 `useHoldingDecision` 加入 `assignCardVariants`）：
1. 依 urgency + |pct| 排序
2. exit 中最緊急 1 張 → `ink`
3. review 中最緊急前 2 張 → `accent`
4. 其餘 → `plain`

---

## 四、Hero 摘要（不搶戲）

高度 120–140px，水平排列 4 個 KPI：

```
總市值          今日損益         累積報酬         部位
NT$ 1,234,567   +NT$ 8,200      +12.4%          8 檔
                +0.66%
```

- 數字 28–32px / weight 400
- 標籤 11px mute
- 中間用細直線分隔，無背景色塊

---

## 五、今日優先（chip 列）

水平捲動，每個 chip：
```
● 2330 台積電  -8.4%  出場
```
- 高度 56px
- 左側小圓點（exit=ink, review=accent）
- 點擊 → 滾動至該卡片並選中
- 最多顯示前 5 檔

---

## 六、Detail Panel（右側 sticky）

寬度 360px，內容由上而下：
1. **代碼名稱**（小字）
2. **報酬率主數字**（48px）+ 絕對損益
3. **Decision Box**：建議動作 + 一句話原因
4. **Thesis**：投資論點摘要（從 dossier 取，<100 字）
5. **目標 / 停損**：兩個小數字 + 進度條
6. **事件時間軸**：近期 3–5 筆相關事件（從 events store 取）
7. **觀察筆記**：可編輯文字框（連 dossier.notes）
8. **操作列**：「加入今日複盤」/「標記已處理」

排版：行高 1.7、欄位間 20px 留白、無背景色塊、僅用細線分隔。

---

## 七、互動規則
- 點擊卡片：極淡 active 狀態（背景色 +3% 亮度）+ 左側 2px ink 細條
- 不使用：scale、強陰影、translateY hover
- 鍵盤：↑↓ 切換、Enter 開 detail（手機）
- Detail Panel 在桌面版始終可見，預設選中第一張高優先卡片

---

## 八、檔案異動

### 新增
- `src/checkup/components/holdings/HoldingsWorkbench.jsx`（總容器，左右分欄）
- `src/checkup/components/holdings/HoldingHero.jsx`（頂部摘要）
- `src/checkup/components/holdings/PriorityStrip.jsx`（今日優先 chip 列）
- `src/checkup/components/holdings/HoldingCard.jsx`（單張卡片，含 3 變體）
- `src/checkup/components/holdings/HoldingDetailPanel.jsx`（右側研究面板）
- `src/checkup/components/holdings/holdingsTokens.js`（色票常數，集中管理）

### 修改
- `src/checkup/hooks/useHoldingDecision.js`：
  - 加入 `assignCardVariants(decisions)` 函式
  - 回傳 `{ variant: 'ink'|'accent'|'plain', span: 1|2 }`
  - 套用配額規則（1 ink + max 2 accent）
- `src/pages/FreeCheckup.jsx`：
  - 將持倉 tab 的 inline JSX 替換為 `<HoldingsWorkbench />`
  - 串接 events store / research store 給 Detail Panel
  - 保留現有 Hero 損益區的資料來源不變，僅換版面

### 不動
- `HoldingsTable.jsx`：保留以防其他頁面引用，但 `/free-checkup` 不再使用

---

## 九、驗收標準（自我檢查）
- [ ] 報酬率在 1 秒內可從畫面任一角落找到
- [ ] exit / review / hold 三狀態無需閱讀文字也可分辨
- [ ] qty / cost / 市值 在每張卡片同一位置
- [ ] 同一畫面 ink 卡片 ≤1、accent 卡片 ≤2
- [ ] Hero 高度 ≤140px，不壓縮主操作區
- [ ] 桌面版 Detail Panel 始終可見，無需滾動
- [ ] 手機版單欄流暢，卡片高度 ≥160px
- [ ] 無強陰影、無 scale hover、無大色塊警示

完成後將提供桌面版（1280×800）與手機版（390×844）截圖驗收。
