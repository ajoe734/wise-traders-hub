# Full regression receipt — 2026-08-17 (Stage B closeout round)

production 0 touch、未 deploy、未 Publish。以下每條都實際執行過。

## 0. package scripts inventory（exact，來自 package.json）
dev, build, build:dev, lint, preview, test, test:run, test:run:raw(新增), test:ui, test:coverage,
test:e2e, typecheck, test:e2e:line-checkup, test:e2e:update, check:freecheckup-rwd,
check:freecheckup-i18n, check:sitemap, check:ai-sdk-versions, check:rls-audit, check:prod-debug,
lint:modules, check:module-boundaries, check:raw-fetch, check:no-demo-artifacts, check:security:all,
refresh:twse-industry, refresh:finmind-industry, refresh:mops-revenue,
gen:journal-export-mirror, check:journal-export-mirror。
不存在的 script：無（本輪需要的 lint / build / typecheck / test:run 全部存在）。

## 1. perf 真因調查（保留 12000ms budget、assertion、測試檔，未改測試）
| 情境 | HoldingsTab dynamic import 實測 | 結果 |
|---|---|---|
| 隔離單跑 ×3 | 檔案 duration 6.01s / 5.81s / 6.73s，該測項 ~2.3s | PASS ×3（exit 0,0,0） |
| 與同 module graph 的 checkup-free-surface-barrel 兩檔並跑 | 2293ms | PASS（不足以重現） |
| 隔離單跑 + 96-way CPU 飽和背景負載 | **10046ms**（×4.4） | PASS 但逼近預算 |
| 完整 230 檔並行 `vitest run` | **13492ms**，baseline=750ms | FAIL |

結論：**test-runner 資源競爭，不是產品 import graph 退化**。證據：
(a) 產品碼本輪未動，隔離跑穩定 ~2.3s；
(b) 純加 CPU 競爭即可把同一測項從 2.3s 拉到 10.0s；
(c) 全跑時 warm-up baseline 從 ~200ms 漲到 750ms，同批另一個吃同一 graph 的檔案耗時 31.6s。
wall-clock 斷言在跨檔並行下本質不決定，因此修 runner 而非測試。

### canonical `npm run test:run` 隔離策略（scripts/run-tests.mjs）
- phase-A：並行跑全部測試，`--exclude` wall-clock 敏感檔。
- phase-B：`--pool=forks --no-file-parallelism --maxWorkers=1` 單獨序列跑該檔（9 個測項全跑，含原 12s 斷言）。
- fail-loud：phase-B 檔數/測項數必須 >0 且等於預期、phase-A 必須真的排除該檔、任一階段非 0 即 exit 1。
  已實證：第一次跑因 `--poolOptions` CLI 不支援而 phase-B 0 檔，runner 立刻 RESULT FAIL exit=1（不會靜默通過）。

| run | start | end | exit | phase-A | phase-B | TOTAL | log sha256 |
|---|---|---|---|---|---|---|---|
| canonical#1 | 17:14:58.159Z | 17:17:30.433Z | 0 | 227 passed \| 2 skipped (229 files) / 2902 passed \| 8 skipped (2910 tests) | 1 file / 9 tests | 230 files / 2919 tests | 43e37179ea7230520f3fa142add0330f4110c57db3cbae3eaf1a7c13ef573d3e |
| canonical#2 | 17:17:30.475Z | 17:20:15.776Z | 0 | 同上 | 1 file / 9 tests | 230 files / 2919 tests | 657059ea9fbf60790cc092cbf3ab65ef82bd2bbba87f5faf26eb156bfc0a3af7 |

連續兩次全綠 → 視為穩定。2919 = 2911 executed + 8 skipped，與舊 baseline 一致，沒有被吞掉任何測試。

