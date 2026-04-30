## 知識庫擴充計劃 — 220 條 / Claude 草稿 / 全自學 / 8 欄位升級

確認的方向：規模 220 條（c）、Claude API 起草（b 改 Claude）、自我學習全做（a）、結構升級 8 欄位全做（a）。

---

### 一、Schema 升級（migration）

在 `checkup_knowledge_items` 加 8 個新欄位，讓條目可被機器驗證：

| 欄位 | 型別 | 用途 |
|---|---|---|
| `trigger_condition` | jsonb | 觸發條件，例：`{"type":"foreign_buy_streak","days":">=5","amount_pct":">=2"}` |
| `expected_outcome` | jsonb | 預期結果，例：`{"direction":"up","horizon_days":10,"min_pct":3}` |
| `win_rate` | numeric | 統計勝率（0–1），由盲測回填 |
| `sample_size` | integer | 統計樣本數，由盲測回填 |
| `last_validated_at` | timestamptz | 最近一次盲測時間 |
| `source_type` | text | `editorial` / `ai_draft` / `community` / `auto_promoted` |
| `industry_tags` | text[] | 產業標籤（半導體 / 金融 / 航運 / 生技…） |
| `time_horizon` | text | `intraday` / `swing_3_10d` / `position_1_3m` / `long_6m+` |

新增「候選池」表 `checkup_knowledge_candidates`：AI 起草 / 自動晉升的條目先進這裡，管理員審核後才進主表。

新增「驗證紀錄」表 `checkup_knowledge_validations`：每次盲測在某條知識上的命中與報酬，做為 win_rate 的依據。

---

### 二、220 條目錄結構（每類 44 條）

```text
chip_analysis (44)         — 外資/投信/自營/大戶/散戶 + 期現貨對作 + 季底作帳
technical_analysis (44)    — KD/MACD/RSI + 量價 + 形態 + 均線 + 跳空 + 布林通道
industry_trends (44)       — 半導體/金融/航運/生技/AI/電動車/觀光/被動元件...
strategy_cases (44)        — 含「失敗案例」（誘多/假突破/出貨量），不只 success
news_correlation (44)      — 法說/月營收/解盲/併購/調研/外資調評/總經事件
```

每類補 39 條（5 → 44）。每條都要填上面 8 個結構化欄位。

---

### 三、Claude 草稿引擎

**新 edge function**：`supabase/functions/knowledge-draft-claude/index.ts`
- 輸入：`{ category, count, focus_tags?, time_horizon? }`
- 流程：
  1. 用 `ANTHROPIC_API_KEY` 呼叫 `claude-sonnet-4-5`（最強模型）
  2. 給結構化 prompt（含台股市場特性、知識條目骨架、JSON Schema）
  3. 要求回傳純 JSON 陣列，每條都要有 `trigger_condition` / `expected_outcome` / `tags` / `time_horizon` 等
  4. 寫進 `checkup_knowledge_candidates`（status=`pending`），不直接污染主表

**對應前端**：在 `KnowledgeBase.tsx` 加「AI 起草」按鈕 → 選類別 + 數量 → 跳出候選預覽（每條可勾選採用/丟棄/編輯）→ 採用後 upsert 到主表。

---

### 四、自我學習（全做）

#### A. 盲測回填（Validation Loop）

**新 edge function**：`knowledge-validate`（pg_cron 每週日 03:00 UTC+8 執行）
- 取最近 N 天每次 `checkup_knowledge_hits` 命中
- 對應該股票的實際後續走勢（用 `current_prices` 歷史 + `expected_outcome.horizon_days`）
- 判定該次命中是「應驗 / 未應驗」，寫進 `checkup_knowledge_validations`
- 重算每條的 `win_rate` = 應驗數 / 樣本數，寫回主表 `win_rate` / `sample_size` / `last_validated_at`

#### B. 自動降權

同一個 cron job 後段：
- 若 `sample_size >= 20` 且 `win_rate < 0.4` → `confidence` 自動 `-0.05`（floor 0.3）
- 若 `win_rate >= 0.7` → `confidence` 自動 `+0.03`（ceiling 0.95）
- 任何自動調整都寫 audit log（`knowledge.auto_adjust`）

#### C. 候選晉升（從盲測案例學新規則）

新 edge function：`knowledge-promote-candidates`（每週日 04:00 跑）
- 掃描 `checkup_knowledge_validations` 找「同樣的 trigger pattern 在多檔股票連續應驗」的群組
- 把這個 pattern 丟給 Claude，要求總結成新知識條目骨架
- 寫進 `checkup_knowledge_candidates`，等管理員審核

---

### 五、Sync 腳本升級

`scripts/sync-knowledge-base.mjs` 加 `--full-restore` 模式：
- 從 `scripts/seeds/knowledge-220.json`（一次性產生並 commit）批次 upsert 到雲端
- 保留現有 dry-run / --apply
- 加 `--from-claude category=technical_analysis count=39` 模式，現場呼叫 Claude 草稿並寫入候選池

---

### 六、執行順序

1. Migration：加 8 欄位 + 候選池表 + 驗證紀錄表
2. 寫 `knowledge-draft-claude` edge function（Claude 起草）
3. 用 Claude 一次產出 195 條候選 → 我親自審一輪結構是否符合 schema → 寫進 `scripts/seeds/knowledge-220.json`
4. 跑 sync 腳本把 220 條灌入主表
5. 寫 `knowledge-validate` edge function + pg_cron（每週日 03:00 跑回填）
6. 寫 `knowledge-promote-candidates` + pg_cron（每週日 04:00 跑晉升）
7. 升級 `KnowledgeBase.tsx`：加 AI 起草、候選池審核、win_rate / sample_size / 觸發條件 / 預期結果欄位
8. 更新 `knowledgeBase.js`：`getRelevantKnowledge` 改用 `confidence × win_rate`（有樣本時）排序
9. 更新 memory `mem://features/checkup/knowledge-base-cloud-first`

---

### 七、給你的預期

- 主表從 25 → **220 條**，每條都有 trigger / expected_outcome 可被機器驗證
- 每週日凌晨自動跑回填，**confidence 會根據實戰表現自動調整**，越用越準
- AI 起草 + 候選池：未來想擴到 500 條，按按鈕就能補
- 你在後台會看到每條的「實戰勝率」「樣本數」「最近驗證時間」，廢條目會被標紅

核准後我直接動工。