## Decision Workbench 13 項精修

僅修改 `src/pages/FreeCheckup.jsx`，不動其他檔案。

### Hero
1. 加 `Today's P&L` 小標（11px、`WB.inkMute`、letter-spacing 0.12em）
2. 主數字字重 `300 → 500`
3. 主貨幣數字改 `WB.ink`，僅百分比保留 `WB.accent`
4. 百分比與主數字 baseline 對齊，間距 12px

### Action Priority
5. 兩行排版：上行「代號 名稱」、下行事件描述（11px、`WB.inkMute`）
6. 右側箭頭按鈕改 28px 圓形 1px hair 細線框

### Card Wall
7. 卡片維持白底，加 `1px solid WB.hair`、`border-radius: 0`
8. Sparkline 移到右上，與股名同列，60×20px
9. ROI 字重 `500`、`%` 字級 `0.45em → 0.55em`
10. Tags 改 filled chip：背景 `#F4F2EE`、無框、padding 4px 8px
11. 底部資料條改雙區塊：左 `TODAY ${pnl} ${pct}%`、右 `VALUE ${value}`，1px 直線分隔
12. Feature card（黑底）同步：Sparkline 白 stroke、tag `rgba(255,255,255,0.08)`

### Detail Panel
13. 主 ROI 數字改 `WB.ink`，未實現損益子行才用 `WB.accent`

### 不會做
- 不改背景色
- 不抽出新元件
- 不動 Sparkline 抓取邏輯
