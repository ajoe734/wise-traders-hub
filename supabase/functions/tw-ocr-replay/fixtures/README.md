# CAPTCHA OCR Replay Fixtures

這個資料夾是 CAPTCHA 回放測試的固定樣本集。**PNG 不會出現在遠端 repo 之外**，全部由本專案自行維護與標註。

## 目錄結構

```
fixtures/
├── labels.json          # 標註表：{ "images/xxx.png": "AB12C" } — 唯一權威來源
├── images/              # 已標註的 CAPTCHA PNG（進 replay 測試）
└── unlabeled/           # harvest.ts 抓下來、還沒人工標註的圖
```

## 新增樣本流程

1. **抓新鮮 CAPTCHA**（本機執行，需要網路）：
   ```bash
   deno run --allow-net --allow-write --allow-read \
     supabase/functions/tw-ocr-replay/harvest.ts \
     --count=20 --out=supabase/functions/tw-ocr-replay/fixtures/unlabeled
   ```

2. **人工標註**：一張一張看，把 5 碼答案（大寫英數字）寫進 `labels.json`：
   ```json
   {
     "images/2025-01-15-a.png": "AB12C",
     "images/2025-01-15-b.png": "XY9Z8"
   }
   ```

3. **移到 images/**：
   ```bash
   mv fixtures/unlabeled/captcha-2025-01-15T*.png fixtures/images/
   ```

4. **本機驗證**：
   ```bash
   deno run --allow-read --allow-env --allow-net \
     supabase/functions/tw-ocr-replay/cli.ts \
     --dir=supabase/functions/tw-ocr-replay/fixtures \
     --out=/tmp/ocr-replay-report.json \
     --markdown=/tmp/ocr-replay-report.md
   ```

## 樣本規模建議

| 用途 | 建議數量 | 說明 |
|---|---|---|
| smoke | 5–10 | CI 每次跑，快速偵測 preprocessing 退步 |
| baseline | 20–30 | 每季更新一次，作為改動前後 A/B 比較的基準 |
| 深度回歸 | 50+ | 大改 preprocessing 時人工觸發 |

`OCR_REPLAY_MIN_FIXTURES` 環境變數可調整測試最低樣本門檻（預設 5）。

## 標註品質守則

- **只收乾淨可辨識的 CAPTCHA**：如果你自己也看不清楚，跳過不要標。
- **大小寫**：TWSE 只用大寫，`labels.json` 一律填大寫。
- **模糊字元**：`0/O`、`1/I`、`5/S`、`8/B` 等易混字要特別小心，寧可不收。
- **標註後鎖定**：`labels.json` 一旦進 commit 就不要輕易改答案，否則 A/B 比較會失真。

## 為什麼不直接 checkin PNG？

- 保留人工控管：每個 PNG 都要有人親眼看過才進 labels。
- 避免自動化污染：不允許把 OCR 猜測結果反過來當標準答案（會形成同義反覆）。
