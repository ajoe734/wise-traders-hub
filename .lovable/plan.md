# 交流投顧金鑰清單（附取得連結）

點連結登入該服務，就能找到或重新產生金鑰。

## A. 按 Generate 自己產生（不用去哪拿）
- CRON_SHARED_SECRET
- DATA_UPSERT_API_KEY
- REPORT_API_KEY

## B. 直接打字
- E2E_ALLOW_SIMULATED_PURCHASE → `false`
- E2E_TEST_EMAIL / E2E_TEST_PASSWORD → 新專案自己的測試帳號
- SITE_URL → 新專案的預覽網址
- GA4_PROPERTY_ID → https://analytics.google.com/analytics/web/ → 管理 → 資源設定
- GOOGLE_ANALYTICS_MEASUREMENT_ID → 同上 → 管理 → 資料串流 →（G- 開頭）

## C. 到服務後台複製
| 名稱 | 連結 |
|---|---|
| FINMIND_TOKEN | https://finmindtrade.com/analysis/#/account/user |
| FINNHUB_API_KEY | https://finnhub.io/dashboard |
| ANTHROPIC_API_KEY | https://console.anthropic.com/settings/keys |
| GOOGLE_GEMINI_API_KEY | https://aistudio.google.com/app/apikey |
| GEMINI_ANALYSIS_API_KEY | https://aistudio.google.com/app/apikey |
| OPENROUTER_API_KEY | https://openrouter.ai/settings/keys |
| RESEND_API_KEY | https://resend.com/api-keys |
| GA4_SERVICE_ACCOUNT_JSON | https://console.cloud.google.com/iam-admin/serviceaccounts → 服務帳戶 → 金鑰 → 新增金鑰（JSON） |
| ECPAY_MERCHANT_ID / HASH_KEY / HASH_IV | 正式：https://vendor.ecpay.com.tw → 系統開發管理 → 系統介接設定；測試用公開測試商店值：https://developers.ecpay.com.tw/?p=2856 |
| LINEPAY_CHANNEL_ID / SECRET | 正式：https://pay.line.me/portal/tw/main → 管理付款連結 → 管理連結金鑰；測試：https://pay.line.me/tw/developers/techsupport/sandbox/creation |
| LINE_LOGIN_CHANNEL_ID / SECRET | https://developers.line.biz/console/ → Provider → LINE Login channel → Basic settings |
| PLATFORM_LINE_CHANNEL_ID / SECRET | https://developers.line.biz/console/ → Messaging API channel → Basic settings |
| PLATFORM_LINE_CHANNEL_TOKEN | 同上 → Messaging API 分頁 → Channel access token（long-lived） |

## D. 不用填
- LOVABLE_API_KEY：新專案自動產生

## 會出事的地方
- 綠界／LINE Pay 填正式值 → 測試可能真扣款，請用測試值。
- PLATFORM_LINE 三個填正式值 → 測試推播會發給真實會員。
- LINE Login 共用 → 要把新專案網址加進該 channel 的 Callback URL，否則登入失敗。
- FINMIND_TOKEN 共用 → 吃正式站每日額度。

只想先跑起畫面：填 A、B，C 全按 Skip。
