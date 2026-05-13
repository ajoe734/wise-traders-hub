## A. 用詞改掉（取代「本地 / 雲端」）

統一改成這兩個詞，UI 文案、後台說明、未來對話一律用：

- **「種子 JSON」** = `src/checkup/lib/knowledge-base/*.json`（25 條，跟著 build 走，純 fallback）
- **「知識庫資料表」** = DB `checkup_knowledge_items`（488 條，線上真正使用的那份）

要改的地方：
1. `src/pages/company/knowledge-base/SyncKnowledgeBaseDialog.tsx` — 把對話框標題/說明的「本地 / 雲端」字樣換成上面的詞
2. `src/pages/company/KnowledgeBase.tsx` — 任何 tooltip / helper text 同步換掉
3. `scripts/sync-knowledge-base.mjs` 開頭註解換掉（人讀，不影響功能）
4. 不改檔名、不改 DB schema、不改函式名

---

## B. 「重新跑知識」到底有哪幾條鏈路 — 完整說明

目前線上**同時有 5 條 cron 在動知識庫**，加上 2 個手動觸發的入口。我把每一條的「誰觸發 / 跑什麼 / 寫到哪 / 對 IO 影響」全列出來：

### B1. 自動排程（5 條，目前都 active）

| jobid | 名稱 | 排程 (UTC) | 台灣時間 | 做什麼 | 對 IO |
|---|---|---|---|---|---|
| 13 | `knowledge-validate-weekly` | 週六 19:00 | **週日 03:00** | 抓最近 90 天「真實使用者命中」(`checkup_knowledge_hits`)，對照股價算 win_rate，自動微調 confidence ±0.03~0.05 | 低（hits=0 時幾乎不寫） |
| 14 | `knowledge-promote-candidates-weekly` | 週六 20:00 | **週日 04:00** | 把候選池 (`checkup_knowledge_candidates`) 中觀察期已到的條目升級進主表 | 低 |
| 22 | `knowledge-daily-scheduler` | 每天 19:00 | **每天 03:00** | 每日跑 20 條 backtestable + 5 條 grid_search，套自動規則（archive/promote/rescue） | **中**（呼叫 `knowledge-backtest` 多次，每次展開成多檔股票×多 horizon） |
| 23 | `knowledge-weekly-sync` | 週一 20:00 | 週二 04:00 | 呼叫 `knowledge-sync`（編輯內容對齊） | 低 |
| 24 | `knowledge-full-audit-weekly` | 週日 19:00 | **週一 03:00** | 全庫掃 488 條：① backtestable 的條目觸發 backtest ② 其他用「年份標記」判過時，標 rescue / 更新 last_validated_at | **高**（這條才是 IO 元兇 — 一次掃整庫） |

> 之前停掉的 jobid 21 是 `knowledge-backtest mode=full`（每天全庫回測，~70k row/day），已 unschedule，不在表內。

### B2. 手動入口（2 個，後台按鈕）

| 入口 | 在哪 | 做什麼 |
|---|---|---|
| `knowledge-draft-scheduler` / `knowledge-draft-claude` | 後台 KnowledgeBase 頁「AI 起草」 | 用 Claude 補某 category 到 100 條，寫入 candidates，等審核 |
| 「立即執行 full audit」 | 後台 KnowledgeAudit 頁 | 手動觸發 `knowledge-full-audit`（同 jobid 24 那條） |

### B3. 一條知識被「動到」的完整生命週期

```text
   AI 起草          管理員審核            升級進主表
candidates ──手動──▶ 主表 (active) ─────────┐
                          │                  │
                          │ 每天 03:00       │ 每週日 03:00
                          │ daily-scheduler  │ full-audit
                          ▼                  ▼
                      knowledge-backtest（跑歷史回測）
                          │
                          ▼
              ┌─ win_rate 高 → promote (confidence↑)
              ├─ win_rate 中 → 維持 active
              ├─ win_rate 低 → rescue 池（前端降權 ×0.5）
              └─ rescue 過久 → archive（不再餵 prompt）

                    每週日 03:00
                  knowledge-validate
                          │
                抓真實命中(hits) → 對股價 → 寫 validations
                          │
                          ▼
              微調 confidence ±0.03~0.05（floor 0.3 / ceil 0.95）
```

### B4. 重點觀念（解你之前的疑惑）

1. **「使用量看起來很少」** = `checkup_knowledge_hits` 真實命中目前 = 0。後台沒顯示錯。
2. **「DB IO 卻很大」** = 是 `daily-scheduler` + `full-audit` 在背景跑回測，產生 `checkup_knowledge_validations` 與 `knowledge_backtest_runs`。跟使用者無關。
3. **真正消耗 IO 的關鍵是 jobid 24（full-audit-weekly）**。如果觀察 24 小時 IO 還是高，下一步就是改 `knowledge-backtest` 加 upsert + 每次限 N 筆。

---

## C. 本回合動手範圍

只做 **A（改用詞）**。B 是說明，不動程式。
如果你看完 B 想停掉哪條 cron 或加 feature flag，再講一聲，我另開一筆動。

---

## 技術細節（給之後的我看）

- 改用詞涉及檔案：
  - `src/pages/company/knowledge-base/SyncKnowledgeBaseDialog.tsx`
  - `src/pages/company/KnowledgeBase.tsx`（tooltip / 區塊標題）
  - `scripts/sync-knowledge-base.mjs`（檔頭註解）
- 不動：DB schema、函式名 (`fetchCloudItems`、`buildLocalCache` 等內部變數保留，只是英文命名)、cron 排程。
