## 問題根因

`src/pages/FreeCheckup.jsx` 第 2204–2278 行的 Portfolio Overview Hero 區：

1. **左右兩欄 grid** 用 `'minmax(0, 1.4fr) minmax(0, 1fr)'`，但左欄的「+11,624」是 `fontSize: 88` 的固定 px 數字，無法被 `minmax(0,...)` 壓縮 → 在 390px 寬度直接溢出到右欄。
2. **inline style 優先級最高**，檔案中唯一的 `@media(max-width:480px)` 只調 body 字級，對 inline 的 `fontSize: 88` 無效。
3. 右側 MARKET / Updated 區塊用 `alignItems: flex-end`，被壓也不會閃避，造成兩塊文字疊字。

## 修改方案

### 1. 改 `src/pages/FreeCheckup.jsx` 第 2092–2104 行的 `<style>` 區塊

新增針對 `.wb-hero-grid` 與 `.wb-hero-kpi` 的 RWD 規則（透過 class 名稱覆寫，繞過 inline style 限制）：

```css
@media(max-width:560px){
  .wb-hero-grid{
    grid-template-columns: 1fr !important;
    align-items: flex-start !important;
    gap: 14px !important;
  }
  .wb-hero-grid > div:last-child{
    align-items: flex-start !important;
  }
  .wb-hero-pnl-num{
    font-size: 56px !important;
    letter-spacing: -0.03em !important;
  }
  .wb-hero-pnl-pct{
    font-size: 18px !important;
  }
  .wb-hero-kpi{
    grid-template-columns: repeat(2, minmax(0,1fr)) !important;
    gap: 14px 18px !important;
  }
}
@media(max-width:380px){
  .wb-hero-pnl-num{ font-size: 44px !important; }
}
```

### 2. 在第 2231 行的 `+11,624` `<span>` 加 `className="wb-hero-pnl-num"`、第 2238 行的 `+14.51%` `<span>` 加 `className="wb-hero-pnl-pct"`，讓上述 media query 能命中。

### 3. 第 2247–2277 行右側 Market 區塊：把 `alignItems: 'flex-end'` 改為用 `className` 控制，桌面維持 flex-end、手機切到 flex-start，避免在單欄模式下右靠難讀。

## 預期結果

- ≥560px：維持現有左大右小的雙欄 Hero（不影響桌面與平板）
- ≤560px：Hero 改為上下堆疊，「+11,624」縮到 56px，KPI 改為 2×2 排列
- ≤380px：「+11,624」再縮到 44px，避免在 iPhone SE 等更小螢幕再次溢出
- 不更動任何業務邏輯、不抽元件（遵守 `mem://architecture/checkup/inline-rendering-audit` 規範）

## 為什麼這次不會再漏

> 在 memory 新增一條：FreeCheckup.jsx Hero 區所有用到 fontSize ≥ 32 的 inline style，必須同時提供 `.wb-hero-*` className 與 `<style>` 區塊內對應的 ≤560px / ≤380px RWD 規則，否則視為跑版未修。

下次任何人改這支檔案時，這條規則會自動進入 Core 規則被檢查。
