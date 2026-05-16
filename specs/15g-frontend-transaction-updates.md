# Spec: Frontend — Transaction Status & Dispute (Phase 12g)
**FR references**: FR-FE-08, FR-FE-19, FR-FE-20
**Status**: ✅ Implemented
**Prerequisite**: Phase 12b ✅ (PROCESSING/DENIED in API responses), Phase 12d ✅ (dispute endpoint live), Phase 10c ✅ (transactions page exists)

---

## What

Phase 12g updates the Angular transactions page (`/transactions`) to display a status badge on each transaction and add a "Dispute" button for `POSTED` transactions. Clicking "Dispute" shows a confirmation modal; on confirmation, calls `POST /accounts/:accountId/transactions/:transactionId/dispute` and updates the transaction's status in the list to `DISPUTED`. No new pages are added — this is a targeted enhancement of the existing `transactions.component`.

---

## Why

FR-FE-19 requires status badges on all transactions. FR-FE-20 requires a dispute action with a confirmation modal available on POSTED transactions.

---

## New / Modified Files

### Component
- `frontend/src/app/pages/transactions/transactions.component.ts` — add `disputeTransaction()` method; add `disputing` signal (tracks which transactionId is being disputed); add `showDisputeModal` signal and `pendingDisputeId` signal
- `frontend/src/app/pages/transactions/transactions.component.html` — add status badge to each row; add Dispute button on POSTED rows; add confirmation modal

### Service
- `frontend/src/app/services/account.service.ts` — add `disputeTransaction(accountId: string, transactionId: string): Observable<Transaction>`

### Types (frontend)
- `frontend/src/app/services/account.service.ts` — update `Transaction` interface to include `status` and `statusUpdatedAt` fields

---

## Behavior

### `Transaction` interface update

```typescript
export interface Transaction {
  transactionId:   string;
  accountId:       string;
  type:            'CHARGE' | 'PAYMENT';
  merchantName:    string | null;
  amount:          number;
  idempotencyKey:  string;
  status:          'PROCESSING' | 'POSTED' | 'DENIED' | 'DISPUTED' | 'DISPUTE_ACCEPTED' | 'DISPUTE_DENIED';
  statusUpdatedAt: string;
  createdAt:       string;
}
```

### `disputeTransaction` service method

```typescript
disputeTransaction(accountId: string, transactionId: string): Observable<Transaction> {
  return this.http
    .post<{ data: Transaction }>(
      `${environment.apiUrl}/accounts/${accountId}/transactions/${transactionId}/dispute`,
      {}
    )
    .pipe(map((r) => r.data));
}
```

### Status badge display

| Status | Badge color / class |
|---|---|
| `PROCESSING` | amber — `pxc-badge-amber` |
| `POSTED` | green — `pxc-badge-green` |
| `DENIED` | red — `pxc-badge-red` |
| `DISPUTED` | blue — `pxc-badge-blue` |
| `DISPUTE_ACCEPTED` | green — `pxc-badge-green` |
| `DISPUTE_DENIED` | red — `pxc-badge-red` |

Badge is a small pill (`<span>`) rendered inline next to the transaction type/merchant label.

### Dispute button

Visible only on `CHARGE` transactions with `status === 'POSTED'`. Hidden (not just disabled) for all other statuses. While a dispute API call is in-flight (`disputing() === tx.transactionId`), the button shows a spinner and is disabled.

### Confirmation modal

```
@if (showDisputeModal()) {
  <div class="pxc-modal-backdrop">
    <div class="pxc-modal">
      <h3>Dispute Transaction?</h3>
      <p>Are you sure you want to dispute the ${{ pendingDisputeTx()!.amount | currency }}
         charge at {{ pendingDisputeTx()!.merchantName }}?
         This action cannot be undone.</p>
      <div class="pxc-modal-actions">
        <button (click)="cancelDispute()" class="pxc-btn-ghost">Cancel</button>
        <button (click)="confirmDispute()" class="pxc-btn-danger"
                [disabled]="disputing()">
          {{ disputing() ? 'Submitting…' : 'Yes, Dispute' }}
        </button>
      </div>
    </div>
  </div>
}
```

### Component state (signals)

```typescript
showDisputeModal    = signal(false);
pendingDisputeId    = signal<string | null>(null);
pendingDisputeTx    = computed(() =>
  this.transactions().find(t => t.transactionId === this.pendingDisputeId()) ?? null
);
disputing           = signal(false);
disputeError        = signal<string | null>(null);
```

### Dispute flow

```typescript
openDisputeModal(tx: Transaction): void {
  this.pendingDisputeId.set(tx.transactionId);
  this.showDisputeModal.set(true);
}

cancelDispute(): void {
  this.showDisputeModal.set(false);
  this.pendingDisputeId.set(null);
}

confirmDispute(): void {
  const txId = this.pendingDisputeId()!;
  this.disputing.set(true);
  this.disputeError.set(null);
  this.accountService.disputeTransaction(this.accountId(), txId).subscribe({
    next: (updated) => {
      this.transactions.update(list =>
        list.map(t => t.transactionId === txId ? updated : t)
      );
      this.showDisputeModal.set(false);
      this.pendingDisputeId.set(null);
      this.disputing.set(false);
    },
    error: (err) => {
      this.disputeError.set(err?.error?.error?.message ?? 'Dispute failed. Please try again.');
      this.disputing.set(false);
    },
  });
}
```

On success, the transaction in `transactions` signal is replaced with the updated transaction (status = `DISPUTED`). The Dispute button disappears from that row because `status !== 'POSTED'`.

### Merchant page update (FR-FE-18)

The merchant page confirmation panel currently shows merchant name, amount, and updated available credit. Update it to also show the returned transaction `status` (PROCESSING or DENIED) with appropriate messaging:
- `PROCESSING`: "Your charge is being processed and will post within 24 hours."
- `DENIED`: "This charge was denied — insufficient credit available."

---

## Done When

- [x] `Transaction` interface in `account.service.ts` includes `status` and `statusUpdatedAt`
- [x] `disputeTransaction(accountId, transactionId)` service method calls `POST /accounts/:id/transactions/:id/dispute`
- [x] Status badge renders for all 6 status values with correct color coding
- [x] "Dispute" button visible only on POSTED CHARGE transactions
- [x] Confirmation modal shown before API call is made; Cancel closes modal without calling API
- [x] On confirmed dispute: API called, transaction status updated in list to DISPUTED, Dispute button removed
- [x] On dispute API error: error message shown inside modal; modal stays open
- [x] While dispute in-flight: button disabled + spinner text
- [x] Merchant page confirmation panel shows transaction status with appropriate messaging
- [x] `ng build` succeeds with no type errors
- [x] Spec status updated to ✅ Implemented
- [x] `IMPLEMENTATION_PLAN.md` Phase 12g row updated to ✅ Complete
- [x] `specs/12c-frontend-account.md` synced to reflect status badge and dispute additions
