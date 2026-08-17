# Stage B — real HTTP / PostgREST / supabase-js ACL matrix (B6)

Transport: real PostgREST 14.1 bound to the disposable clone, real
`@supabase/supabase-js` (supabase-js-node/2.97.0) and Python-urllib over
HTTP/1.1 with HS256-signed role JWTs. No `SET ROLE` impersonation.
Secrets (JWT secret, bearer tokens, connection string) are redacted.

| id | result | assertion | observed status / error code |
|----|--------|-----------|------------------------------|
| JS-01 | PASS | service_role rpc ok | `blocked=true version=13` |
| JS-02 | PASS | anon denied | `42501 permission denied for function bsr_admission_status` |
| JS-02 | PASS | authenticated denied | `42501 permission denied for function bsr_admission_status` |
| JS-03 | PASS | private_bsr unreachable via js | `PGRST106 Invalid schema: private_bsr` |
| JS-04 | PASS | anon cannot insert queue | `42501 permission denied for sequence tw_bsr_sync_queue_id_seq` |
| HTTP-01 | PASS | service_role rpc 200 | `status=200 body={"nonce": "dc9e9ed7-5de2-4a8c-9eb5-0bb9023b0dc6", "exists": true, "reason": "provider_plan_rejected", "blocked": true, "version": 13, "blocked_at": "2026-08-17T14:4` |
| HTTP-02 | PASS | anon denied | `status=401 body={"code":"42501","details":null,"hint":null,"message":"permission denied for function bsr_admission_status"}` |
| HTTP-03 | PASS | authenticated denied | `status=403 body={"code":"42501","details":null,"hint":null,"message":"permission denied for function bsr_admission_status"}` |
| HTTP-04 | PASS | private impl not exposed in public | `status=404 body={"code":"PGRST202","details":"Searched for the function public.gate_blocked without parameters or with a single unnamed json/jsonb parameter, but no matches were fo` |
| HTTP-05 | PASS | private_bsr schema unreachable | `status=406 body={"code":"PGRST106","details":null,"hint":"Only the following schemas are exposed: public","message":"Invalid schema: private_bsr"}` |
| HTTP-06 | PASS | anon terminalize denied (resolved signature) | `status=401 body={"code":"42501","details":null,"hint":null,"message":"permission denied for function bsr_block_and_terminalize_claims"}` |
| HTTP-07 | PASS | anon unblock denied (resolved signature) | `status=401 body={"code":"42501","details":null,"hint":null,"message":"permission denied for function bsr_unblock_after_probe"}` |
| HTTP-06 | PASS | authenticated terminalize denied (resolved signature) | `status=403 body={"code":"42501","details":null,"hint":null,"message":"permission denied for function bsr_block_and_terminalize_claims"}` |
| HTTP-07 | PASS | authenticated unblock denied (resolved signature) | `status=403 body={"code":"42501","details":null,"hint":null,"message":"permission denied for function bsr_unblock_after_probe"}` |
| HTTP-08 | PASS | service_role terminalize 200 (positive control) | `status=200 body={"transition": "already_blocked", "claim_count": 0, "gate_version": 13, "updated_count": 0, "lost_lease_count": 0}` |

Summary lines from the run log:
```
JS SUMMARY pass=5 fail=0
HTTP SUMMARY pass=10 fail=0
```
