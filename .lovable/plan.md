## 重現結果

我用瀏覽器把你的流程跑一次：
1. 進 `/free-checkup`（訪客模式）
2. 點 DemoBanner「立即登入」→ 正確跳到 LINE 登入頁 ✅
3. 點「查看付費方案 →」→ 跳到 `/pricing#checkup` → **白屏**（你看到的問題）

接著我手動往下捲 1500px，內容完整在那裡（方案與價格、跟單派、修煉派、持股健檢、FAQ、Footer 全部正常）。所以**頁面其實有渲染**，但使用者一進來看到一片空白。

## 根因

`src/pages/Pricing.tsx` 第 874–881 行的 hash scroll 邏輯：

```js
useEffect(() => {
  if (window.location.hash === '#checkup') {
    setTimeout(() => {
      document.getElementById('checkup')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
  }
}, [plans.length]);
```

三個問題疊加：
1. **`setTimeout(200)` 不可靠**：`useCheckupPlans` 可能還沒回來，`#checkup` 區塊裡子元件 `CheckupPlansSection` line 899 寫了 `if (plans.length === 0) return null;`，於是 `#checkup` 容器存在但裡面是空的，scrollIntoView 把空容器推到視窗頂端 → 看到大片暗底。
2. **`behavior: 'smooth'`** 從頁面頂部一路滾到 #checkup 要 ~1 秒，這 1 秒內畫面就是「空白滑動中」。
3. **`block: 'start'`** 把 #checkup 貼到視窗頂端，由於 `scroll-mt-24` 只有 96px，視窗上半部就是 header 之上的空段。

## 修復計畫

### 1. 修 Pricing 頁的 hash scroll（最小改動）

`src/pages/Pricing.tsx` 第 874–881 行改成：
- 等 `plans.length > 0` 才 scroll（plans 還沒回來就先不滾，畫面停在頁首正常顯示）
- 用兩段 `requestAnimationFrame` 取代 setTimeout，確保 DOM commit + layout 完才滾
- 改 `behavior: 'auto'`（瞬移）+ `block: 'center'`（區塊置中，不會把上半部變空白）

### 2. 順手檢查整頁 dark/light theme 切換時機（可選，視 1 修完是否還白）

如果使用者用淺色主題切換時也會白，再追 `next-themes` 的 hydration mismatch；但這次截圖看起來純粹是 scroll 跳過頭，先做 1 即可。

### 3. 驗收

- 進 `/pricing#checkup` → 打開瞬間就停在「持股健檢」區段中央，不會出現任何全白/全黑畫面
- 進 `/pricing`（無 hash）→ 正常落在頁首
- DemoBanner 的 LINE 登入按鈕已驗證正常 ✅

### 檔案改動

- `src/pages/Pricing.tsx`（只動 hash scroll 那 8 行 useEffect）

確認後我就切回 default mode 修。