## 2. 其餘命令 receipt
| command | start | end | exit | 結果 | sanitized log sha256 |
|---|---|---|---|---|---|
| `npm run lint` | 17:20:46.473Z | 17:21:12.362Z | **1** | 2738 problems（2619 error / 119 warn）**全部既有**；本輪新增檔 `scripts/run-tests.mjs` 單獨 eslint = 0 問題 | 07ca07f1e31eff8d65ba8e5f86e06804bb129aeeffe46ba245df39c47ac6e2c2 |
| `npm run typecheck`（tsc --noEmit） | 17:21:12.383Z | 17:21:13.086Z | 0 | 0 error | ab0e2035b5007e7584d2487e5df8e468fad8fca2ed7f9a8d0e51ccba4fe904cc |
| `npm run build`（production） | 17:21:13.105Z | 17:21:44.537Z | 0 | built in 29.49s（僅 chunk-size 警告） | 26ed420c9633a5cf3ca0490f384135409a50fb97742fe1503adb9693b6852bf9 |
| `deno check`（5 支：bsrAdmissionGate.ts, bsrAdmissionProbe.ts, tw-bsr-finmind-sync/index.ts, admin-bsr-admission/index.ts, sb_edge_driver.ts） | 17:22:42.835Z | 17:22:43.958Z | 0 | 5/5 Check OK | 41d8605fa029f9a6092374d645935dd6a4c460157255fab478718b63541eddf5 |
| `deno test -A`（_shared/bsrAdmissionGate_test.ts + tw-bsr-finmind-sync/ + admin-bsr-admission/） | 17:22:43.978Z | 17:22:46.750Z | 0 | **76 passed / 0 failed**（先前回報的「42」只是其中一個子集，此為完整數） | e6d450520304ba38e838701052f1ff4fa93a0c0f6cf1e16cde49792316c95b76 |

lint 的 exit=1 是既有基準，非本輪引入；本輪未修（超出範圍且會動到 2619 處既有碼）。

## 3. 暫存檔清理（第 2 項）
- `db/r1/c/SB/sedPX2p4M`：磁碟不存在、`git ls-files` 不存在、`git log --all --diff-filter=A -- 'db/r1/c/SB/sed*'` 0 筆、`rg "sedPX2p4M"` 全庫（含檔案內容）0 命中 → 為上一輪已刪除檔的搜尋索引殘影。
- 本輪另外刪除實際被追蹤的暫存產物：`db/r1/c/SB/__pycache__/`（2 個 .pyc）。
- 掃描 `sed* / *.swp / *.bak / *~ / *.orig / *.tmp`：全庫 0 命中。

## 4. Security scan（所有 code/artifact 變更完成後執行，2026-08-17T17:24:24Z）
- Critical/error：**1 筆，`SUPA_security_definer_view`（= `public.payment_providers_safe`）**，management=active，既有問題，本輪**未修、未 Ignore、未 Try-fix-all**。證據見 `security-gap.md`。
- warn：5 筆，全部 `ignored_by_user`（先前已判定），未變動。
- dependency vulnerabilities：僅盤點，本輪不升級、不修改 lockfile。
  - 本輪稍早記錄 **29 筆**；使用者於 2026-08-17T17:32Z 親自重跑 Basic scan（畫面「completed 15 seconds ago」）顯示 **77 packages / 40 known vulnerabilities**。
  - 唯讀查證（2026-08-17T17:33:19Z）：`package-lock.json` / `bun.lock` / `bun.lockb` mtime 皆為 Aug 17 00:34（本輪之前），`git status` 對這些檔案 0 變更；本輪 5 次 `package.json` 提交全部只動 `scripts`（`test:run` → `node scripts/run-tests.mjs`、新增 `test:run:raw` 等），`dependencies`/`devDependencies` 0 位元變更（最後一次相依變更：jszip 2026-07-18、zod 於 initial commit）。
    - `package.json` sha256 `1f4cfbbdb3e7d7b094d0fc3de40f9992d305791d5bfeb2781e2966f430926ef4`
    - `package-lock.json` sha256 `fbf9a41cba72e518fc02731393811bfb7c7f6b4d2edfb9ffffc280e4f1da9aca`
  - 結論：29 → 40 為 **scanner advisory database / count drift**，非本輪引入的相依變更。`security--dependency_scan`（npm audit high+critical 面向）同時回報 0 high/critical，兩者計數口徑不同。
  - 未升級套件邊界：本輪**未執行**任何 install/update/audit fix、未改 lockfile、未改 `dependencies`/`devDependencies`；40 筆全數維持原狀待另案處理。


## 5. EF-09 產品 bug（詳見 edge-failure-ledger.md）
root cause / 最小 diff / B18/B19 249-0 / DB16-DB17 仍有效理由，皆已記錄。
