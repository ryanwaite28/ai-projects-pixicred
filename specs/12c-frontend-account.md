# Spec: Frontend — Account Pages (Phase 10c)
**FR references**: FR-FE-07, FR-FE-08, FR-FE-09, FR-FE-10
**Status**: 🔄 In Progress
**Prerequisite**: Phase 10a (auth guard and auth interceptor in place)

---

## What

Phase 10c implements the four core authenticated account pages: dashboard, transactions, payments, and statements. All four require a valid JWT and display financial account data. The `accountId` for all API calls is retrieved from the JWT payload via `AuthService.getAccountId()`.

---

## Why

FR-FE-07 through FR-FE-10 define the primary value delivered to the cardholder after account creation. These pages represent the main product experience.

---

## New / Modified Files

- `frontend/src/app/services/account.service.ts` — `getAccount()`, `getTransactions()`, `postPayment()`, `getStatements()`, `getStatement()`, `generateStatement()`
- `frontend/src/app/pages/dashboard/dashboard.component.ts` — account summary + recent transactions
- `frontend/src/app/pages/transactions/transactions.component.ts` — paginated transaction list
- `frontend/src/app/pages/payments/payments.component.ts` — payment form with FULL toggle
- `frontend/src/app/pages/statements/statements.component.ts` — statements list + detail view + on-demand generate

---

## Behavior

### `AccountService`

```typescript
getAccount(accountId: string): Observable<Account>
// GET /accounts/:accountId

getTransactions(accountId: string, cursor?: string): Observable<Transaction[]>
// GET /accounts/:accountId/transactions?cursor=<transactionId>

postPayment(accountId: string, amount: number | 'FULL', idempotencyKey: string): Observable<PaymentResult>
// POST /accounts/:accountId/payments

getStatements(accountId: string): Observable<Statement[]>
// GET /accounts/:accountId/statements

getStatement(accountId: string, statementId: string): Observable<StatementDetail>
// GET /accounts/:accountId/statements/:statementId

generateStatement(accountId: string, idempotencyKey: string): Observable<Statement>
// POST /accounts/:accountId/statements
```

All methods use Angular `HttpClient`. Auth interceptor injects `Authorization: Bearer` automatically.

### Dashboard (`/dashboard`)

- Loads on init: `accountService.getAccount(accountId)` via Signal
- Displays: credit limit, current balance, available credit, payment due date, balance satisfaction status (paid/unpaid indicator)
- Lists last 5 transactions (calls `getTransactions(accountId)`, takes first 5 from result)
- Quick-action links: "Make a Payment" → `/payments`; "View Statements" → `/statements`
- Loading skeleton while fetching; error state if API fails

### Transactions page (`/transactions`)

- Loads first page on init: `accountService.getTransactions(accountId)`
- Displays table: type badge (CHARGE/PAYMENT), merchant name (or "—" for payments), amount, date
- "Load More" button: calls `getTransactions(accountId, lastTransactionId)` and appends to list
- "Load More" hidden when response returns fewer than 20 items (end of list)
- Loading state per page load; no full-page re-render on pagination

### Payments page (`/payments`)

- Form: amount number input + "Pay Full Balance" toggle
- "Pay Full Balance" toggle: when on, disables and hides amount input; sends `amount = 'FULL'`
- On submit: generates `idempotencyKey` (UUID v4); calls `accountService.postPayment(accountId, amount, key)`
- On success: shows confirmation with resolved payment amount; resets form
- On error: displays API error message (e.g. `INSUFFICIENT_CREDIT`, `ACCOUNT_NOT_ACTIVE`)

### Statements page (`/statements`)

- Loads statement list on init: `accountService.getStatements(accountId)`
- Table/list: period (start–end dates), opening balance, closing balance, minimum payment due, due date
- Clicking a row: loads detail via `getStatement(accountId, statementId)`; displays inline below or as expanded panel
  - Detail shows: all statement fields + transaction breakdown table (type, merchant, amount, date)
- "Generate Statement" button: generates `idempotencyKey`; calls `generateStatement(accountId, key)`; on success appends new statement to top of list
- Loading and error states for each async operation

---

## Done When
- [ ] Dashboard loads account summary from API on init; displays all required fields
- [ ] Dashboard shows last 5 transactions
- [ ] Transactions page loads first page; "Load More" appends next page by cursor; hides when exhausted
- [ ] Payments form: amount field and FULL toggle are mutually exclusive; correct payload sent for each mode
- [ ] Payment confirmation shows resolved amount returned from API
- [ ] Statements list sorted by period descending; clicking a statement loads and shows full detail with transactions
- [ ] "Generate Statement" creates a new statement and prepends it to the list
- [ ] All pages redirect to `/login` when JWT is absent or expired (handled by auth guard + interceptor)
- [ ] Signals used for component state — no raw Observable subscriptions for UI state
- [ ] Spec status updated to ✅ Implemented
- [ ] IMPLEMENTATION_PLAN.md Phase 10c row marked complete
