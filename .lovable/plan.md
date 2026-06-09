# 修正計畫：收盤分析個股名稱顏色過淡

## 問題定位
目前你截圖那個「收盤分析」頁面，實際不是走 `DailyReportPanel.jsx`，而是走：
- `src/checkup/components/freecheckup/DailyTab.jsx`

真正造成字太淡的原因是這兩處把 AI 內文 markdown 都用次要字色渲染：
- `Md text={dailyReport.aiInsight} color={C.textSec}`
- `Md text={r.aiInsight} color={C.textSec}`

所以你圈的個股名稱、正文、條列一起被渲成淡灰，不是資料問題，也不是 demo 問題。

## 我要改什麼
1. 只修 `DailyTab.jsx` 目前生效的兩個 AI 內文入口
   - 目前報告區塊
   - 歷史記錄展開預覽區塊
2. 把 markdown 文字色從 `C.textSec` 改成主文字色 `C.text`
3. 不動其他區塊（日期、說明字、按鈕、非 AI 內文），避免 scope 擴散

## 驗證範圍
我會完整檢查這次需求相關的所有顯示入口，不只抽樣：
- `DailyTab.jsx` 當前報告 AI 內文
- `DailyTab.jsx` 歷史報告展開 AI 內文
- `Md.jsx` 是否會被父層 `color` 正常繼承
- 確認 `FreeCheckup.jsx` 目前 daily 分頁確實掛的是 `DailyTab`
- 確認沒有其他同一路徑的 `aiInsight` 顯示仍殘留 `C.textSec`

## 技術細節
- 已確認路由鏈：`FreeCheckup.jsx` -> `DailyTab.jsx`
- `Md.jsx` 的一般段落/條列/編號項目都會吃傳入的 `color`
- 因此改 `DailyTab.jsx` 兩個 `Md` 呼叫點即可直接影響你截圖那塊個股名稱顏色

## 完成標準
- 收盤分析內文中的個股名稱不再是過淡灰字
- 同段正文可讀性提升，但不影響其他 muted label
- 歷史記錄展開時的 AI 報告也同步變深，不再前後不一致