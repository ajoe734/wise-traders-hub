

# Fix: Subscription Failure Should Not Redirect to Account Page

## Problem

In `src/pages/Checkout.tsx`, the result dialog's "確定" button always navigates to `/app/account` — even when the subscription **failed**. This is confusing because the user lands on the account settings page with no subscription, as shown in the screenshots.

The `AppCheckout.tsx` version already handles this correctly (failure → `/app`, success → `/app/account`), but the portal `Checkout.tsx` does not.

## Change

### `src/pages/Checkout.tsx` — Line 1220-1226

Update the `AlertDialogAction` to differentiate between success and failure:

- **Success**: Navigate to `/app/account` (so user can bind LINE, view subscription)
- **Failure**: Stay on the current checkout page (let user retry) or navigate back to the expert's page

Specifically:
- Change the `onClick` handler to check `resultDialog?.success`
- If success → `/app/account`
- If failure → remain on checkout (close the dialog and reset state so the user can retry)
- Update button text: success → "前往帳號頁" / failure → "重試" or "關閉"

## Result

After a failed payment, the user stays on the checkout page and can retry immediately, instead of being sent to a confusing account settings page with no subscription.

