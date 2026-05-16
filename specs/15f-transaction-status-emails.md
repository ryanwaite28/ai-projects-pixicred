# Spec: Transaction Status Emails (Phase 12f)
**FR references**: FR-EMAIL-11, FR-EMAIL-12, FR-EMAIL-13, FR-EMAIL-14, FR-NOTIF-04, FR-NOTIF-07
**Status**: ✅ Implemented
**Prerequisite**: Phase 12a ✅ (status field exists), Phase 6 ✅ (notification service + email patterns established)

---

## What

Phase 12f adds four new email templates and their corresponding service functions and Handlebars templates. It also updates the notification service to route the new SNS events (`TRANSACTION_CREATED`, `TRANSACTION_POSTED` for CHARGE type, `TRANSACTION_DISPUTED`, `DISPUTE_RESOLVED`) to the correct email functions. The existing `sendTransactionEmail` (for payments via `TRANSACTION_POSTED`) is unchanged.

---

## Why

FR-EMAIL-11 through FR-EMAIL-14 require dedicated email communications for: new charge notifications (PROCESSING or DENIED), settled charge notifications, dispute confirmation, and dispute resolution. FR-NOTIF-04 requires the first two to be gated by `transactionsEnabled`. FR-NOTIF-07 requires the last two to always be sent.

---

## New / Modified Files

### Email templates (Handlebars)
- `src/emails/templates/charge-created.hbs` — NEW; PROCESSING and DENIED variants via `{{#if isDenied}}` block
- `src/emails/templates/charge-posted.hbs` — NEW; settled charge notification
- `src/emails/templates/dispute-confirmation.hbs` — NEW; dispute received acknowledgment
- `src/emails/templates/dispute-resolution.hbs` — NEW; DISPUTE_ACCEPTED or DISPUTE_DENIED outcome

### Email service files
- `src/emails/charge-created.template.ts` — NEW; builds `SendEmailInput` from transaction + account
- `src/emails/charge-posted.template.ts` — NEW
- `src/emails/dispute-confirmation.template.ts` — NEW
- `src/emails/dispute-resolution.template.ts` — NEW

### Service layer
- `src/service/notification.service.ts` — add `sendChargeCreatedEmail`, `sendChargePostedEmail`, `sendDisputeConfirmationEmail`, `sendDisputeResolutionEmail`; update event routing to handle `TRANSACTION_CREATED`, `TRANSACTION_DISPUTED`, `DISPUTE_RESOLVED`; update `TRANSACTION_POSTED` routing to distinguish PAYMENT vs CHARGE type

### Types
- `src/types/index.ts` — add new service action entries for the four new email functions (if not already added)

### Notification handler
- `src/handlers/service/service.handler.ts` — add dispatch cases for the four new email service actions

---

## Behavior

### Event routing in notification service

```typescript
switch (event.eventType) {
  // Existing (unchanged)
  case 'TRANSACTION_POSTED':
    if (transaction.type === 'PAYMENT') {
      if (prefs.transactionsEnabled) await sendTransactionEmail(prisma, clients, { transactionId });
    } else {
      // CHARGE type settled by settlement job
      if (prefs.transactionsEnabled) await sendChargePostedEmail(prisma, clients, { transactionId });
    }
    break;

  // New
  case 'TRANSACTION_CREATED':
    // Only for CHARGE type (FR-TXN-06: payments still fire TRANSACTION_POSTED)
    if (prefs.transactionsEnabled) await sendChargeCreatedEmail(prisma, clients, { transactionId });
    break;

  case 'TRANSACTION_DISPUTED':
    // No preference gate (FR-NOTIF-07)
    await sendDisputeConfirmationEmail(prisma, clients, { transactionId });
    break;

  case 'DISPUTE_RESOLVED':
    // No preference gate (FR-NOTIF-07)
    await sendDisputeResolutionEmail(prisma, clients, { transactionId, outcome: event.outcome });
    break;

  // ... existing cases unchanged
}
```

