# 階段 1：即時化價格更新 + 涵蓋權證/櫃買

把現況「30 分鐘 cron + 全頁手動 sync」改成「**交易時段內 5 分鐘 cron + Realtime 自動推送 + 涵蓋上市/上櫃/權證**」。

---

## 一、後端：cron 改 5 分鐘 + 交易時段限制

### 動作
1. 移除舊的 30 分鐘 cron job（如果有 `pg_cron` 排程指向 `stock-price-sync`）
2. 新增 cron schedule：
   - **頻率**：`*/5 * * * 1-5`（週一到週五，每 5 分鐘）
   - 但 cron 表達式無法直接表達「08:00–14:30 UTC+8」+「14:00 後盤後盤」。改在 edge function 內做時段守門：

3. 在 `stock-price-sync` 開頭加一段 **trading-hours guard**（可被 `?force=1` 繞過，給「立即更新」按鈕用）：
   ```ts
   const tw = new Date(Date.now() + 8*3600*1000);
   const dow = tw.getUTCDay();        // 0=Sun, 6=Sat
   const hh = tw.getUTCHours();
   const mm = tw.getUTCMinutes();
   const minutes = hh*60 + mm;
   const isWeekday = dow >= 1 && dow <= 5;
   // 盤中 09:00–13:30；盤後零股 14:00–14:30；台股早盤試撮 08:30 起也納入
   const inWindow = (minutes >= 8*60+30 && minutes <= 14*60+30);
   const force = new URL(req.url).searchParams.get('force') === '1';
   if (!force && !(isWeekday && inWindow)) {
     return jsonResp({ skipped: true, reason: 'outside_trading_hours' });
   }
   ```
   非交易時段 cron 觸發直接 return，不打 TWSE。

### Cron 重排（用 supabase insert 工具）
```sql
-- 1) 移除舊 30 分鐘 job（先 SELECT 查 jobid 再 unschedule）
SELECT cron.unschedule(jobid) FROM cron.job WHERE command ILIKE '%stock-price-sync%';

-- 2) 新增 5 分鐘 job（只跑週一到週五）
SELECT cron.schedule(
  'stock-price-sync-5min',
  '*/5 * * * 1-5',
  $$ select net.http_post(
       url:='https://yqacmrgdjlenbijclngi.supabase.co/functions/v1/stock-price-sync',
       headers:='{"Content-Type":"application/json","apikey":"<ANON_KEY>"}'::jsonb,
       body:='{}'::jsonb
     ); $$
);
```

---

## 二、後端：權證/櫃買補位

### 改 `stock-price-sync` 的 `fetchStockBatch`

1. **改善代號偵測**（取代 `length>=6` 那行）：
   ```ts
   // 權證：6 碼且首碼 0/3/7（認購/認售/牛熊證/中央政府公債等通用前綴）
   const isWarrantLike = (sym: string) => /^[03567]\d{5}$/.test(sym);
   const exChParts = symbols.flatMap(sym => {
     const base = [`tse_${sym}.tw`, `otc_${sym}.tw`];
     if (isWarrantLike(sym) || sym.length >= 6) {
       base.push(`oa_${sym}.tw`); // 權證 / 盤後零股
     }
     return base;
   });
   ```

2. **TPEx fallback**：MIS 抓不到的 symbol，改打 `tpex-proxy` 補：
   ```ts
   // 在 fetchStockBatch return 前
   const missing = symbols.filter(s => !results.has(s));
   if (missing.length > 0) {
     try {
       const r = await fetch(
         `${SUPABASE_URL}/functions/v1/tpex-proxy?endpoint=SQUOTE_EW_QUOTAS_ALL&codes=${missing.join(',')}`,
         { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } }
       );
       const arr = await r.json();
       for (const item of (Array.isArray(arr) ? arr : [])) {
         const code = item.SecuritiesCompanyCode || item.Code;
         const price = parseFloat(item.Close ?? item.ClosingPrice);
         if (code && Number.isFinite(price)) {
           results.set(code, { price, name: item.CompanyName || item.Name || '', raw: { c: code, z: String(price) } as any });
         }
       }
     } catch (e) { console.error('TPEx fallback error:', e); }
   }
   ```
   注意：TPEx OpenAPI 是 **每日收盤**，盤中無資料；用作「MIS 抓不到時的保險絲」，不是即時源。

