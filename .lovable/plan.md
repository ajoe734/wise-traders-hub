

# Fix: Add Inline Form Validation to All Checkout and Auth Forms

## Problem

All forms across the app lack proper inline field validation. When required fields are empty or invalid, errors are either shown as browser `alert()` popups, result dialogs, or not shown at all. Users see no per-field feedback (red borders, error text below inputs) before submission.

**Affected forms:**

| Page | Current behavior | Missing |
|------|-----------------|---------|
| `Checkout.tsx` (Portal ACpay) | Shows result dialog popup | No inline field errors |
| `AppCheckout.tsx` (App ACpay) | Uses `alert()` popup | No inline field errors |
| `Register.tsx` | Only checks password match via toast | No empty/format validation |
| `Login.tsx` | No client-side validation | No empty field check |

## Changes

### 1. Add inline validation state to both Checkout pages

**Files:** `src/pages/Checkout.tsx`, `src/pages/app/AppCheckout.tsx`

- Add a `fieldErrors` state object: `{ cardHolderName?: string, cardHolderEmail?: string, cardHolderPhone?: string }`
- Create a `validateCardholderFields()` function that checks:
  - `cardHolderName` — required, must be English letters + spaces only
  - `cardHolderEmail` — required, must match email format
  - `cardHolderPhone` — required, must be digits only, 9-10 chars
- Call validation on submit; if errors exist, set `fieldErrors` and **return early** (no dialog, no alert)
- Clear individual field errors `onChange` as user corrects them
- Render error messages as `<p className="text-xs text-destructive mt-1">` below each input
- Apply `border-destructive` class to inputs with errors

### 2. Add inline validation to Register page

**File:** `src/pages/auth/Register.tsx`

- Validate before submit:
  - Name: required
  - Email: required, valid format
  - Password: required, min 6 chars
  - Confirm password: must match
- Show per-field error text below each input
- Prevent submit until fixed

### 3. Add inline validation to Login page

**File:** `src/pages/auth/Login.tsx`

- Validate before submit:
  - Email: required
  - Password: required
- Show per-field error text below each input

### 4. Remove `alert()` calls

- Replace all `alert("請填寫持卡人資訊...")` with inline error rendering
- In `Checkout.tsx`, replace the `setResultDialog` for missing fields with inline errors instead of a modal

## Result

- Every required field shows a red border and error message when invalid
- Errors clear as the user corrects each field
- No more `alert()` popups or modal dialogs for simple validation errors
- Submit button behavior unchanged — just blocked until fields are valid

