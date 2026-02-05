
## 問題診斷（為什麼深色模式看不到）
目前提示條在深色模式用了：
- `dark:bg-white`：背景變成白色
- `dark:text-foreground`：文字變成 `foreground`

而在 `src/index.css` 裡，`.dark` 模式的 `--foreground` 是接近白色（0 0% 98%），所以結果變成「白底白字」，整條提示在深色模式下就像消失了一樣。

---

## 解法方向
改成只使用設計 token 的「前景/背景互換」特性，讓它自動在不同主題下呈現深色對比：

- Light mode：`bg-foreground` = 黑、`text-background` = 白
- Dark mode：`bg-foreground` = 白、`text-background` = 黑

也就是：
1. 移除 `dark:bg-white`
2. 移除 `dark:text-foreground`
3. 把文字顏色統一放在 `<a>` 上，讓 icon / span 直接繼承（避免再出現某個子元素覆蓋成不對的顏色）

---

## 要修改的檔案
- `src/pages/line/Performance.tsx`

---

## 具體修改內容（將提示條改成 token 自動反相）
### 1) 更新提示條 `<a>` 的 className
把目前這段（重點：`dark:bg-white`）：
```tsx
className="flex items-center gap-3 px-3 py-2.5 bg-foreground dark:bg-white rounded-lg hover:opacity-90 transition-opacity"
```

改成（重點：加 `w-full`、加 `text-background`、移除 `dark:bg-white`）：
```tsx
className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-foreground text-background hover:opacity-90 transition-opacity"
```

（可選加強可及性，建議加上 focus ring）
```tsx
className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-foreground text-background hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
```

### 2) 移除子元素上的顏色覆蓋（避免再出現白底白字）
把：
```tsx
<Monitor className="h-4 w-4 text-background dark:text-foreground shrink-0" />
<span className="text-sm text-background dark:text-foreground flex-1">
...
<ChevronRight className="h-4 w-4 text-background dark:text-foreground shrink-0" />
```

改成讓它繼承父層 `text-background`：
```tsx
<Monitor className="h-4 w-4 shrink-0" />
<span className="text-sm flex-1">
...
<ChevronRight className="h-4 w-4 shrink-0" />
```

---

## 驗收標準（你可以怎麼確認修好了）
1. 在 `/line/zhao-advisor/performance`：
   - 淺色模式：提示條是黑底白字，清楚可見
   - 深色模式：提示條是白底黑字，清楚可見
2. Icon（螢幕與箭頭）在兩種模式都看得到
3. 點擊提示條能正常開啟 `https://wise-traders-hub.lovable.app/app/performance`

---

## 風險與備註
- 這個修法完全使用既有的 CSS token（`--foreground` / `--background`），不會引入硬編碼顏色，也不需要新增任何 CSS。
- 其它地方有使用 `dark:bg-white/xx` 是合理的（半透明用法），但像這次 `dark:bg-white` + `dark:text-foreground` 這種「同時變白」就很容易踩雷。這次會用更安全的模式處理。

---

<lov-actions>
<lov-suggestion message="請在 /line/zhao-advisor/performance 用淺色/深色各測一次，確認提示條可見且可點開網頁版">端到端測試（淺色/深色）</lov-suggestion>
<lov-suggestion message="把提示條加入 focus ring 與 hover 動效（例如輕微陰影或縮放），提升可點擊感與可及性">加強可點擊感與可及性</lov-suggestion>
<lov-suggestion message="把提示文案改成更具體，例如「網頁版可看：回撤、月度熱力圖、分布圖」提升轉換">優化文案提高轉換</lov-suggestion>
<lov-suggestion message="把連結改成可帶 expertSlug 參數（例如 /app/performance?expert=zhao-advisor），讓網頁版能直接對應同一位老師">連結帶參數對應同一位老師</lov-suggestion>
<lov-suggestion message="在提示條點擊時做簡單事件紀錄（例如 localStorage 次數或 GA/埋點），衡量有多少人從 LINE 跳去網頁版">加入點擊追蹤</lov-suggestion>
</lov-actions>
