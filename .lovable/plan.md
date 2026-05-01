## 背景

訪客 (`isDemo`) 進入 `/free-checkup` 時有兩個一致性破口：

1. **持倉 tab 沒有 Demo 提示卡**：其他五個 tab（events / news / daily / log / 上傳成交）都有一張統一風格的「這是 DEMO XXX」說明卡，唯獨「持倉」只顯示「登入解鎖每月 1 次免費 AI 健檢」配額卡，文案沒提到「示範資料」，跟其他 tab 視覺斷層。
2. **頂部 DEMO Banner 滑走**：`DemoBanner` 渲染在 `FreeCheckup.jsx` line 2932，**沒有 `position: sticky`**。下方 line 2944「返回 + 戰情室」列才是 sticky，於是滾動時 banner 消失、只剩返回列釘在頂端。

## 修改範圍

只動兩個檔案，不碰其他 tab 既有提示卡。

### 1. `src/checkup/components/DemoBanner.jsx` — 改成 sticky
- 將外層容器加上：
  ```js
  position: 'sticky',
  top: 0,
  zIndex: 12,   // 比下方返回列 (zIndex:11) 高 1，疊在它上面
  ```
- 收合狀態的迷你列也套用同樣的 sticky 定位，這樣收合後仍會釘住。
- 背景沿用 `alpha(C.text,'06')`，但因為要 sticky，加一個保險的 `backdropFilter: 'saturate(1.05)'` 與不透明 fallback（`background: C.bg` 疊一層 6% text），避免半透明在滾動時看到底層內容透出來。

### 2. `src/pages/FreeCheckup.jsx` — 持倉頁新增 DEMO 提示卡
- 在 `DEMO_TAB_NOTICE_COPY`（line 488）加入：
  ```js
  holdings: {
    title: '這是 DEMO 持倉',
    body: '示範資料：8 檔虛構持倉與模擬報價。登入後可上傳成交截圖、自動建立你的真實持倉，並啟用 AI 健檢。',
  },
  ```
- 在 holdings tab block（line 3096 開頭、配額卡 line 3098 之**前**）插入一張與其他 tab 同款的提示卡：
  ```jsx
  {isDemo && (
    <div style={{ marginBottom: 12, padding: '12px 14px',
                  border:`1px solid ${C.border}`, borderRadius: 10,
                  background: alpha(C.text,'04') }}>
      <div style={{fontSize:12,fontWeight:500,color:C.text,marginBottom:4,letterSpacing:'0.02em'}}>
        {DEMO_TAB_NOTICE_COPY.holdings.title}
      </div>
      <div style={{fontSize:11,color:C.textMute,lineHeight:1.7}}>
        {DEMO_TAB_NOTICE_COPY.holdings.body}
      </div>
    </div>
  )}
  ```
- **保留**下方既有「登入解鎖每月 1 次免費 AI 健檢」配額卡 — 它是 quota meter，跟 demo 提示卡職責不同（一個說「資料是假的」、一個說「登入給你 1 次免費額度」），兩張卡上下排列即可，跟其他 tab 結構一致（其他 tab 也是「DEMO 說明卡 + 後續內容」）。

## 驗收

- 訪客進入 `/free-checkup` 持倉 tab：看到「這是 DEMO 持倉」說明卡 → 配額卡 → 持倉表格，三段層次跟其他五個 tab 一致。
- 從持倉頁往下滾，DEMO Banner（綠色 LINE 登入按鈕那條）持續釘在最頂端，下方「返回 + 戰情室」列接著它釘住，不再滑走。
- 點 Banner 的「×」收合後，迷你列也保持 sticky。
- 已登入用戶（非 demo）完全不受影響：Banner、提示卡都不渲染。
