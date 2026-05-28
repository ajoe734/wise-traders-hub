
# 全站江湖美術統一計畫（首頁優先）

## 一、現況診斷

掃過 `src/pages/Index.tsx` 後，首頁實際背景順序如下（淺=紙、深=墨）：

```
Hero            深墨    bg-black + 山景
三招定勝負      淺紙    bg-muted/50（三張卡都用山景背景，違反 01/02/03 差異化要求）
戰績區          深墨    #070707
過渡 spacer     淺→墨   140px 漸層條
選你的模式      淺紙    #EFE7D6 + 江湖底圖
會員戰情室      深墨    #0E0C0A（接 220-280px radial 紙→墨暈染）
持股看板        淺紙    bg-background（整段紫色 SaaS dashboard，最大破口）
週漲停榜        深墨    #0E0C0A（戰報感已到位）
如何開始        深墨    radial 漸層 + path B 用紫色 #8E6FA0（仙俠紫，違反江湖調）
Final CTA       淺紙    bg-card + 紫色按鈕
```

問題集中在三件事：
1. **紫色入侵**：持股看板、如何開始 path B、Final CTA 按鈕都是 `purple-600 / #8E6FA0`，是仙俠玄幻色，不是江湖。
2. **三招定勝負同質化**：三張卡都是山景背景，無法表達「訊號 / 戰略桌 / 卷宗」差異。
3. **淺↔深轉場不統一**：目前只有「選你的模式 → 會員戰情室」有處理過渡，其他淺深交界（三招↔戰績、戰情室↔持股看板、漲停榜↔Final CTA）都是硬切。

## 二、統一美術憲法（寫進 design tokens）

建立 `src/styles/jianghu-tokens.ts` 或在 `index.css` 加一組 `--jh-*` 變數，全站只能引用這些，不再硬寫 hex：

**淺色（日間山海卷軸）**
- `--jh-paper`        `#EFE7D6` 主紙色
- `--jh-paper-soft`   `#F5F0E6` 霧白
- `--jh-paper-edge`   `#E3D8C0` 紙緣
- `--jh-ink-faint`    `rgba(28,22,16,0.08)` 淡墨
- `--jh-earth`        `#8A6A48` 土褐
- `--jh-stone`        `#9C9387` 石灰
- `--jh-ember`        `#C45A20` 暗橘（淺底用）

**深色（夜間內門戰情室）**
- `--jh-ink`          `#0E0C0A` 主深墨
- `--jh-ink-soft`     `#1A1612` 炭黑
- `--jh-bronze`       `#3C2D20` 暗褐
- `--jh-iron`         `#4A4640` 鐵灰
- `--jh-candle`       `#EC662D` 燭火橘
- `--jh-dim-gold`     `#A88B4C` 低飽和暗金（取代目前 `#D4A643` 偏亮金）
- `--jh-parchment`    `#F4ECDB` 暗底文字色

**禁色**：所有 `purple-*`、`#8E6FA0`、`#C9A3D4`、`#A880B4`、藍紫 cyan 一律改為 `--jh-dim-gold` 或 `--jh-stone`。

## 三、區塊修正清單

### 1. 三招定勝負（L206-331）差異化
保留三卡並排結構，但換掉背景與視覺主體：
- **01 市場訊號痕跡**：背景改為深墨牆面 + 浮現的價量痕跡 / K 線殘影（不是山景）
- **02 戰略桌與五派**：背景改為俯瞰戰略桌 + 五派印記（沙盤、銅符、地圖）
- **03 卷宗與戰績**：背景改為翻開的卷宗冊頁 + 印章戳記
- 需要生成三張新圖（imagegen `premium` quality），保留現有 overlay 結構

