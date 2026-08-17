
## B14 / B15 — Stage B Edge E2E（真 GoTrue + Deno + PostgREST + supabase-js）
| run_id | checks | failures | rehearsal.log sha256 |
|---|---|---|---|
| B14-20260817T161921Z-5081 | 113 | 0 | 8f2bb468e01dad4462edca8a5dbf55696e186e5ce15bbb917790659674bda6d9 |
| B15-20260817T161946Z-6163 | 113 | 0 | b309f4adfa5863e8337dce4c649444a2093e19588aa484314e37d344a9e41e45 |

focused T8：113/113 PASS（log sha256_pre_result 2f4626246dbf26028e392d8581f9ce18409f35aae9cabfc5fa0ab3056305657e）
harness 修正對應 EF-06 / EF-07 / EF-08 / EF-09（見 edge-failure-ledger.md）。
單元：bsrAdmissionGate 29 + bsrAdmissionProbe 13 = 42 passed；deno check 兩支 Edge 通過；vitest 228 files / 2911 tests passed。
production 0 touch、未 deploy、未 Publish。
