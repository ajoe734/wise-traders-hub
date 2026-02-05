

# 修復：圖表節點點擊無反應問題

## 問題根因

Recharts 的 `dot` 自定義渲染返回的 SVG `<circle>` 元素上的 `onClick` 事件被 Recharts 內部事件系統覆蓋，導致點擊無法觸發 `handlePointClick`。

## 解決方案

使用 Recharts 的 **`onClick` 圖表級事件** 來捕捉點擊，而不是在個別 dot 上綁定事件。

---

## 修改檔案

### `src/components/strategy/PerformanceOverviewPanel.tsx`

**變更 1：在 AreaChart 上添加 onClick 事件處理**

```tsx
<AreaChart
  data={chartData}
  margin={{ top: 10, right: 100, left: -10, bottom: 0 }}
  onClick={(e) => {
    // e.activePayload 包含被點擊位置對應的數據點
    if (e && e.activePayload && e.activePayload[0]) {
      handlePointClick(e.activePayload[0].payload);
    }
  }}
>
```

**變更 2：修改 activeDot 使其可點擊並有視覺回饋**

```tsx
activeDot={{
  r: 6,
  fill: "hsl(var(--primary))",
  stroke: "hsl(var(--background))",
  strokeWidth: 2,
  cursor: "pointer",
  onClick: (e: any) => {
    // activeDot 的 onClick 可以正常工作
    if (e && e.payload) {
      handlePointClick(e.payload);
    }
  },
}}
```

**變更 3：簡化 dot 渲染（移除無效的 onClick）**

```tsx
dot={(props) => {
  const { cx, cy, payload } = props;
  const isSelected = payload.label === selectedPoint;
  return (
    <circle
      key={payload.label}
      cx={cx}
      cy={cy}
      r={isSelected ? 6 : 4}
      fill={isSelected ? "hsl(var(--primary))" : "hsl(var(--background))"}
      stroke="hsl(var(--primary))"
      strokeWidth={2}
      style={{ cursor: 'pointer' }}
      className="transition-all duration-200"
    />
  );
}}
```

---

## 完整修改對照

| 原本 | 修改後 |
|------|--------|
| 在 `dot` 的 `<circle>` 上綁定 `onClick`（無效） | 在 `AreaChart` 組件上使用 `onClick` 事件 |
| `activeDot` 沒有點擊處理 | `activeDot` 添加 `onClick` 回調 |
| `className="cursor-pointer"` | 改用 `style={{ cursor: 'pointer' }}` 確保 SVG 相容 |

---

## 預期效果

1. **點擊圖表任意位置**：會找到最近的數據點並展開其個股排名
2. **點擊已選中的節點**：收合個股排名
3. **點擊其他節點**：切換到新節點的個股排名

---

## 修改檔案清單

| 檔案 | 說明 |
|------|------|
| `src/components/strategy/PerformanceOverviewPanel.tsx` | 修復圖表點擊事件處理 |