### 2. 「持股看板」段（L1350-1432）整段重做美術
- 拿掉所有 `purple-*` class（icon 框、border-t-4、Badge、Button、AI 燈泡）
- 改成「江湖卷宗 + 暗金徽記」：icon 框用 `--jh-paper-soft` + `--jh-dim-gold` 細邊、Button 用 `--jh-candle` 主橘、AI Badge 用 `--jh-dim-gold` 文字 + 淡墨底
- 右側 mockup 卡片改成「持倉卷宗條目」樣式，與會員戰情室卡片同語言（紙紋 + 墨色細線 row）

### 3. 「如何開始」path B（L1741-1822）去紫
- path B 全段紫色 → 換成 `--jh-dim-gold`（修煉派暗金）或 `--jh-stone`（中性石色）系
- Button 漸層由 `#8E6FA0 → #6E5180` 改成 `#A88B4C → #7A6438`（暗金）或更克制的 `--jh-iron` 系
- 兩派色差仍然存在（橘 vs 暗金），但都落在江湖譜系內

### 4. Final CTA（L1838-1867）
- 免費健檢按鈕去紫，改用 outline 風格（透明底 + `--jh-candle` 邊+文字）
- 與探索專家主橘按鈕形成「實 / 虛」對比而非「橘 / 紫」衝突

### 5. 排行榜（L1437）
- 美術已對，但「本週戰報」標題語氣可再強化（eyebrow 換成「本週戰報 · WEEKLY DISPATCH」），暗金色改用 `--jh-dim-gold`，去掉過亮的 `#D4A643`

## 四、淺↔深轉場語言統一

定義可重用的「紙→墨」與「墨→紙」轉場元件 `<InkFade direction="paper-to-ink | ink-to-paper" />`，內部統一以下三層：

1. **底層**：120-160px 區段，背景連續 radial gradient（不是水平 bar），淺端 `--jh-paper` → 中段不規則 `--jh-bronze` 雲霧 → 深端 `--jh-ink`
2. **中層**：左右兩團 blur 28px 的紙/墨團（已在現有 spacer 用過，沿用同公式）
3. **頂層**：SVG fractalNoise 紙紋 380px，`mix-blend-overlay` `opacity 0.06`

套用位置（共 4 處淺深交界）：
- 三招（淺）↔ 戰績區（深）：插 `paper-to-ink`
- 會員戰情室（深）↔ 持股看板（淺）：插 `ink-to-paper`
- 漲停榜（深）↔ Final CTA（淺）：插 `ink-to-paper`
- 既有「選你的模式 → 會員戰情室」過渡：改用同一個 `<InkFade>` 元件，去除現場硬寫的 220-280px padding，由元件本身負責高度

不再有任何水平 `linear-gradient(to bottom, black, white)` 黑邊。

## 五、執行順序（建議分 build 階段）

1. **Step 1（基礎）**：建 jianghu tokens + `<InkFade>` 元件 + 四個交界全部換上
2. **Step 2（去紫）**：持股看板、如何開始 path B、Final CTA 三處去紫並改成暗金 / 暗石
3. **Step 3（差異化）**：三招生成新圖並替換背景（imagegen premium ×3）
4. **Step 4（細節）**：排行榜暗金統一、持股看板右側卡片改卷宗條目

每一步結束截圖驗收，不一次大改。

## 六、不動的東西

- Hero 結構與圖
- 兩張模式卡片內容
- 會員戰情室兩張卡片內容
- 排行榜資料與排版
- 任何路由 / 商業邏輯

## 七、技術細節（給工程參考）

- tokens 加在 `src/index.css` `:root` 與 `.dark` 區段，同時在 `tailwind.config.ts` `extend.colors.jh` 暴露，方便 `bg-jh-paper`、`text-jh-candle` 用法
- `<InkFade>` 放 `src/components/jianghu/InkFade.tsx`，props：`direction`、`height?`（預設 140px）、`paperColor?`、`inkColor?`
- 既有寫死的 `rgba(212,166,67,*)` 全文搜尋取代為 `--jh-dim-gold`
- 紫色搜尋關鍵字：`purple-`、`8E6FA0`、`C9A3D4`、`168,128,180`、`201,163,212`

請確認方向後我再進 build mode 依步驟實作。
