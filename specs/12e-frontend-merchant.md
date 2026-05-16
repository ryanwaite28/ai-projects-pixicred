# Spec: Frontend — Merchant Demo Page (Phase 10e)
**FR references**: FR-FE-18
**Status**: ✅ Implemented
**Prerequisite**: Phase 10a (routing + auth guard in place), Phase 11b (merchant charge endpoint live)

---

## What

Phase 10e adds a public `/merchant` page to the Angular SPA. The page is accessible only when the user is **not** logged in (redirect logged-in users to `/dashboard`). It presents a charge form for simulating a merchant transaction using card credentials. On success, a confirmation panel replaces the form. On error, an inline error message is displayed.

---

## Why

FR-FE-18 requires a publicly accessible merchant demo page so that reviewers can simulate card purchases without needing a cardholder account session.

---

## New / Modified Files

### Angular routing
- `frontend/src/app/app.routes.ts` — add `/merchant` route with a `publicGuard` (redirect to `/dashboard` if JWT present)

### Auth guard
- `frontend/src/app/guards/public.guard.ts` — NEW file; functional guard that redirects to `/dashboard` if `localStorage.getItem('pixicred_jwt')` is truthy

### API service
- `frontend/src/app/services/merchant.service.ts` — NEW file; `postMerchantCharge(payload): Observable<Transaction>`

### Component
- `frontend/src/app/pages/merchant/merchant.component.ts` — NEW file; standalone component
- `frontend/src/app/pages/merchant/merchant.component.html` — charge form + confirmation panel
- `frontend/src/app/pages/merchant/merchant.component.css` — scoped styles (Tailwind utility classes; no custom CSS unless needed)

---

## Behavior

### Route guard: `publicGuard`

```typescript
// frontend/src/app/guards/public.guard.ts
import { inject } from '@angular/core';
import { Router } from '@angular/router';

export const publicGuard = () => {
  const router = inject(Router);
  if (localStorage.getItem('pixicred_jwt')) {
    return router.createUrlTree(['/dashboard']);
  }
  return true;
};
```

Applied to the `/merchant` route:

```typescript
{ path: 'merchant', component: MerchantComponent, canActivate: [publicGuard] }
```

### `MerchantService`

```typescript
// frontend/src/app/services/merchant.service.ts
postMerchantCharge(payload: MerchantChargePayload): Observable<Transaction>
```

- `POST {environment.apiUrl}/merchant/charge`
- No `Authorization` header — auth interceptor must not inject JWT on this public request (the interceptor should already skip injection when no token is present, which is the case for signed-out users)
- Returns `Observable<Transaction>`

```typescript
export interface MerchantChargePayload {
  cardNumber:     string;
  cardCvv:        string;
  merchantName:   string;
  amount:         number;
  idempotencyKey: string;
}
```

### `MerchantComponent` — form fields

Reactive form with the following controls:

| Field | Control name | Type | Validation |
|---|---|---|---|
| Card Number | `cardNumber` | text | required; pattern `^\d{16}$` |
| CVV | `cardCvv` | text | required; pattern `^\d{3}$` |
| Merchant Name | `merchantName` | text | required; minLength 1 |
| Amount (USD) | `amount` | number | required; min 0.01 |

`idempotencyKey` is auto-generated as a UUID (`crypto.randomUUID()`) at form submission time — it is **not** a form field. It is regenerated on every submit attempt (not on form init), so a user retry after a failed submission gets a new key.

### Form submission flow

1. Mark all controls touched (display validation errors on submit attempt)
2. If form invalid → stop; do not call service
3. Set `submitting = true`, clear previous error
4. Call `merchantService.postMerchantCharge({ ...form.value, idempotencyKey: crypto.randomUUID(), amount: +form.value.amount })`
5. On success: set `charged = true`, store returned `Transaction` in `chargedTransaction` signal — replace form with confirmation panel
6. On error: set `errorMessage` signal from API error response body (`error.message` or generic fallback); set `submitting = false`

### Template structure

```
<section class="merchant-page">
  <header>
    <h1>Merchant Demo</h1>
    <p>Simulate a card purchase using PixiCred card credentials.</p>
  </header>

  @if (!charged()) {
    <form [formGroup]="form" (ngSubmit)="onSubmit()">
      <!-- Card Number -->
      <!-- CVV -->
      <!-- Merchant Name -->
      <!-- Amount -->
      @if (errorMessage()) {
        <p class="error-banner">{{ errorMessage() }}</p>
      }
      <button type="submit" [disabled]="submitting()">
        {{ submitting() ? 'Processing…' : 'Charge Card' }}
      </button>
    </form>
  } @else {
    <div class="confirmation-panel">
      <h2>Charge Approved</h2>
      <dl>
        <dt>Transaction ID</dt><dd>{{ chargedTransaction()!.id }}</dd>
        <dt>Amount</dt><dd>{{ chargedTransaction()!.amount | currency }}</dd>
        <dt>Merchant</dt><dd>{{ chargedTransaction()!.merchantName }}</dd>
        <dt>Date</dt><dd>{{ chargedTransaction()!.createdAt | date:'medium' }}</dd>
      </dl>
      <button (click)="reset()">Make Another Charge</button>
    </div>
  }
</section>
```

`reset()` clears `charged`, resets the form, clears signals.

### Navigation

- Add "Merchant Demo" link to the public nav (visible when signed out) in the root layout / navbar component (whichever component holds the top nav links for signed-out users).
- The link must NOT appear in the authenticated nav.

### Component state (signals)

```typescript
submitting   = signal(false);
charged      = signal(false);
errorMessage = signal<string | null>(null);
chargedTransaction = signal<Transaction | null>(null);
```

### Styling notes

- Use the same PixiCred fintech Tailwind theme used on `/apply`
- Card number input: `maxlength="16"`, `inputmode="numeric"`
- CVV input: `maxlength="3"`, `inputmode="numeric"`, `type="password"` (hide digits)
- Amount input: `step="0.01"`, `min="0.01"`
- Submit button: disabled + spinner text while `submitting()` is true
- Error banner: styled as an alert box (red border, light red background), same pattern as used on other error states in the app

---

## Done When

- [x] `/merchant` route registered with `publicGuard`; logged-in users redirected to `/dashboard`
- [x] `MerchantService.postMerchantCharge` calls `POST /merchant/charge` without Authorization header when no JWT present
- [x] Charge form validates all four fields before submitting
- [x] `idempotencyKey` is generated fresh at each submit, not at form init
- [x] On success, confirmation panel shows transaction ID, amount, merchant, date
- [x] On error, inline error message displays API error message
- [x] "Merchant Demo" link visible in signed-out nav; not visible in signed-in nav
- [x] `ng build` succeeds with no type errors
- [ ] Manual browser test: happy path charge; then test with wrong CVV (expects 422 error displayed) *(requires local dev server + backend; flag for manual QA)*
- [x] Spec status updated to ✅ Implemented
- [x] `specs/12a-frontend-scaffold.md` synced (publicGuard added)
