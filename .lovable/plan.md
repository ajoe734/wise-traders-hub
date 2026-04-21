

# Fix Plan: Build Errors + LINE Login Redirect

## What's Wrong

1. **LINE login redirects to `/free-checkup` instead of `/app`**: Two bugs in the `line-login-callback` Edge Function:
   - `legendflow.tw` is not in `ALLOWED_ORIGINS`, so `app_origin` is rejected and falls back to the wrong site URL
   - The deployed function still has old code with `getUserByEmail` (which doesn't exist in the Supabase SDK) instead of the current `listUsers` approach — the function needs redeployment

2. **Build errors in Edge Functions**: Multiple TypeScript issues accumulated across many files

## Changes

### 1. Fix LINE Login Callback — `supabase/functions/line-login-callback/index.ts`

- Add `https://legendflow.tw` and `https://www.legendflow.tw` to `ALLOWED_ORIGINS` (line 42-45)
- This ensures `app_origin` from the custom domain is trusted, and the redirect goes to the correct site

### 2. Fix `acpay-recurring-manage/index.ts` — AES crypto type errors

- Apply the same `toPlainArrayBuffer` pattern already used in `_shared/paymentVerify.ts` to fix `Uint8Array` → `BufferSource` type mismatches on all 5 `crypto.subtle` calls (lines 31, 32, 46, 57, 68)
- Type the catch block `error` as `Error` (line 232)

### 3. Fix `acpay-notify/index.ts` — `subscriptionId` nullable

- Line 112: `subscriptionId` comes from `existing[0].id` which could be `string | null`. Add a non-null assertion or default since it's guaranteed by the `length > 0` check above

### 4. Fix `error is of type 'unknown'` across 10+ Edge Functions

All catch blocks use `error.message` without typing. Fix pattern: `(error as Error).message`

Affected files:
- `acpay-recurring-notify/index.ts` (line 138)
- `acpay-refund/index.ts` (line 224)
- `auto-cancel-failed-renewals/index.ts` (line 77)
- `confirm-linepay/index.ts` (line 147)
- `create-acpay-order/index.ts` (line 296)
- `create-analyst/index.ts` (line 158)
- `create-ecpay-order/index.ts` (line 107)
- `create-linepay-order/index.ts` (line 106)
- `daily-performance/index.ts` (line 103)
- And remaining truncated errors (same pattern)

### 5. Fix `checkup-knowledge/index.ts` — `SYSTEM_UID` scope

The `SYSTEM_UID` constant is defined inside a GET block (line 26) but used in the POST block (lines 93, 97). Move it to the top-level scope of the handler.

## Result

- LINE login from `/auth/login` → callback trusts `legendflow.tw` → redirects to `/app`
- All Edge Function build errors resolved
- No functional logic changes — only type fixes and origin whitelist update

