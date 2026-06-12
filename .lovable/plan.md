# 影片版位安全區優化

## 目標
讓 16:9 / 9:16 兩支 MP4 在 FB feed、IG Reels、IG Stories 上，文字不被頂部帳號列/進度條切掉，主視覺（5 檔健檢卡）不被底部 caption / 互動列遮住。

## 安全區規格

新增 `remotion/src/safeArea.ts`：

```ts
export const SAFE = {
  portrait:  { top: 240, bottom: 380, x: 60 },   // IG Reels/Stories
  landscape: { top: 120, bottom: 120, x: 140 },  // FB feed
};
export const padOf = (isPortrait: boolean) => {
  const s = isPortrait ? SAFE.portrait : SAFE.landscape;
  return `${s.top}px ${s.x}px ${s.bottom}px`;
};
```

所有場景的 `<AbsoluteFill padding>` 改成 `padding: padOf(isPortrait)`。

## 各場景修改

| 檔案 | 修改 |
|---|---|
| `remotion/src/scenes/Hook.tsx` | 套 `padOf`；移除底部 `position:absolute` wordmark，改放主區內並縮小 margin；titleSize portrait 84→72 防止超出 |
| `remotion/src/scenes/SceneOcr.tsx` | 套 `padOf`；portrait Phone scale 0.75→0.62、Table scale 0.75→0.62，避免擠壓 |
| `remotion/src/scenes/SceneCheckup.tsx` | 套 `padOf`；**健檢結果卡從 `position:absolute; bottom:40/60` 改為正常流**，用 flex column + gap 撐開；標題 marginBottom 縮小；按鈕/進度條間距壓縮，讓 5 檔卡完整落在中央 60% |
| `remotion/src/scenes/SceneCalendar.tsx` | 套 `padOf`；cellSize portrait 92→78、landscape 112→100，整體垂直置中 |
| `remotion/src/scenes/Outro.tsx` | 套 `padOf`；wordmark + tagline + CTA 整組往中央集中，CTA margin 收緊 |

## 不動
- 影片時長（22s）、scene 分配、配色、字體、動畫節奏
- `src/checkup/components/HoldingsIntroVideo.jsx`
- App 內任何業務邏輯

## 重新渲染與覆蓋

```bash
cd remotion && node scripts/render-remotion.mjs   # 兩支 composition 都會輸出
# 之後用 lovable-assets create 覆蓋
lovable-assets create --file /mnt/documents/holdings-promo-16x9.mp4 \
  > src/assets/holdings-promo-16x9.mp4.asset.json
lovable-assets create --file /mnt/documents/holdings-promo-9x16.mp4 \
  > src/assets/holdings-promo-9x16.mp4.asset.json
```

## 驗證（強制窮舉）

1. `bunx remotion still` 抽 4 個關鍵 frame：
   - frame 30（Hook 標題）
   - frame 150（OCR 表格）
   - frame 320（健檢卡 5 檔完整出現）← **最關鍵**
   - frame 600（Outro CTA）
2. 兩個 orientation 各抽一次，共 8 張 still
3. 用 ImageMagick 在 9:16 still 上疊 top 240px / bottom 380px 半透明紅遮罩，肉眼確認無重要內容落在紅區
4. 確認 MP4 size 合理（每支 < 5MB）、`ffprobe` duration = 22s
