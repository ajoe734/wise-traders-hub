

# 強化持倉 Decision UI 視覺權重（最終版）

## 設計原則

**高對比僅限決策狀態**，其餘維持 Kore-eda 低干擾。表格不會變成警示牆——hold 狀態完全保留現狀，只有 exit / review / conflict 三類進入高對比。

## 變更範圍

僅改 `src/pages/FreeCheckup.jsx` 持股列表渲染區，無新檔、無 DB、無 hook 變更。

### 1. 整列強調（克制版）

| 狀態 | 左側標記 | 背景 |
|---|---|---|
| `actionType=exit` | 3px 實心紅左 border | `alpha(C.down,'06')` 極淡紅底 |
| `actionType=review` 或 `urgency=now` | 3px 實心琥珀左 border | `alpha(C.amber,'05')` 極淡黃底 |
| `urgency=soon` | 3px 琥珀色左 border (40% opacity) | 無 |
| `hold` / 無事件 | 無 border、無背景（**完全維持現狀**） |

### 2. Action Badge — 實心高對比 pill（僅 exit / review）

```
exit   → 背景 C.down, 白字, fontSize 11, fontWeight 500, padding "2px 8px", radius 4
review → 背景 C.amber, 白字, 同上
hold   → 不顯示 badge（保持乾淨）
```

### 3. Thesis Badge

```
broken    → 紅實心 pill「論點破裂」
weakening → 琥珀實心 pill「論點弱化」
intact    → 不顯示
```

### 4. Conflict 強提示

紅底白字 pill「⚠ 衝突」+ 整列右上角 8px 紅點 `pulse` 動畫。

### 5. Urgency Dot

- `urgency=now` → 10px 紅實心圓 + `pulse`，置於股名左側
- `urgency=soon` → 8px 琥珀實心圓，無動畫
- 修掉目前 line 1777–1778 的重複渲染 bug

### 6. 排序預設改為「決策」

`sortBy` 初始值 `"decision"`，排序：`exit > review > hold`，同層按 `now > soon > later`。讓使用者進頁面就一眼看到關鍵決策。

### 7. CSS

確認 `@keyframes pulse { 0%,100% {opacity:1} 50% {opacity:0.4} }` 已註冊；缺則補上。

## 驗證流程（強制）

實作後立即執行：
1. `browser--navigate_to_sandbox` → `/free-checkup`
2. `browser--screenshot` 擷取持股列表
3. 確認 3443 / 3017 / 2308 三檔呈現三種明顯不同視覺狀態
4. **截圖貼回對話**（不只文字描述）
5. 若對比不足或過度，立即微調再截圖

## 記憶更新

更新 `mem://style/checkup/japanese-minimalist-aesthetic`：「低干擾為預設，但 decision exit / review / conflict / urgency=now 為高對比例外」。

## 不在範圍

- 重構持股列表為獨立元件
- 修改 decision 計算邏輯
- 修改其他分頁視覺權重

