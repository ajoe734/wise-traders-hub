# Edge Function Shared Layer

Single source of truth for cross-cutting concerns. **New / edited edge functions should import from here instead of inlining patterns.**

## Modules

### `cors.ts` — CORS & response helpers
```ts
import { corsPreflight, jsonResponse, errorResponse, corsHeaders } from '../_shared/cors.ts';

if (req.method === 'OPTIONS') return corsPreflight();
return jsonResponse({ ok: true });
return errorResponse('bad request', 400);
```
Broad allow-list covers every header the web client currently sends. **Never write a `const corsHeaders = {…}` block inline.**


### `edgeLogger.ts` — structured logging
```ts
import { createLogger, withLogging } from '../_shared/edgeLogger.ts';

// Option A — manual logger
const log = createLogger('my-fn');
log.info('start', { itemId });
log.error('db_error', { code: err.code });

// Option B — full HOF (handles OPTIONS, request id, duration, uncaught → 500)
Deno.serve(withLogging('my-fn', async (req, log) => {
  log.info('parsed', { body });
  return jsonResponse({ ok: true });
}));
```
Each call emits one JSON line: `{ts, level, fn, requestId, msg, ...meta}`. `withLogging` reads `x-correlation-id` from the request and echoes it back on the response so frontend → edge logs can be joined.

### `supabaseClients.ts` — client factories
```ts
import { serviceClient, userClient, getCallerUserId } from '../_shared/supabaseClients.ts';

const admin = serviceClient();                    // bypass RLS
const asUser = userClient(req);                   // respect RLS, forward JWT
const userId = await getCallerUserId(req);        // null if unauthenticated
```
**Never** call `createClient(...)` inline anymore — pins drift, options diverge, privilege bugs creep in.

### Domain modules (already in use)
- `paymentProcessor.ts` / `paymentVerify.ts` / `subscriptionRenewal.ts` / `refundProcessor.ts` / `revenueSplit.ts` — billing/payment single source of truth (also unit-tested via vitest re-import).
- `checkupQuota.ts` / `withCheckup.ts` / `stockPriceWaterfall.ts` / `newsCache.ts` / `jsonRepair.ts` — checkup domain helpers.
- `ecpayCredentials.ts` — ECPay key/secret resolution.
- `inputCoerce.ts` / `inputValidator.ts` — input parsing/validation primitives.

## Migration guide for legacy functions

48 existing functions still inline `corsHeaders` and `createClient(...)`. **Do not mass-rewrite.** When you edit one for another reason:

1. Delete the inline `const corsHeaders = {…}` block, import from `./cors.ts` instead.
2. Replace `createClient(SUPABASE_URL, KEY, …)` with `serviceClient()` or `userClient(req)`.
3. Wrap the handler in `withLogging('fn-name', …)` and swap `console.log/error` calls for `log.info/error`.

Each migrated function loses ~30 lines of boilerplate and gains a request id + duration log for free.