### 權證 PnL 註記
此階段不改權證 PnL 計算邏輯（仍當一般股票算現價差），先保證「至少抓得到價」。Delta/時間價值列為下階段議題。

---

## 三、前端：FreeCheckup Realtime 訂閱

### 動作
1. 在 `FreeCheckup.jsx` 持倉看板區塊新增 `useEffect`，訂閱 `current_prices` 變化：
   ```ts
   useEffect(() => {
     if (isDemo) return; // demo 模式不訂閱
     const symbols = holdings.map(h => h.code);
     if (symbols.length === 0) return;
     const ch = supabase
       .channel('current-prices-fc')
       .on('postgres_changes', {
         event: 'UPDATE',
         schema: 'public',
         table: 'current_prices',
         filter: `symbol=in.(${symbols.join(',')})`,
       }, (payload) => {
         applyPriceUpdate(payload.new); // 局部更新該 symbol 的 price/PnL
       })
       .subscribe();
     return () => { supabase.removeChannel(ch); };
   }, [holdings.map(h=>h.code).join(',')]);
   ```
2. UI 顯示「**資料時間：HH:mm:ss**」（讀 `current_prices.pushed_at`），讓用戶知道這是即時更新。
3. 「立即更新」按鈕邏輯改為：
   - 正式模式 → 呼叫 `stock-price-sync?force=1`（保留為保險，cron 失靈時可手動）
   - Demo 模式 → 維持目前 demoData 模擬（已正確）
4. 加冷卻：30 秒內再按一次直接擋下（前端 + edge function 端各做一層）。

### 必要的 DB 設定（migration）
```sql
-- 1) 確保 current_prices 在 realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.current_prices;
-- 2) 確保完整 row 會被 broadcast
ALTER TABLE public.current_prices REPLICA IDENTITY FULL;
-- 3) RLS：anon/authenticated 可 SELECT current_prices（檢查現況，若無則新增）
-- 由 plan 執行時用 supabase--read_query 先確認，缺則補 policy
```

---

## 四、分析師訂閱頁也吃同一條 pipeline

`stock-price-sync` 已同時更新 `user_performances`（分析師訂單）+ `current_prices`（FreeCheckup）。
分析師頁面如有需要 Realtime，可後續在訂閱頁掛 `user_performances` channel；本階段先讓 FreeCheckup 跑通，分析師頁照舊 5 分鐘自動更新即可。

---

## 五、驗收

- [ ] 5 分鐘 cron 跑起來，`system_jobs_log` 看到每 5 分鐘一筆
- [ ] 14:30 後 cron 觸發，記錄 `skipped: outside_trading_hours`，TWSE 沒打
- [ ] 開兩個瀏覽器到 `/free-checkup`，cron 跑完數字自動跳，不用重整
- [ ] 持倉混入一支上櫃股（如 `6488`）跟一支權證（如 `030001`），都能抓到價
- [ ] 「立即更新」按鈕 30 秒冷卻生效；Demo 模式仍走假資料

---

## 技術備註（給工程方）

- **5 分鐘 vs 1 分鐘**：本階段先 5，觀察一週 TWSE 回應與 `system_jobs_log` 失敗率，若穩定再縮短。
- **Realtime 連線數**：1000 同時上線 = 1000 條 WebSocket，Supabase Cloud 預設方案足以承受；超過再評估。
- **TPEx fallback 限制**：是當日收盤資料，盤中 MIS 不回時只能拿到「昨天的價」。MIS 通常都會回上櫃，這層是保險。
- **權證 PnL**：Delta/時間價值修正列為後續 ticket，不在本次 scope。