### `sendChargeCreatedEmail` (FR-EMAIL-11)

Fetches transaction and account. Renders `charge-created.hbs` with:
- `merchantName`
- `amount` (formatted as currency)
- `status` (`PROCESSING` or `DENIED`)
- `isDenied` boolean flag for Handlebars conditional
- `currentBalance` (unchanged if DENIED; new balance if PROCESSING)
- `availableCredit`
- `holderEmail`

Subject: `"Transaction Processing — ${{amount}} at {{merchantName}}"` or `"Transaction Denied — ${{amount}} at {{merchantName}}"`

### `sendChargePostedEmail` (FR-EMAIL-12)

Fetches transaction and account. Renders `charge-posted.hbs` with:
- `merchantName`
- `amount`
- `createdAt` (original transaction date — "Transaction Date")
- `statusUpdatedAt` (posted date — "Posted Date")
- `holderEmail`

Subject: `"Transaction Posted — ${{amount}} at {{merchantName}}"`

### `sendDisputeConfirmationEmail` (FR-EMAIL-13)

Fetches transaction and account. Renders `dispute-confirmation.hbs` with:
- `transactionId` (abbreviated display: first 8 chars + `...`)
- `merchantName`
- `amount`
- `statusUpdatedAt` (dispute filed date)
- `holderEmail`

Subject: `"Dispute Received — ${{amount}} at {{merchantName}}"`

### `sendDisputeResolutionEmail` (FR-EMAIL-14)

Fetches transaction and account. Renders `dispute-resolution.hbs` with:
- `transactionId` (abbreviated)
- `merchantName`
- `amount`
- `outcome` (`DISPUTE_ACCEPTED` or `DISPUTE_DENIED`)
- `isAccepted` boolean flag for Handlebars conditional
- `statusUpdatedAt` (resolution date)
- `holderEmail`

Subject: `"Dispute Accepted — ${{amount}} at {{merchantName}}"` or `"Dispute Denied — ${{amount}} at {{merchantName}}"`

### Template styling

All four templates follow the existing PixiCred email theme established in `approval.hbs` and `transaction.hbs`: centered card layout, PixiCred navy header, Inter font stack, action buttons where applicable, footer with `no-reply@pixicred.com`.

---

## Done When

- [x] `charge-created.hbs` renders correctly for both PROCESSING and DENIED variants
- [x] `charge-posted.hbs` renders with original + posted dates
- [x] `dispute-confirmation.hbs` renders with transaction details and dispute-received messaging
- [x] `dispute-resolution.hbs` renders distinct messaging for ACCEPTED vs DENIED outcome
- [x] `sendChargeCreatedEmail` fetches transaction + account and sends via SES
- [x] `sendChargePostedEmail` fetches transaction + account and sends via SES
- [x] `sendDisputeConfirmationEmail` fetches transaction + account and sends via SES
- [x] `sendDisputeResolutionEmail` fetches transaction + account, uses outcome from event payload
- [x] Notification handler routes `TRANSACTION_CREATED` → `sendChargeCreatedEmail` (gated by `transactionsEnabled` in service)
- [x] `sendTransactionEmail` routes `TRANSACTION_POSTED` for CHARGE type → `buildChargePostedEmail` (gated by `transactionsEnabled`)
- [x] `sendTransactionEmail` routes `TRANSACTION_POSTED` for PAYMENT type → `buildTransactionEmail` (unchanged)
- [x] Notification handler routes `TRANSACTION_DISPUTED` → `sendDisputeConfirmationEmail` (no preference gate)
- [x] Notification handler routes `DISPUTE_RESOLVED` → `sendDisputeResolutionEmail` (no preference gate)
- [x] Unit tests for all four template functions: correct subject, correct To address, key data fields present in rendered output
- [x] `npm run typecheck` passes
- [x] Spec status updated to ✅ Implemented
- [x] `IMPLEMENTATION_PLAN.md` Phase 12f row updated to ✅ Complete
- [x] `specs/08-notifications.md` synced to reflect new event routing
