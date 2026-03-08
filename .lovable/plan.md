

## 建立通用 Data Upsert Edge Function

### 你的 Python 只需改一行

把原本的：
```python
asyncio.create_task(supabase.table("current_prices").upsert([data]).execute())
```

改成：
```python
asyncio.create_task(upsert_via_edge(data))
```

加一個 helper function：
```python
import aiohttp

EDGE_URL = "https://yqacmrgdjlenbijclngi.supabase.co/functions/v1/data-upsert"
API_KEY = "你等等在 Lovable 設定的那組隨機字串"

async def upsert_via_edge(data):
    async with aiohttp.ClientSession() as session:
        await session.post(EDGE_URL, json={
            "table": "current_prices",
            "records": [data],
            "on_conflict": "symbol"
        }, headers={
            "Content-Type": "application/json",
            "x-api-key": API_KEY
        })
```

如果你要批次寫入（推薦，減少請求數）：
```python
# 把整批 results 一次送出
async def upsert_batch_via_edge(records):
    async with aiohttp.ClientSession() as session:
        await session.post(EDGE_URL, json={
            "table": "current_prices",
            "records": records,
            "on_conflict": "symbol"
        }, headers={
            "Content-Type": "application/json",
            "x-api-key": API_KEY
        })

# 在你的迴圈中：
valid_results = [res_map[s] for s in symbols_to_fetch if s in res_map]
if valid_results:
    asyncio.create_task(upsert_batch_via_edge(valid_results))
```

這樣 Python 端就完全不需要 `SUPABASE_SERVICE_ROLE_KEY`。

### 我這邊負責的部分

1. **請你設定 `DATA_UPSERT_API_KEY` secret** — 你自己想一組隨機字串（例如 32 字元），我會用 add_secret 工具請你輸入
2. **建立 `supabase/functions/data-upsert/index.ts`**：
   - 驗證 `x-api-key` header
   - 表白名單（`current_prices`, `trade_signals`, `trade_records` 等）
   - 用 service role client 執行 upsert
   - 支援 `on_conflict` 參數
3. **更新 `supabase/config.toml`** 加入 `verify_jwt = false`

### 請求格式

```json
POST /functions/v1/data-upsert
Headers: { "x-api-key": "你的KEY", "Content-Type": "application/json" }
Body: {
  "table": "current_prices",
  "records": [{ "symbol": "2330", "price": 580, ... }],
  "on_conflict": "symbol"
}
```

回傳：`{ "success": true, "count": 1 }` 或 `{ "error": "..." }`

