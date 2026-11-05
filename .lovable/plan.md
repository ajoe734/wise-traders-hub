# 交流投顧（複製專案）金鑰清單

我看不到、也不能列出金鑰的實際內容（系統加密，連我都讀不到）。下面是名稱和每個值去哪裡拿，照表在新專案的表單填就行。

## A. 測試階段可以自己產生（按 Generate）
- CRON_SHARED_SECRET
- DATA_UPSERT_API_KEY
- REPORT_API_KEY

## B. 直接打字填
- E2E_ALLOW_SIMULATED_PURCHASE：false
- E2E_TEST_EMAIL / E2E_TEST_PASSWORD：新專案自己的測試帳號
- SITE_URL：新專案的預覽網址（不要填 legendflow.tw）
- GA4_PROPERTY_ID / GOOGLE_ANALYTICS_MEASUREMENT_ID：建議另開 GA4 資源，不要共用，否則測試流量會混進正式站報表

## C. 到各服務後台複製（建議先跳過，用到再填）
| 名稱 | 去哪拿 |
|---|---|
| FINMIND_TOKEN | FinMind 會員頁（共用會吃掉正式站每日額度） |
| FINNHUB_API_KEY | finnhub.io Dashboard |
| ANTHROPIC_API_KEY | Anthropic Console |
| GOOGLE_GEMINI_API_KEY、GEMINI_ANALYSIS_API_KEY | Google AI Studio |
| OPENROUTER_API_KEY | openrouter.ai Keys |
| RESEND_API_KEY | Resend → API Keys |
| GA4_SERVICE_ACCOUNT_JSON | Google Cloud → 服務帳戶 → 金鑰（JSON） |
| ECPAY_MERCHANT_ID / HASH_KEY / HASH_IV | 綠界商家後台；測試請用綠界公開測試商店，不要用正式商店 |
| LINEPAY_CHANNEL_ID / SECRET | LINE Pay 商家後台（用 Sandbox） |
| LINE_LOGIN_CHANNEL_ID / SECRET | LINE Developers → Login channel |
| PLATFORM_LINE_CHANNEL_ID / SECRET / TOKEN | LINE Developers → Messaging API channel |

## D. 不用填
- LOVABLE_API_KEY：新專案自動產生

## 風險提醒（只講會出事的）
- 綠界、LINE Pay 填正式值 → 測試可能真的扣款，分潤寫進新資料庫對不上。
- 平台 LINE 填正式值 → 測試推播會發給真實會員。
- FinMind 共用 → 正式站額度被測試吃光，估值補資料停擺。

只要先把畫面跑起來，填 A、B 兩組就夠，C 全部按 Skip。
