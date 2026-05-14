# Spec: Frontend — Settings Pages (Phase 10d)
**FR references**: FR-FE-11, FR-FE-12
**Status**: ✅ Implemented
**Prerequisite**: Phase 10a (auth guard in place); Phase 10c (AccountService exists)

---

## What

Phase 10d implements the two settings pages: notification preferences (live toggles) and account settings (read-only info + close account). These are the final authenticated pages; after this phase the Angular SPA is feature-complete.

---

## Why

FR-FE-11 and FR-FE-12 provide account management capabilities. Notification settings are a key engagement feature; account closure is a compliance requirement.

---

## New / Modified Files

- `frontend/src/app/services/settings.service.ts` — `getNotificationPreferences()`, `updateNotificationPreferences()`, `closeAccount()`
- `frontend/src/app/pages/settings-notifications/settings-notifications.component.ts` — three live-toggle switches
- `frontend/src/app/pages/settings-account/settings-account.component.ts` — read-only info + close account modal

---

## Behavior

### `SettingsService`

```typescript
getNotificationPreferences(accountId: string): Observable<NotificationPreferences>
// GET /accounts/:accountId/notifications

updateNotificationPreferences(
  accountId: string,
  prefs: Partial<{ transactionsEnabled: boolean; statementsEnabled: boolean; paymentRemindersEnabled: boolean }>
): Observable<NotificationPreferences>
// PATCH /accounts/:accountId/notifications

closeAccount(accountId: string): Observable<void>
// DELETE /accounts/:accountId
```

### Notification settings page (`/settings/notifications`)

- Loads preferences on init: `settingsService.getNotificationPreferences(accountId)`
- Three custom CSS toggle switches bound to Signals:
  - "Transaction notifications" → `transactionsEnabled`
  - "Statement notifications" → `statementsEnabled`
  - "Payment reminder notifications" → `paymentRemindersEnabled`
- Any toggle change immediately calls `settingsService.updateNotificationPreferences(accountId, { [field]: newValue })`
- Optimistic UI: toggle updates Signal immediately; reverts on API error with inline error banner
- Loading state on init; individual toggles disabled during their pending API call

### Account settings page (`/settings/account`)

- Loads account on init: `accountService.getAccount(accountId)` (reuses AccountService from Phase 10c)
- Read-only display: Account ID, credit limit, holder email, account created date, current status
- "Close Account" button — opens a custom modal overlay for confirmation:
  - Dialog text: "Are you sure you want to close your account? This cannot be undone."
  - "Confirm" button: calls `settingsService.closeAccount(accountId)`
  - On success: calls `authService.logout()`; navigates to `/` with farewell query param
  - On error: closes dialog; shows error snackbar
- Loading state while account data loads; "Close Account" button disabled during API call

---

## Done When
- [x] Notification settings page loads current preferences on init; all three toggles reflect API state (FR-FE-11)
- [x] Each toggle immediately patches the preference on change via optimistic UI; reverts on error (FR-FE-11)
- [x] No toggle calls the API when the value hasn't changed (no spurious PATCH on load) (FR-FE-11)
- [x] Account settings page displays all read-only fields: Account ID, email, credit limit, member since, account status (FR-FE-12)
- [x] Close account modal opens on button click; closes without action on cancel (FR-FE-12)
- [x] Close account: on confirm, calls DELETE, logs out, navigates to `/` with farewell notice (FR-FE-12)
- [x] All pages redirect to `/login` when JWT is absent or expired
- [x] Signals used for component state throughout
- [x] Spec status updated to ✅ Implemented
- [x] IMPLEMENTATION_PLAN.md Phase 10d row marked complete
