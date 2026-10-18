# brcto 老師自媒體專屬週記訂閱網址

## 結論
現有網站已能記錄網址上的來源標記（訪問與首次來源都會存），**不需改程式**，只要給專屬網址。

專屬網址（短網址，會自動帶標記跳到老師頁）：

```text
https://legendflow.tw/s/master-brcto?utm_source=brcto&utm_medium=social&utm_campaign=brcto_journal
```

若要分平台追蹤，換 `utm_content`：
- IG：`...&utm_content=ig`
- FB：`...&utm_content=fb`
- YouTube：`...&utm_content=yt`
- LINE 社群：`...&utm_content=line`

## 執行步驟
1. 用無痕視窗實際開一次上述網址，確認跳到 `/expert/master-brcto` 且標記沒掉。
2. 讀回後台流量紀錄，確認這次訪問帶 `utm_campaign=brcto_journal`。
3. 確認之後註冊、結帳的人能歸到這個來源（首次來源鎖 30 天）。
4. 回報驗證結果與網址；查詢方式：流量看板依 campaign `brcto_journal` 篩選。

## 技術細節
- expert：`master-brcto`（id 3fda8093-…）。
- 前端 `trafficTracker` 送 utm_* 到 `traffic-ingest`；`useAttributionTracking` 首觸鎖 30 天寫 `referral_attributions`；`/s/:slug` 以 `preserveUtm` 保留參數。
- 只讀驗證，不改 DB/RLS、不發布。
