# 老師 AI 功能健檢後補救：全員重建知識索引

## 背景（已查證）

- AI Gateway 近 7 天 83 次呼叫、0 失敗，`expert-ai-chat` 鏈路本身正常（彥愷 7/12、老周 9/11 有成功對話）。
- 缺口一：9 位老師 `expert_knowledge_chunks` 為 0（ele、laofoye、lin-xiuqi、master-brian、master-lever、mk、sean、vincent、zhao-pengbo）。
- 缺口二：最新一次索引建立停在 2026-07-28，之後發佈的週記未進入 AI 知識庫（彥愷 8–9 月週記缺失）。

## 執行內容

1. 逐一對 **13 位老師全部** 呼叫既有 `expert-ai-index` Edge Function（trigger_source: 'manual'），重建知識索引。
   - 0 chunks 的 9 位：若本身無週記/簡介可索引，結果為 0 段屬正常，紀錄下來回報，不視為失敗。
   - 有內容的 4 位（sharkgu、master-brcto、master-zhou、benny）：確認段數 ≥ 現有段數（69 / 25 / 21 / 7），涵蓋最新週記。
2. 驗收：
   - `expert_ai_index_runs` 每位老師最新一筆 status=success。
   - `expert_knowledge_chunks` 段數與 latest_chunk 時間為今日。
   - AI Gateway logs 出現對應 embeddings 呼叫且無 failed。

## 不做的事

- 不改任何程式碼、DB schema、cron、通知。
- 不碰 AI 對話內容本身（不發測試對話訊息，避免污染老師對話紀錄）。
- 索引失敗的老師只回報原因，不擅自改資料修補。
