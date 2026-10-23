# 01 — D版精簡與逐檔分類覆核
Status: ready-for-agent
Priority: P1
Category: enhancement
Blocked by: None

## What to build
主尺改圖示，價格圖例分欄避免手機重疊；後台列全752檔可逐檔確認修正及下載。

## 驗收標準
- [ ] 全部752筆含代號、名稱、主要經營業務、依據、現分類，無500筆上限。
- [ ] 確認／修正沿用公司管理員RPC，不批次批准待審資料；失敗不移除列。
- [ ] 成功通知當頁及其他分頁刷新，同業以採用後固定代碼組裝，未採用不進母體。
- [ ] 320/380/390/393/414/560/768/1280圖表無疊字／溢出，五列與缺值保留。
- [ ] 相關單元、模組邊界、手機靜態與12卡片回歸通過。

## 頁面／路由清單
|路由|修改|准入條件|說明|
|---|---|---|---|
|/company/stock-industry|修改|company_admin|全量逐檔審核／CSV|
|/holding-checkup|修改|既有會員條件|D版標記與即時同業|
|/portfolio/holdings|修改|既有會員條件|共用抽屜|
|/holding-checkup-demo|共用呈現|公開|不得代替真實資料驗收|
無新增路由／sitemap。

## 資料來源
讀取stock_industry_map既有欄位，寫入admin_update_stock_industry（既有公司管理員驗證）；useStockIndustryMap過採用閘門。同業倍數沿用valuation_peer_multiples，前瞻沿用forward_estimate_for／forward-eps-extract，基本面沿用valuation-fundamentals。不增加第三方行情請求；不變動持倉帳本／價格計算／RLS。