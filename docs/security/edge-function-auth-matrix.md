# Edge Function Auth Matrix

> 由 `scripts/audit-edge-fn-auth.mjs --write` 自動產生，勿手動編輯。
> 分類憲法見 `supabase/functions/_shared/authGuard.ts`。

覆蓋率：126 / 126
Runtime guard 已上：55 / 126

| Function | Auth Class | Runtime Guard |
| --- | --- | --- |
| `account-link-consume` | user | ✅ |
| `account-link-generate` | user | ✅ |
| `acpay-notify` | webhook | — |
| `acpay-recurring-manage` | user | ✅ |
| `acpay-recurring-notify` | webhook | — |
| `acpay-refund` | user | ✅ |
| `admin-account-force-merge` | user | ✅ |
| `admin-ecpay-status` | user | ✅ |
| `admin-line-push` | user | ✅ |
| `admin-line-push-cron` | cron | ⏳ pending |
| `admin-manage-users` | user | ✅ |
| `admin-view-as` | user | ✅ |
| `alerts-watchdog` | cron | ⏳ pending |
| `apologize-line-free-quota` | cron | ⏳ pending |
| `authorize-pdf-export` | user | ✅ |
| `auto-cancel-failed-renewals` | cron | ⏳ pending |
| `backfill-daily-snapshots` | cron | ⏳ pending |
| `backfill-gap-orchestrator` | cron | ⏳ pending |
| `backfill-snapshots-twse-bulk` | cron | ⏳ pending |
| `backfill-worker` | cron | ⏳ pending |
| `checkup-analyst-reports` | cron | ⏳ pending |
| `checkup-analyze` | user | ⏳ pending |
| `checkup-analyze-enqueue` | user | ⏳ pending |
| `checkup-analyze-worker` | cron | ⏳ pending |
| `checkup-brain` | user | ⏳ pending |
| `checkup-calendar` | user | ⏳ pending |
| `checkup-calendar-cron` | cron | ⏳ pending |
| `checkup-daily-reminder-cron` | cron | ⏳ pending |
| `checkup-ecpay-callback` | webhook | — |
| `checkup-institutional` | cron | ⏳ pending |
| `checkup-knowledge` | user | ⏳ pending |
| `checkup-mops-announcements` | cron | ⏳ pending |
| `checkup-mops-revenue` | cron | ⏳ pending |
| `checkup-notify-complete` | cron | ⏳ pending |
| `checkup-parse` | cron | ⏳ pending |
| `checkup-predict-events` | cron | ⏳ pending |
| `checkup-quota-audit` | cron | ⏳ pending |
| `checkup-report` | user | ✅ |
| `checkup-research` | user | ✅ |
| `checkup-research-extract` | user | ✅ |
| `checkup-sparkline` | public | — |
| `checkup-telemetry` | user | ⏳ pending |
| `checkup-twse` | public | — |
| `checkup-warrant-sync` | cron | ⏳ pending |
| `chips-guardian` | cron | ⏳ pending |
| `cleanup-announcements-cron` | cron | ⏳ pending |
| `cleanup-ops-logs` | cron | ✅ |
| `confirm-linepay` | webhook | — |
| `confirm-remittance` | user | ✅ |
| `create-acpay-order` | user | ⏳ pending |
| `create-analyst` | user | ✅ |
| `create-checkup-ecpay-order` | user | ✅ |
| `create-checkup-remittance` | user | ✅ |
| `create-ecpay-order` | user | ✅ |
| `create-expert-remittance` | user | ✅ |
| `create-linepay-order` | user | ⏳ pending |
| `crypto-price-sync` | cron | ⏳ pending |
| `daily-performance` | cron | ⏳ pending |
| `daily-snapshot` | cron | ⏳ pending |
| `data-upsert` | user | ⏳ pending |
| `e2e-simulate-purchase` | user | ✅ |
| `ecpay-callback` | webhook | — |
| `email-push-renewal-reminder` | cron | ⏳ pending |
| `expert-ai-chat` | user | ✅ |
| `expert-ai-conversation` | user | ✅ |
| `expert-ai-index` | user | ✅ |
| `expert-ai-studio` | user | ✅ |
| `expert-ai-training` | user | ✅ |
| `expire-stale-remittance` | cron | ⏳ pending |
| `expire-subscriptions` | cron | ⏳ pending |
| `fx-rate-sync` | cron | ⏳ pending |
| `knowledge-backtest` | cron | ⏳ pending |
| `knowledge-daily-scheduler` | cron | ⏳ pending |
| `knowledge-draft-claude` | user | ✅ |
| `knowledge-draft-scheduler` | cron | ⏳ pending |
| `knowledge-full-audit` | cron | ⏳ pending |
| `knowledge-promote-candidates` | cron | ⏳ pending |
| `knowledge-validate` | cron | ⏳ pending |
| `line-login-authorize` | public | — |
| `line-login-callback` | public | — |
| `line-login-exchange-nonce` | public | — |
| `line-push-renewal-reminder` | cron | ⏳ pending |
| `line-push-signal` | user | ✅ |
| `line-webhook` | webhook | — |
| `mcp` | public | — |
| `notify-backtest-result` | cron | ⏳ pending |
| `notify-payment-failure` | cron | ⏳ pending |
| `og-card` | public | — |
| `ops-health` | cron | ✅ |
| `process-refund` | user | ✅ |
| `prune-knowledge-base` | cron | ⏳ pending |
| `publish-weekly-journals` | cron | ✅ |
| `publish-weekly-journals-runner` | cron | ⏳ pending |
| `publish-weekly-journals-watchdog` | cron | ⏳ pending |
| `reconcile-warrant-quantities` | cron | ⏳ pending |
| `recover-abandoned-checkout` | cron | ⏳ pending |
| `recover-failed-transactions` | cron | ⏳ pending |
| `refresh-data-source` | user | ✅ |
| `refresh-targets-weekly` | cron | ⏳ pending |
| `setup-storage` | cron | ⏳ pending |
| `share-og` | public | — |
| `signal-ai-assist` | cron | ⏳ pending |
| `stock-name-lookup` | public | — |
| `stock-price-sync` | public | — |
| `stream-metrics-report` | cron | ⏳ pending |
| `submit-remittance-info` | user | ✅ |
| `subscribe-renew-link` | user | ⏳ pending |
| `tpex-proxy` | public | — |
| `traffic-cleanup` | cron | ⏳ pending |
| `traffic-ingest` | public | — |
| `tw-bsr-daily-sync` | cron | ⏳ pending |
| `tw-bsr-effect-analysis` | cron | ⏳ pending |
| `tw-bsr-failure-dashboard` | cron | ⏳ pending |
| `tw-bsr-finmind-sync` | cron | ⏳ pending |
| `tw-bsr-ocr-metrics` | cron | ⏳ pending |
| `tw-bsr-stock-timeline` | cron | ⏳ pending |
| `tw-bsr-window-converge` | cron | ⏳ pending |
| `tw-chips-detail` | user | ⏳ pending |
| `tw-chips-orchestrator` | cron | ⏳ pending |
| `tw-institutional-daily-sync` | cron | ✅ |
| `tw-ocr-replay` | cron | ⏳ pending |
| `twse-proxy` | public | — |
| `update-analyst-credentials` | user | ✅ |
| `us-stock-quote` | public | — |
| `validate-signal-prices` | cron | ⏳ pending |
| `weekly-journal-export` | user | ⏳ pending |
