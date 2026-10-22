# 01 — 陳惠美誤買健檢退費（綠界信用卡）

Status: ready-for-human (已執行完成)

## 驗收標準
- [x] 699 元信用卡交易成功退刷：綠界 DoAction Action=R 回 RtnCode=1（Action=N 被 error_closed 拒，訂單已關帳）
- [x] payment_transactions 新增負值退款紀錄（-699, refunded, provider_tx_id=REFUND-CK1792589247358）
- [x] payment_intents d76ed34a status=refunded
- [x] checkup_subscription de3c77b7 status=canceled、canceled_at 已設
- [x] audit_logs 兩筆（ecpay_refund.failed 10000002、ecpay_refund 成功）
- [x] 重複呼叫回 alreadyRefunded，不二次送綠界
- [x] 15 項核心測試 + 完整 4,363 項測試全綠
- [ ] 會員重新線上購買彥愷老師「修煉派」週記 799（月繳）— 待會員執行

## 頁面／路由清單
- 無前台頁面變更；管理員工具為 Edge Function `ecpay-refund`（POST，company_admin）

## 資料來源
- 綠界信用卡 DoAction（production）：退刷 N／退款 R、訂單查詢 QueryTradeInfo V5
- payment_intents / payment_transactions / checkup_subscriptions / audit_logs

## 備註
- 退刷差額 NT$100（799-699）由會員重新結帳時支付。
- DoAction 網路中斷時回 UPSTREAM_UNKNOWN，不自動重試，需人工到綠界後台確認。
