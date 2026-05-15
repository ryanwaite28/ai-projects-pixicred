# PixiCred — Credit Card Lending Platform
### Project Master Document v1.0
> This document is the **single source of truth** for the PixiCred platform. All architecture decisions, requirements, API contracts, infrastructure configurations, security policies, implementation plans, and project rules are defined here. AI coding assistants (Claude Code, Cursor, Copilot, etc.) must generate specs, implementation tasks, and code directly from this document. **Do not store project decisions anywhere else.**

---

## Table of Contents
1. [Project Overview](#1-project-overview)
2. [Functional Requirements](#2-functional-requirements)
3. [Non-Functional Requirements](#3-non-functional-requirements)
4. [System Architecture](#4-system-architecture)
5. [AWS Infrastructure & Resources](#5-aws-infrastructure--resources)
6. [Software Design](#6-software-design)
7. [Data Model](#7-data-model)
8. [API Documentation](#8-api-documentation)
9. [DevOps & Deployment](#9-devops--deployment)
10. [Local Development](#10-local-development)
11. [Implementation Plan](#11-implementation-plan)
12. [Project Rules & AI-IDE Guidelines](#12-project-rules--ai-ide-guidelines)
13. [Infrastructure Cost Estimates](#13-infrastructure-cost-estimates)
14. [Testing Plan](#14-testing-plan)

---

## 1. Project Overview

### 1.1 What Is PixiCred?

> **Portfolio Note**: PixiCred is a **portfolio project** demonstrating full-stack serverless engineering, AWS architecture, event-driven design, and DevOps skills in the financial services domain. The architecture and feature depth are intentionally production-grade — not tutorial-grade. The system design originates from a Capital One system design interview question, and the implementation reflects what a well-funded engineering team would actually build — with deliberate, documented cost trade-offs made for the portfolio deployment context.

PixiCred is a serverless, cloud-native credit card lending platform. It handles the full credit card lifecycle: accepting applications, running credit checks, making lending decisions, issuing credit accounts, tracking spending, processing payments, generating statements, and managing notification preferences.

### 1.2 How It Works

```
APPLICANT
  → Submits credit card application (name, email, income, mock SSN)
  → Credit check is performed asynchronously via mock bureau
  → On decline: receives decline email
  → On approval: receives approval email with credit limit + account setup instructions

CARDHOLDER (approved applicant)
  → Account opens with a $500 starting balance and a payment due on the 25th of next month
  → Mock charges post against the account (increasing balance)
  → Mock payments reduce the balance; a "pay full balance" convenience option brings balance to $0
  → Receives payment-due reminder emails 7 days before due date (configurable look-ahead)
  → Account auto-closes if balance is unpaid 14 days after the due date; auto-close email sent
  → Can voluntarily close their account at any time; may reapply for a new account after closing
  → Receives transaction notifications (if opted in)
  → Receives weekly/monthly statements (scheduled) or on-demand
  → Manages notification preferences (transactions, statements, payment reminders)
```

### 1.3 Key Entities

| Entity | Description |
|---|---|
| **Application** | A credit card application submitted by a candidate. Has its own lifecycle independent of an Account. |
| **Account** | Created only upon application approval. Holds credit limit, balance, available credit, and status. |
| **Transaction** | A debit or credit posted against an Account (mock merchant charges or payments). |
| **Statement** | A periodic or on-demand snapshot of an Account's transactions, balance, and minimum payment due. |
| **NotificationPreference** | Per-account settings controlling which events trigger email delivery. |
| **PaymentDueSchedule** | Tracks the current payment due date per account and whether it has been satisfied. Drives reminder emails and auto-close enforcement. |

### 1.4 Mock Credit Check Logic

The credit check is implemented deterministically using a mock 5-digit SSN field on the application:

- **Decline rule**: SSN starts AND ends with `5` (e.g. `54315`, `50905`) → application declined
- **Approve rule**: any other valid 5-digit SSN → application approved
- Credit limit on approval is calculated from reported income: `min(max(income * 0.1, 500), 15000)` (floored at $500, capped at $15,000)

This determinism makes the system fully testable with synthetic data and makes portfolio demonstrations predictable.

### 1.5 Project Identity

| Property | Value |
|---|---|
| **Project name** | PixiCred |
| **Domain** | `pixicred.com` |
| **API (dev)** | `https://api.dev.pixicred.com` |
| **API (prod)** | `https://api.pixicred.com` |
| **AWS Account** | `408141212087` (shared portfolio account) |
| **AWS Region** | `us-east-1` |
| **Environments** | `dev`, `prod` (single account, name-prefixed) |
| **Resource prefix** | `pixicred-{env}-{descriptor}` |
| **Email sender** | `no-reply@pixicred.com` |

### 1.6 Mission

To demonstrate end-to-end financial platform engineering: async workflows, event-driven architecture, idempotent payment processing, scheduled job design, and operational observability — all on a cost-optimized AWS serverless stack.

---

## 2. Functional Requirements

### 2.1 Application & Underwriting

- **FR-APP-01**: Applicants submit a credit card application with: `firstName`, `lastName`, `email`, `dateOfBirth`, `annualIncome`, `mockSsn` (5-digit string)
- **FR-APP-02**: Application intake performs synchronous field validation (all fields required; `mockSsn` must be exactly 5 digits; `annualIncome` must be positive; valid email format)
- **FR-APP-03**: On successful validation, an `Application` record is created with status `PENDING` and a credit check job is enqueued asynchronously
- **FR-APP-04**: The credit check logic: if `mockSsn[0] === '5'` AND `mockSsn[4] === '5'` → `DECLINED`; otherwise → `APPROVED`
- **FR-APP-05**: On `DECLINED`: application status updated to `DECLINED`, decline email sent to applicant
- **FR-APP-06**: On `APPROVED`: application status updated to `APPROVED`, `Account` created with computed credit limit, approval email sent
- **FR-APP-07**: Credit limit formula: `min(max(annualIncome * 0.10, 500), 15000)` rounded to nearest dollar
- **FR-APP-08**: Applicants may check the status of their application by `applicationId`
- **FR-APP-09**: Each email address may have at most one active application or open account at a time. A new application is rejected with `DUPLICATE_APPLICATION` if the same email already has a `PENDING` or `APPROVED` application **or** an `ACTIVE` or `SUSPENDED` account. Re-application is allowed after an account reaches `CLOSED` status (whether closed by the user or auto-closed for non-payment).

### 2.2 Account Management

- **FR-ACC-01**: An `Account` is created automatically upon application approval; never created manually
- **FR-ACC-02**: Account fields: `accountId`, `applicationId`, `holderEmail`, `creditLimit`, `currentBalance`, `availableCredit` (derived), `status`, `paymentDueDate`, `closedAt`, `closeReason`, `createdAt`
- **FR-ACC-03**: `availableCredit` is always derived as `creditLimit - currentBalance`; never stored independently
- **FR-ACC-04**: Accounts can be retrieved by `accountId`
- **FR-ACC-05**: Account status transitions: `ACTIVE` → `SUSPENDED` → `ACTIVE` (reinstate); `ACTIVE` | `SUSPENDED` → `CLOSED` (irreversible). Close reasons: `USER_REQUESTED` | `AUTO_NONPAYMENT`
- **FR-ACC-06**: Upon account creation, `currentBalance` is initialized to **$500** (the opening balance the cardholder must pay off)
- **FR-ACC-07**: Upon account creation, `paymentDueDate` is set to the **25th of the next calendar month** from `createdAt`. Example: created on any day in January → due date is February 25th
- **FR-ACC-08**: A `PaymentDueSchedule` record is created alongside the account (see Section 2.8)
- **FR-ACC-09**: User-initiated account close: `DELETE /accounts/:accountId`. Sets `status = CLOSED`, `closeReason = USER_REQUESTED`, `closedAt = NOW()`. Allowed only on `ACTIVE` or `SUSPENDED` accounts. Sends account-closed email to the holder
- **FR-ACC-10**: After an account is `CLOSED`, the holder may submit a new credit application (FR-APP-09). The new application is treated as a fresh application — a new `Account` with a new `accountId` is created on approval

### 2.3 Transactions

- **FR-TXN-01**: Mock charges are posted via API: `accountId`, `merchantName`, `amount`, `idempotencyKey`
- **FR-TXN-02**: Before posting: validate account exists, account is `ACTIVE`, `amount > 0`, `amount <= availableCredit`
- **FR-TXN-03**: On success: `Transaction` record created (type `CHARGE`), `currentBalance` incremented
- **FR-TXN-04**: If `amount > availableCredit`: rejected with `INSUFFICIENT_CREDIT`
- **FR-TXN-05**: Transactions are idempotent by `idempotencyKey` — replaying returns original transaction, no double-post
- **FR-TXN-06**: After a successful charge, a `TRANSACTION_POSTED` event is published to SNS
- **FR-TXN-07**: Transaction list endpoint returns all transactions for an account, sorted by `createdAt` descending, cursor-paginated

### 2.4 Payments

- **FR-PAY-01**: Payments posted via API: `accountId`, `amount`, `idempotencyKey`. The `amount` field accepts either a positive number or the special string value `"FULL"` to pay the entire current balance
- **FR-PAY-02**: Validation: account exists, account is `ACTIVE` or `SUSPENDED` (payments allowed on suspended), resolved `amount > 0`, resolved `amount <= currentBalance`
- **FR-PAY-03**: On success: `Transaction` record created (type `PAYMENT`), `currentBalance` decremented by the resolved amount. If `currentBalance` reaches `0`, the `PaymentDueSchedule` for this account is marked `satisfied = true`
- **FR-PAY-04**: Payments are idempotent by `idempotencyKey`
- **FR-PAY-05**: Minimum payment calculation: `max(25, currentBalance * 0.02)` — displayed on statements; not enforced as a hard floor on payment amount
- **FR-PAY-06**: After a successful payment, a `TRANSACTION_POSTED` event is published to SNS
- **FR-PAY-07**: When `amount = "FULL"` is submitted, the resolved amount equals the account's `currentBalance` at the moment of processing. The idempotency guarantee applies to the resolved amount — replaying the same key returns the original payment amount, even if the balance has since changed

### 2.5 Statements

- **FR-STMT-01**: Statements generated on schedule: weekly (Monday 00:00 UTC) and monthly (1st of month 00:00 UTC)
- **FR-STMT-02**: Scheduled generation is triggered by EventBridge rules that enqueue to `statement-gen` SQS queue
- **FR-STMT-03**: Each statement contains: `statementId`, `accountId`, `periodStart`, `periodEnd`, `openingBalance`, `closingBalance`, `totalCharges`, `totalPayments`, `minimumPaymentDue`, `dueDate` (21 days after `periodEnd`), `transactions[]`
- **FR-STMT-04**: On-demand statement generation: `POST /accounts/:accountId/statements`
- **FR-STMT-05**: Statement list: `GET /accounts/:accountId/statements` — sorted by `periodEnd` descending
- **FR-STMT-06**: Statement detail: `GET /accounts/:accountId/statements/:statementId`
- **FR-STMT-07**: After generation, a `STATEMENT_GENERATED` event is published to SNS
- **FR-STMT-08**: Statement generation is idempotent per account per period — re-running does not create duplicates

### 2.6 Notification Preferences

- **FR-NOTIF-01**: Each account has a `NotificationPreference` record auto-created at account creation with defaults: `transactionsEnabled: true`, `statementsEnabled: true`, `paymentRemindersEnabled: true`
- **FR-NOTIF-02**: Preferences updated via `PATCH /accounts/:accountId/notifications`
- **FR-NOTIF-03**: Preferences retrieved via `GET /accounts/:accountId/notifications`
- **FR-NOTIF-04**: On `TRANSACTION_POSTED` event: check `transactionsEnabled` before sending email
- **FR-NOTIF-05**: On `STATEMENT_GENERATED` event: check `statementsEnabled` before sending email
- **FR-NOTIF-06**: Email delivery failures are logged; they do not fail the originating operation

### 2.7 Email Notifications

- **FR-EMAIL-01**: Decline email: applicant's email; includes reason and note that they may reapply
- **FR-EMAIL-02**: Approval email: applicant's email; includes credit limit, account ID, opening balance ($500), first payment due date, and setup instructions
- **FR-EMAIL-03**: Transaction email: account holder's email; merchant name, amount, new balance, available credit
- **FR-EMAIL-04**: Statement-ready email: account holder's email; period, closing balance, minimum payment due, due date
- **FR-EMAIL-05**: All emails sent via AWS SES; locally emulated by MiniStack (captured in logs)
- **FR-EMAIL-06**: Sender address: configurable via `SES_FROM_EMAIL` env var (default: `no-reply@pixicred.com`)
- **FR-EMAIL-07**: Payment-due reminder email: account holder's email; current balance, payment due date, days until due, minimum payment amount, and a note that the account will auto-close if unpaid 14 days after the due date
- **FR-EMAIL-08**: Auto-close email: account holder's email; confirms the account has been automatically closed due to non-payment, shows the final balance, and includes instructions to reapply for a new account
- **FR-EMAIL-09**: User-close confirmation email: account holder's email; confirms the account has been closed at their request and includes instructions to reapply
- **FR-EMAIL-10**: Application submitted acknowledgment email: applicant's email; includes confirmation code (applicationId) and link to check application status at `/apply/status`

### 2.8 Payment Due Schedule

- **FR-DUE-01**: Every `Account` has exactly one `PaymentDueSchedule` record, created atomically with the account. Fields: `accountId`, `paymentDueDate` (DATE), `satisfied` (BOOLEAN, default `false`), `satisfiedAt` (TIMESTAMPTZ, nullable), `createdAt`
- **FR-DUE-02**: `paymentDueDate` is the 25th of the month following account creation. Formula: if account is created in month M of year Y, `paymentDueDate = DATE(Y, M+1, 25)`, rolling into the next year if M = 12
- **FR-DUE-03**: `satisfied` is set to `true` — and `satisfiedAt` is stamped — when `currentBalance` reaches `0` as the result of a payment (FR-PAY-03)
- **FR-DUE-04**: `satisfied` is never reset back to `false` once `true`; it is a one-way flag representing that the opening balance obligation was met
- **FR-DUE-05**: The `paymentDueDate` on the `accounts` table is a denormalized copy of `PaymentDueSchedule.paymentDueDate` for convenient querying in account detail responses. Both must be kept in sync

### 2.9 Billing Lifecycle Jobs

- **FR-BILL-01**: A daily cron job runs at **08:00 UTC** via EventBridge. It enqueues a single message to the `billing-lifecycle` SQS queue with `{ "lookaheadDays": 7 }` by default
- **FR-BILL-02**: The billing lifecycle job accepts a `lookaheadDays` parameter (integer ≥ 1). When run via the scheduled cron, `lookaheadDays = 7`. When triggered manually via the service API endpoint, any value ≥ 1 is accepted
- **FR-BILL-03**: **Payment-due reminder sweep**: the job finds all `ACTIVE` or `SUSPENDED` accounts where `PaymentDueSchedule.satisfied = false` AND `paymentDueDate` is within the next `lookaheadDays` days (i.e. `paymentDueDate <= TODAY + lookaheadDays`). For each such account, a `PAYMENT_DUE_REMINDER` event is published to SNS — which fans out to the notification queue and triggers a reminder email (FR-EMAIL-07), subject to the account's `paymentRemindersEnabled` preference
- **FR-BILL-04**: **Auto-close sweep**: the job finds all `ACTIVE` or `SUSPENDED` accounts where `PaymentDueSchedule.satisfied = false` AND `paymentDueDate < TODAY - 14` (i.e. the due date was more than 14 days ago and still unpaid). For each such account: set `status = CLOSED`, `closeReason = AUTO_NONPAYMENT`, `closedAt = NOW()`, then publish an `ACCOUNT_AUTO_CLOSED` event which triggers the auto-close email (FR-EMAIL-08)
- **FR-BILL-05**: The two sweeps (reminder and auto-close) run in the same job execution, in order: auto-close first, then reminders. This ensures accounts closed in the auto-close sweep are not also sent a payment reminder in the same run
- **FR-BILL-06**: On-demand trigger endpoint: `POST /admin/billing-lifecycle` with optional body `{ "lookaheadDays": N }`. Enqueues a message to the `billing-lifecycle` SQS queue directly. Returns `202 Accepted` immediately; the job runs asynchronously via the same Lambda consumer
- **FR-BILL-07**: The billing lifecycle job is idempotent: running it multiple times on the same day does not send duplicate reminder emails. Idempotency is enforced by checking whether a reminder was already sent today for a given account (tracked via a `reminder_sent_date` column on `PaymentDueSchedule`)
- **FR-BILL-08**: Auto-close is also idempotent: once an account is `CLOSED`, it is excluded from future sweeps by the status filter (`ACTIVE` or `SUSPENDED` only)

### 2.10 Portal Authentication

- **FR-AUTH-01**: Account holders register a portal login using the `accountId` from their approval email, their email address, and a chosen password. Registration validates that the `accountId` exists, belongs to an `APPROVED` application, and has no existing portal account
- **FR-AUTH-02**: Portal login accepts `email` + `password`; returns a signed JWT (HS256) with payload `{ accountId, email, iat, exp }`
- **FR-AUTH-03**: JWT validity is **24 hours**; no refresh tokens (portfolio simplicity)
- **FR-AUTH-04**: All API routes scoped to an account (`/accounts/:accountId/**`) require a valid `Authorization: Bearer <jwt>` header whose encoded `accountId` matches the `:accountId` path parameter. Mismatch or missing token returns `FORBIDDEN` (403) or `UNAUTHORIZED` (401) respectively
- **FR-AUTH-05**: Public routes (no JWT required): `POST /applications`, `GET /applications/:applicationId`, `POST /auth/register`, `POST /auth/login`
- **FR-AUTH-06**: Portal credentials are stored in a separate `portal_accounts` table (see Section 7.1). Passwords are hashed with **bcrypt cost 12**; plaintext passwords are never stored or logged
- **FR-AUTH-07**: The approval email (FR-EMAIL-02) is updated to include the `accountId` labelled as the "Account Setup Code" and a direct link to `https://pixicred.com/setup`
- **FR-AUTH-08**: The JWT signing secret is stored in Secrets Manager alongside `DATABASE_URL` under the key `JWT_SECRET`; it is injected via environment variable and never hardcoded

### 2.11 Frontend Application (Angular SPA)

- **FR-FE-01**: **Welcome page** (`/`) — hero section with product name and tagline, Apply and Login call-to-action buttons, brief feature overview; public (no auth)
- **FR-FE-02**: **Apply page** (`/apply`) — credit card application form collecting `firstName`, `lastName`, `email`, `dateOfBirth`, `annualIncome`, `mockSsn`; on submit calls `POST /applications`; on success redirects to confirmation page with the returned `applicationId`
- **FR-FE-03**: **Application confirmation page** (`/apply/confirmation`) — displays the `applicationId` prominently as a "Confirmation Code"; instructs the user to save it and visit the status page to check their decision; links to `/apply/status`
- **FR-FE-04**: **Application status page** (`/apply/status`) — text input for the confirmation code (`applicationId`); calls `GET /applications/:applicationId`; renders status (`PENDING` / `APPROVED` / `DECLINED`) with appropriate messaging; on `APPROVED` prompts user to check email for the Account Setup Code and link to `/setup`; public route
- **FR-FE-05**: **Account setup page** (`/setup`) — form: email, Account Setup Code (the `accountId` from the approval email), password, confirm password; calls `POST /auth/register`; on success redirects to `/login` with a success notice
- **FR-FE-06**: **Login page** (`/login`) — email + password form; calls `POST /auth/login`; on success stores the JWT in `localStorage` and redirects to `/dashboard`
- **FR-FE-07**: **Account dashboard** (`/dashboard`) — displays credit limit, current balance, available credit, payment due date, balance satisfaction status; lists the 5 most recent transactions; quick-action links to Make Payment and View Statements; auth-required
- **FR-FE-08**: **Transactions page** (`/transactions`) — paginated list of all transactions showing type (CHARGE/PAYMENT), merchant name, amount, and date; calls `GET /accounts/:id/transactions` with cursor-based pagination; auth-required
- **FR-FE-09**: **Payments page** (`/payments`) — payment form with an amount field (number input or "Pay Full Balance" toggle which sets `amount = "FULL"`); calls `POST /accounts/:id/payments`; shows success confirmation with the resolved amount; auth-required
- **FR-FE-10**: **Statements page** (`/statements`) — list of statements sorted by period descending; clicking a statement shows its full detail view including transaction breakdown; on-demand generation via "Generate Statement" button calls `POST /accounts/:id/statements`; auth-required
- **FR-FE-11**: **Notification settings page** (`/settings/notifications`) — three toggle switches for transaction notifications, statement notifications, and payment reminder notifications; any change calls `PATCH /accounts/:id/notifications` immediately; auth-required
- **FR-FE-12**: **Account settings page** (`/settings/account`) — read-only display of account ID, credit limit, holder email, and creation date; "Close Account" button opens a confirmation modal before calling `DELETE /accounts/:accountId`; on success redirects to `/` with a farewell message; auth-required
- **FR-FE-13**: **Auth guard** — all routes under `/dashboard`, `/transactions`, `/payments`, `/statements`, `/settings/**` are protected; unauthenticated users are redirected to `/login`; JWT expiry is checked client-side on each navigation
- **FR-FE-14**: **Angular framework** — Angular 17+ with standalone components and the new control flow syntax; Angular Router for SPA navigation; Angular `HttpClient` with an auth interceptor that injects `Authorization: Bearer <jwt>` on all non-public requests; Angular Signals for reactive state management
- **FR-FE-15**: **Styling** — Tailwind CSS for all styling; custom PixiCred fintech design theme (navy/blue palette, Inter font, card-based layout); responsive targeting mobile and desktop; no external component library
- **FR-FE-16**: **Hosting** — `ng build --output-path dist/frontend` artifact deployed to S3 bucket `pixicred-{env}-frontend` with static website hosting; served via CloudFront distribution using the pre-provisioned ACM wildcard certificate; `pixicred.com` and `www.pixicred.com` Route 53 A-records alias to the CloudFront distribution
- **FR-FE-17**: **Local development** — `ng serve` at `http://localhost:4200`; API calls proxied to `http://localhost:3000` via Angular's `proxy.conf.json` to avoid CORS during development

---

## 3. Non-Functional Requirements

- **NFR-01 — Async credit checks**: Credit check processing must be async (SQS-backed). Application intake returns immediately with `PENDING` status.
- **NFR-02 — Idempotency**: All write operations on transactions and payments must be idempotent via client-supplied `idempotencyKey`.
- **NFR-03 — Cost efficiency**: Portfolio AWS deployment must incur near-zero cost at rest. No continuously running compute. All compute is Lambda-based.
- **NFR-04 — Testability**: Service layer is framework-agnostic and independently testable without invoking Lambda events or HTTP.
- **NFR-05 — Local dev parity**: MiniStack emulates SQS, SNS, SES, EventBridge. Full async flow exercisable locally.
- **NFR-06 — Environment isolation**: `dev` and `prod` coexist in a **shared AWS account** (`408141212087`) used across multiple portfolio projects. All PixiCred resources are prefixed `pixicred-{env}-*` and tagged `Project=pixicred` to logically separate them from other projects in the same account.
- **NFR-07 — Observability**: All Lambdas and the service layer emit structured JSON logs to CloudWatch. No silent failures.
- **NFR-08 — Security**: No secrets in code or committed env files. All secrets in Secrets Manager. IAM follows least-privilege.
- **NFR-09 — Service Layer Supremacy**: The service layer (`src/service/`) is the **single source of truth for all business logic**. API Gateway, API Lambdas, and SQS consumer Lambdas are infrastructure wiring only — they parse input, call the service layer, and return the result. They must never contain business rules, domain decisions, validation beyond input shape-checking, or side-effect logic. If it changes data, enforces a rule, or makes a domain decision, it belongs in `src/service/` — not in a Lambda handler.

---

## 4. System Architecture

### 4.1 Architecture Philosophy

The system divides into two tiers, with a hard boundary between them. This boundary is non-negotiable and is enforced at every layer of the project.

---

> **⚠ Service Layer Supremacy — Core Architectural Rule**
>
> `src/service/` is the **single source of truth for all business logic in this system.**
>
> API Gateway, API Lambdas, SQS consumer Lambdas, and EventBridge triggers are **infrastructure wiring only.** Their sole responsibilities are:
> - Parse and shape-validate the incoming event or request
> - Call the appropriate service layer action via `service.client.ts`
> - Return or forward the result
>
> They must **never** contain: domain rules, data validation beyond input shape, credit check logic, balance calculations, due date arithmetic, idempotency enforcement, status transition logic, email decisions, or any code that reads from or writes to the database.
>
> If you find yourself writing a conditional, a formula, or a DB query inside a Lambda handler — stop. That code belongs in `src/service/`.
>
> This rule exists to ensure the entire system is testable through a single interface, swappable between runtime targets (Lambda vs. container) without behavior changes, and comprehensible as a unified domain model regardless of how it is triggered.

---

**Tier 1 — Dispatch Layer (Lambda)**
Thin Lambda functions that handle protocol concerns: parsing API Gateway events or SQS message shapes, invoking the service layer, and forwarding responses. Contains **zero** business logic, domain rules, or data access.

**Tier 2 — Service Layer (`src/service/`)**
The authoritative home of all business logic: credit check decisions, balance updates, payment due date computation, idempotency enforcement, auto-close rules, email routing, and every other domain rule in the system. In AWS: deployed as a private Lambda invoked directly by Tier 1 Lambdas. In local development: runs as a Docker container exposing an HTTP API. Same code, different runtime target — the service layer is completely unaware of how it is being called.

### 4.2 Production Architecture (Real-World / Fully Funded)

> What this system would look like with proper capital and team support.

```
┌─────────────────────────────────────────────────────────────────┐
│                       CLIENT / INTERNET                          │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTPS
                ┌─────────▼──────────┐
                │   API Gateway v2   │ + WAF
                └─────────┬──────────┘
                          │ invoke
          ┌───────────────▼──────────────────┐
          │         API Lambdas              │
          │  (applications, accounts,        │
          │   transactions, payments,        │
          │   statements, notifications)     │
          └───────────────┬──────────────────┘
                          │ HTTP via ALB
                ┌─────────▼──────────┐
                │    ECS Fargate     │  Service Layer
                │    + ALB           │  Multi-AZ, auto-scaling
                └─────────┬──────────┘
                          │
          ┌───────────────┼──────────────────┐
          │               │                  │
    ┌─────▼──┐     ┌──────▼─┐        ┌──────▼─────┐
    │   RDS  │     │  SNS   │        │  Secrets   │
    │Postgres│     │ Topic  │        │  Manager   │
    │Multi-AZ│     └───┬────┘        └────────────┘
    └────────┘         │
              ┌────────┼────────┐
              │        │        │
         ┌────▼─┐  ┌───▼──┐  ┌─▼──────┐
         │ SQS  │  │ SQS  │  │  SQS   │
         │credit│  │notif │  │stmt-gen│
         └──┬───┘  └──┬───┘  └───┬────┘
            │         │          │
         ┌──▼───┐  ┌──▼───┐  ┌───▼────┐
         │Lambda│  │Lambda│  │ Lambda │
         │credit│  │notif │  │stmt-gen│
         │check │  │      │  │        │
         └──────┘  └──────┘  └────────┘

EventBridge Scheduler ──► SQS stmt-gen ──► Lambda stmt-gen
  (weekly: Mon 00:00 UTC | monthly: 1st 00:00 UTC)
```

**Why ECS in production**: ECS Fargate provides persistent always-warm compute behind an ALB with auto-scaling and multi-AZ resilience — appropriate when the service handles sustained traffic. Multi-AZ RDS provides automatic failover.

### 4.3 Portfolio Architecture (Cost-Optimized)

> What is actually deployed. Functionally identical. Cost: ~$0–5/month for compute.

```
┌─────────────────────────────────────────────────────────────────┐
│                       CLIENT / INTERNET                          │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTPS
                ┌─────────▼──────────┐
                │   API Gateway v2   │
                └─────────┬──────────┘
                          │ invoke
          ┌───────────────▼──────────────────┐
          │         API Lambdas              │
          └───────────────┬──────────────────┘
                          │ Lambda:InvokeFunction (SDK, private)
                ┌─────────▼──────────┐
                │  Service Lambda    │  Same service code as ECS
                │  (private, not     │  Cold start acceptable at
                │   API GW exposed)  │  portfolio traffic volumes
                └─────────┬──────────┘
                          │
          ┌───────────────┼──────────────────┐
          │               │                  │
    ┌─────▼──┐     ┌──────▼─┐        ┌──────▼─────┐
    │   RDS  │     │  SNS   │        │  Secrets   │
    │Postgres│     │ Topic  │        │  Manager   │
    │single- │     └───┬────┘        └────────────┘
    │AZ,     │         │
    │t4g.    │  ┌──────┼──────┐
    │micro   │  │      │      │
    └────────┘  │  ┌───▼──┐ ┌▼──────┐
           ┌────▼─┐│ SQS  │ │ SQS   │
           │ SQS  ││notif │ │stmt-  │
           │credit││      │ │gen    │
           └──┬───┘└──┬───┘ └───┬───┘
              │       │         │
           ┌──▼───┐ ┌─▼────┐ ┌──▼────┐
           │Lambda│ │Lambda│ │Lambda │
           │credit│ │notif │ │stmt-  │
           │check │ │      │ │gen    │
           └──────┘ └──────┘ └───────┘

EventBridge Scheduler ──► SQS stmt-gen ──► Lambda stmt-gen
```

**Portfolio trade-offs vs. production**:

| Concern | Production | Portfolio |
|---|---|---|
| Service layer | ECS Fargate + ALB | Private Lambda (direct invoke) |
| Database | RDS Multi-AZ | RDS Single-AZ, `db.t4g.micro` |
| WAF | Yes | No |
| Multi-AZ compute | Yes (ECS) | N/A (Lambda inherently multi-AZ) |
| Cost at rest | ~$275–375/month | ~$28–35/month (RDS dominant) |

### 4.4 Async Event Flow

```
POST /applications
  → [API Lambda] validates input
      → [Service Lambda] creates Application{PENDING}, publishes SNS{APPLICATION_SUBMITTED}
          → SQS credit-check-queue
              → [credit-check Lambda]
                  → [Service Lambda] runCreditCheck()
                      ├─ DECLINED → update Application, send decline email via SES
                      └─ APPROVED → update Application, create Account,
                                    create NotificationPreference, send approval email

POST /accounts/:id/transactions
  → [API Lambda]
      → [Service Lambda] postCharge() → creates Transaction, updates balance
          → publishes SNS{TRANSACTION_POSTED}
              → SQS notification-queue
                  → [notification Lambda]
                      → [Service Lambda] sendTransactionEmail() (if enabled)

EventBridge (weekly | monthly)
  → SQS statement-gen-queue
      → [statement-gen Lambda]
          → [Service Lambda] generateStatements()
              → creates Statement records
                  → publishes SNS{STATEMENT_GENERATED}
                      → SQS notification-queue
                          → [notification Lambda]
                              → [Service Lambda] sendStatementEmail() (if enabled)

EventBridge (daily 08:00 UTC) — OR — POST /admin/billing-lifecycle
  → SQS billing-lifecycle-queue
      → [billing-lifecycle Lambda]
          → [Service Lambda] runBillingLifecycle({ lookaheadDays })
              ├─ AUTO-CLOSE SWEEP: accounts where satisfied=false AND due_date < TODAY-14
              │     → closeAccount(AUTO_NONPAYMENT) → publishes SNS{ACCOUNT_AUTO_CLOSED}
              │           → SQS notification-queue → sendAutoCloseEmail()
              └─ REMINDER SWEEP: accounts where satisfied=false AND due_date <= TODAY+lookaheadDays
                    → (skip if reminder_sent_date = TODAY)
                    → publishes SNS{PAYMENT_DUE_REMINDER}
                          → SQS notification-queue → sendPaymentDueReminderEmail() (if enabled)

DELETE /accounts/:accountId
  → [API Lambda]
      → [Service Lambda] closeAccount(USER_REQUESTED)
          → publishes SNS{ACCOUNT_USER_CLOSED}
                → SQS notification-queue → sendUserCloseEmail()
```

### 4.5 Local Development Architecture

```
HTTP Client
  → Express server (:3000)          ← mirrors API Lambda domains
      → Service layer (direct call) ← no Lambda invoke overhead
          ├─ Postgres (:5432)
          └─ MiniStack (:4566)       ← SQS, SNS, SES

Local worker (worker.ts)
  → polls MiniStack SQS queues
  → invokes service layer handlers directly
```

---

## 5. AWS Infrastructure & Resources

### 5.1 Resource Naming Convention

`pixicred-{env}-{descriptor}` — e.g.:
- `pixicred-dev-lambda-service`
- `pixicred-prod-sqs-credit-check`
- `pixicred-dev-rds`

### 5.2 Standard Tags

```hcl
tags = {
  Project     = "pixicred"
  Environment = var.environment   # "dev" | "prod"
  ManagedBy   = "terraform"
}
```

### 5.3 AWS Services Used

| Service | Resource | Purpose |
|---|---|---|
| **API Gateway v2** | HTTP API | Public REST API |
| **Lambda** | api-applications | Dispatch: applications routes |
| **Lambda** | api-accounts | Dispatch: accounts routes |
| **Lambda** | api-transactions | Dispatch: transactions routes |
| **Lambda** | api-payments | Dispatch: payments routes |
| **Lambda** | api-statements | Dispatch: statements routes |
| **Lambda** | api-notifications | Dispatch: notification prefs routes |
| **Lambda** | service (private) | Service layer — all business logic |
| **Lambda** | credit-check | SQS consumer: runs credit checks |
| **Lambda** | notification | SQS consumer: sends emails |
| **Lambda** | statement-gen | SQS consumer: generates statements |
| **Lambda** | billing-lifecycle | SQS consumer: runs daily billing lifecycle (reminders + auto-close) |
| **SQS** | credit-check-queue + DLQ | Async credit check jobs |
| **SQS** | notification-queue + DLQ | Async email delivery |
| **SQS** | statement-gen-queue + DLQ | Scheduled + on-demand statement jobs |
| **SQS** | billing-lifecycle-queue + DLQ | Daily cron + on-demand billing lifecycle jobs |
| **SNS** | events topic | Fan-out from service layer |
| **RDS (Postgres)** | pixicred-{env}-rds | Persistent data store |
| **SES** | no-reply@pixicred.com | Transactional email |
| **EventBridge** | weekly-stmt + monthly-stmt | Statement generation schedules |
| **EventBridge** | daily-billing-lifecycle | Daily 08:00 UTC billing lifecycle trigger |
| **Secrets Manager** | pixicred-{env}-secrets | DB credentials + JWT signing secret |
| **CloudWatch Logs** | per-Lambda log groups | Structured logs, 14-day retention |
| **S3** | pixicred-{env}-tf-state | Terraform remote state |
| **S3** | pixicred-{env}-frontend | Angular SPA static asset hosting |
| **CloudFront** | pixicred-{env}-cdn | CDN for frontend; terminates TLS with ACM wildcard cert |
| **ACM** | `*.pixicred.com` (dev cert) | Pre-provisioned; ARN: `arn:aws:acm:us-east-1:408141212087:certificate/09299ef4-d8c9-4e84-b0d1-442dc3ef91ad` |
| **ACM** | `*.pixicred.com` (prod cert) | Pre-provisioned; ARN: `arn:aws:acm:us-east-1:408141212087:certificate/856c4408-d285-4df3-b694-65d4aef299ba` |
| **Route 53** | `pixicred.com.` | Hosted zone `Z0511624US25VOVRIJF3`; A-records for apex + www → CloudFront; A-records for api.* → API Gateway |
| **DynamoDB** | pixicred-{env}-tf-locks | Terraform state locking |

### 5.4 Lambda Configuration

| Lambda | Memory | Timeout | Trigger |
|---|---|---|---|
| api-* (×6) | 256 MB | 30s | API Gateway |
| service (private) | 512 MB | 60s | Direct invoke |
| credit-check | 256 MB | 60s | SQS |
| notification | 256 MB | 60s | SQS |
| statement-gen | 512 MB | 300s | SQS |
| billing-lifecycle | 256 MB | 120s | SQS |

### 5.5 SQS Queue Configuration

| Queue | Visibility Timeout | Max Receive Count | DLQ |
|---|---|---|---|
| credit-check | 120s | 3 | credit-check-dlq |
| notification | 120s | 3 | notification-dlq |
| statement-gen | 600s | 2 | statement-gen-dlq |
| billing-lifecycle | 180s | 2 | billing-lifecycle-dlq |

### 5.6 RDS Configuration

| Setting | Portfolio | Production (ideal) |
|---|---|---|
| Instance class | `db.t4g.micro` | `db.r6g.large` |
| Multi-AZ | No | Yes |
| Storage | 20 GB gp3 | 100 GB gp3 autoscaling |
| Backup retention | 7 days | 30 days |
| Engine | Postgres 15 | Postgres 15 |
| IAM authentication | Enabled | Enabled |

### 5.7a Database Users

RDS IAM database authentication is enabled. Two PostgreSQL users are created post-Terraform (see Phase 8 post-apply steps):

| User | Auth method | Privileges | Used by |
|---|---|---|---|
| `pixicred_app` | IAM token (no password) | `SELECT`, `INSERT`, `UPDATE`, `DELETE` on all application tables | Service Lambda at runtime |
| `migrations-db-user` | Password (Secrets Manager) | Full DDL + DML on `pixicred` database | `migrate.yml` CI/CD workflow only |

`pixicred_app` is granted the `rds_iam` role in PostgreSQL. The service Lambda's execution role has `rds-db:connect` on this user. The `@aws-sdk/rds-signer` package generates a 15-minute auth token at cold start; that token is used as the password in the Prisma `DATABASE_URL`.

`migrations-db-user`'s password is managed by Secrets Manager (key `MIGRATIONS_DATABASE_URL` in `pixicred-{env}-secrets`). It is never used by the application at runtime — only by the migration workflow.

### 5.7 IAM Roles — Least Privilege Summary

Each Lambda has a dedicated execution role. No role is shared across functions.

| Lambda | Key Permissions |
|---|---|
| api-* (including api-auth) | `lambda:InvokeFunction` on service Lambda ARN only |
| service | `ses:SendEmail`, `sns:Publish`, `secretsmanager:GetSecretValue`, `rds-db:connect` (scoped to `pixicred_app` on the env RDS instance) |
| credit-check | `sqs:ReceiveMessage/DeleteMessage`, `lambda:InvokeFunction` on service Lambda |
| notification | `sqs:ReceiveMessage/DeleteMessage`, `lambda:InvokeFunction` on service Lambda |
| statement-gen | `sqs:ReceiveMessage/DeleteMessage`, `lambda:InvokeFunction` on service Lambda |
| billing-lifecycle | `sqs:ReceiveMessage/DeleteMessage`, `lambda:InvokeFunction` on service Lambda |

---

## 6. Software Design

### 6.1 Repository Structure

```
pixicred/
├── prisma/
│   ├── schema.prisma                   # Prisma schema — single source of DB truth
│   └── migrations/                     # Prisma-generated migration files
├── src/
│   ├── service/                        # All business logic — framework-agnostic
│   │   ├── application.service.ts
│   │   ├── account.service.ts
│   │   ├── auth.service.ts             # portal registration + JWT login
│   │   ├── transaction.service.ts
│   │   ├── payment.service.ts
│   │   ├── statement.service.ts
│   │   ├── notification.service.ts
│   │   └── billing-lifecycle.service.ts
│   ├── db/
│   │   ├── client.ts                   # PrismaClient initialisation
│   │   └── queries/                    # Typed query functions per domain (Prisma-based)
│   │       ├── application.queries.ts
│   │       ├── account.queries.ts
│   │       ├── auth.queries.ts         # portal_accounts queries
│   │       ├── payment-due-schedule.queries.ts
│   │       ├── transaction.queries.ts
│   │       ├── statement.queries.ts
│   │       └── notification.queries.ts
│   ├── handlers/
│   │   ├── api/                        # API Lambda handlers (thin dispatch)
│   │   │   ├── applications.handler.ts
│   │   │   ├── accounts.handler.ts
│   │   │   ├── auth.handler.ts         # POST /auth/register, POST /auth/login
│   │   │   ├── transactions.handler.ts
│   │   │   ├── payments.handler.ts
│   │   │   ├── statements.handler.ts
│   │   │   └── notifications.handler.ts
│   │   ├── sqs/                        # SQS Lambda handlers
│   │   │   ├── credit-check.handler.ts
│   │   │   ├── notification.handler.ts
│   │   │   ├── statement-gen.handler.ts
│   │   │   └── billing-lifecycle.handler.ts
│   │   └── service/
│   │       └── service.handler.ts      # Service Lambda entry point (routes actions)
│   ├── clients/
│   │   ├── service.client.ts           # Invokes service Lambda or local HTTP
│   │   ├── ses.client.ts
│   │   ├── sns.client.ts
│   │   └── sqs.client.ts
│   ├── emails/
│   │   ├── templates/                  # Handlebars HTML templates (.hbs)
│   │   │   ├── decline.hbs
│   │   │   ├── approval.hbs            # updated: includes accountId as setup code
│   │   │   ├── transaction.hbs
│   │   │   ├── statement.hbs
│   │   │   ├── payment-due-reminder.hbs
│   │   │   ├── auto-close.hbs
│   │   │   └── user-close.hbs
│   │   ├── decline.template.ts
│   │   ├── approval.template.ts
│   │   ├── transaction.template.ts
│   │   ├── statement.template.ts
│   │   ├── payment-due-reminder.template.ts
│   │   ├── auto-close.template.ts
│   │   └── user-close.template.ts
│   └── types/
│       └── index.ts
├── local/
│   ├── api-server.ts                   # Express server (local API adapter)
│   ├── service-server.ts               # Express server (local service layer)
│   └── worker.ts                       # Local SQS poller
├── frontend/                           # Angular SPA
│   ├── src/
│   │   ├── app/
│   │   │   ├── pages/
│   │   │   │   ├── welcome/
│   │   │   │   ├── apply/
│   │   │   │   ├── apply-confirmation/
│   │   │   │   ├── apply-status/
│   │   │   │   ├── setup/
│   │   │   │   ├── login/
│   │   │   │   ├── dashboard/
│   │   │   │   ├── transactions/
│   │   │   │   ├── payments/
│   │   │   │   ├── statements/
│   │   │   │   └── settings/
│   │   │   │       ├── account/
│   │   │   │       └── notifications/
│   │   │   ├── services/
│   │   │   │   ├── api.service.ts      # base HTTP client wrapper
│   │   │   │   ├── auth.service.ts     # JWT storage + login/register calls
│   │   │   │   └── account.service.ts  # account/txn/payment/statement calls
│   │   │   ├── guards/
│   │   │   │   └── auth.guard.ts       # redirects unauthenticated users to /login
│   │   │   ├── interceptors/
│   │   │   │   └── auth.interceptor.ts # injects Bearer token on non-public routes
│   │   │   └── app.routes.ts
│   │   ├── environments/
│   │   │   ├── environment.ts          # apiUrl: 'http://localhost:3000'
│   │   │   └── environment.prod.ts     # apiUrl: 'https://api.pixicred.com'
│   │   └── proxy.conf.json             # proxies /api/** → localhost:3000 for ng serve
│   ├── angular.json
│   ├── package.json
│   └── tsconfig.json
├── infra/
│   ├── terraform/
│   │   ├── modules/
│   │   │   ├── lambda/                 # Reusable Lambda module
│   │   │   ├── sqs/                    # SQS + DLQ module
│   │   │   ├── rds/                    # RDS Postgres module
│   │   │   ├── api-gateway/            # API Gateway v2 module
│   │   │   └── frontend/               # S3 + CloudFront + Route 53 records module
│   │   ├── envs/
│   │   │   ├── dev/
│   │   │   └── prod/
│   │   └── bootstrap/                  # Remote state S3 + DynamoDB
│   └── ministack/
│       └── init.sh                     # Creates local AWS resources in MiniStack
├── specs/                              # Feature specs
├── scripts/
│   ├── build.sh
│   ├── deploy.sh
│   └── seed-local.ts
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── PROJECT.md
├── CLAUDE.md
└── tsconfig.json
```

### 6.2 Service Layer Internal RPC Contract

The service Lambda is the **only place in the codebase that implements business logic.** Every action in the contract below corresponds to a complete, self-contained service operation — the caller provides inputs, the service layer handles all domain rules, DB access, side effects, and error conditions, and returns a typed result.

A Lambda handler's implementation for any route should be reducible to three lines:
1. Extract and shape-validate the input from the event
2. Call `serviceClient.invoke({ action, payload })`
3. Return the result as an HTTP response or acknowledge the SQS message

Anything beyond those three responsibilities is a violation of the service layer supremacy rule (NFR-09).

The service Lambda receives a typed action payload and returns a typed result:

```typescript
type ServiceAction =
  // Auth
  | { action: 'registerPortalAccount';        payload: { email: string; accountId: string; password: string } }
  | { action: 'loginPortalAccount';           payload: { email: string; password: string } }
  // Applications
  | { action: 'submitApplication';            payload: SubmitApplicationInput }
  | { action: 'getApplication';               payload: { applicationId: string } }
  | { action: 'runCreditCheck';               payload: { applicationId: string } }
  // Accounts
  | { action: 'getAccount';                   payload: { accountId: string } }
  | { action: 'closeAccount';                 payload: { accountId: string; reason: 'USER_REQUESTED' | 'AUTO_NONPAYMENT' } }
  // Transactions
  | { action: 'postCharge';                   payload: PostChargeInput }
  | { action: 'getTransactions';              payload: GetTransactionsInput }
  // Payments
  | { action: 'postPayment';                  payload: PostPaymentInput }
  // Statements
  | { action: 'generateStatement';            payload: { accountId: string } }
  | { action: 'generateAllStatements';        payload: { period: 'weekly' | 'monthly' } }
  | { action: 'getStatements';                payload: { accountId: string } }
  | { action: 'getStatement';                 payload: { accountId: string; statementId: string } }
  // Notifications
  | { action: 'getNotificationPreferences';   payload: { accountId: string } }
  | { action: 'updateNotificationPreferences';payload: UpdateNotificationPrefsInput }
  // Emails
  | { action: 'sendDeclineEmail';             payload: { applicationId: string } }
  | { action: 'sendApprovalEmail';            payload: { applicationId: string } }
  | { action: 'sendTransactionEmail';         payload: { transactionId: string } }
  | { action: 'sendStatementEmail';           payload: { statementId: string } }
  | { action: 'sendPaymentDueReminderEmail';  payload: { accountId: string } }
  | { action: 'sendAutoCloseEmail';           payload: { accountId: string } }
  | { action: 'sendUserCloseEmail';           payload: { accountId: string } }
  // Billing lifecycle
  | { action: 'runBillingLifecycle';          payload: { lookaheadDays: number } }
```

### 6.3 Tech Stack

| Layer | Technology |
|---|---|
| Language (backend) | TypeScript (Node.js 20) |
| ORM / Database driver | Prisma ORM (`prisma`, `@prisma/client`) |
| DB migrations | `prisma migrate` (schema-first; migration files in `prisma/migrations/`) |
| Auth | `jsonwebtoken` (HS256 JWT signing/verification) + `bcrypt` (password hashing, cost 12) |
| Email rendering | `handlebars` (HTML `.hbs` templates in `src/emails/templates/`) |
| Email delivery | AWS SES SDK v3 |
| AWS SDK | `@aws-sdk/client-lambda`, `@aws-sdk/client-sqs`, `@aws-sdk/client-sns`, `@aws-sdk/client-ses`, `@aws-sdk/client-secrets-manager`, `@aws-sdk/rds-signer` |
| Local API server | `express` |
| Build (backend) | `esbuild` (bundle per Lambda; `.hbs` files inlined via text loader) |
| Testing | `vitest` + `@testcontainers/postgresql` |
| Local AWS emulation | MiniStack (`ministackorg/ministack`) |
| IaC | Terraform |
| CI/CD | GitHub Actions |
| **Frontend framework** | **Angular 17+ (standalone components, new control flow syntax)** |
| Frontend routing | Angular Router |
| Frontend HTTP | Angular `HttpClient` + auth interceptor |
| Frontend state | Angular Signals |
| Frontend UI library | Tailwind CSS (custom PixiCred fintech theme) |
| Frontend build | `ng build` → `dist/frontend/` |
| Frontend hosting (AWS) | S3 + CloudFront (pre-provisioned ACM wildcard cert) |
| Frontend local dev | `ng serve` at `:4200` with proxy to `:3000` |

---

## 7. Data Model

### 7.1 Schema

#### `applications`
```sql
CREATE TABLE applications (
  application_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email            TEXT NOT NULL,
  first_name       TEXT NOT NULL,
  last_name        TEXT NOT NULL,
  date_of_birth    DATE NOT NULL,
  annual_income    NUMERIC(12,2) NOT NULL,
  mock_ssn         CHAR(5) NOT NULL,
  status           TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | APPROVED | DECLINED
  credit_limit     NUMERIC(10,2),                    -- set on APPROVED
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at       TIMESTAMPTZ
);
CREATE INDEX idx_applications_email  ON applications(email);
CREATE INDEX idx_applications_status ON applications(status);
```

#### `accounts`
```sql
CREATE TABLE accounts (
  account_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id    UUID NOT NULL REFERENCES applications(application_id),
  holder_email      TEXT NOT NULL,
  credit_limit      NUMERIC(10,2) NOT NULL,
  current_balance   NUMERIC(10,2) NOT NULL DEFAULT 500.00,  -- opening balance: $500
  status            TEXT NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE | SUSPENDED | CLOSED
  payment_due_date  DATE NOT NULL,   -- denormalized from payment_due_schedules; 25th of next month
  close_reason      TEXT,            -- USER_REQUESTED | AUTO_NONPAYMENT (null until closed)
  closed_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_accounts_application  ON accounts(application_id);
CREATE INDEX idx_accounts_holder_email        ON accounts(holder_email);
CREATE INDEX idx_accounts_status              ON accounts(status);
CREATE INDEX idx_accounts_payment_due_date    ON accounts(payment_due_date);
```

#### `payment_due_schedules`
```sql
CREATE TABLE payment_due_schedules (
  account_id          UUID PRIMARY KEY REFERENCES accounts(account_id),
  payment_due_date    DATE NOT NULL,          -- 25th of next month from account creation
  satisfied           BOOLEAN NOT NULL DEFAULT FALSE,
  satisfied_at        TIMESTAMPTZ,            -- stamped when currentBalance reaches 0
  reminder_sent_date  DATE,                   -- date of last reminder email sent (idempotency)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pds_due_date    ON payment_due_schedules(payment_due_date);
CREATE INDEX idx_pds_satisfied   ON payment_due_schedules(satisfied);
```

#### `transactions`
```sql
CREATE TABLE transactions (
  transaction_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID NOT NULL REFERENCES accounts(account_id),
  type             TEXT NOT NULL,        -- CHARGE | PAYMENT
  merchant_name    TEXT,                 -- null for PAYMENT type
  amount           NUMERIC(10,2) NOT NULL,
  idempotency_key  TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_transactions_account_id ON transactions(account_id);
CREATE UNIQUE INDEX idx_transactions_idempotency ON transactions(account_id, idempotency_key);
```

#### `statements`
```sql
CREATE TABLE statements (
  statement_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           UUID NOT NULL REFERENCES accounts(account_id),
  period_start         TIMESTAMPTZ NOT NULL,
  period_end           TIMESTAMPTZ NOT NULL,
  opening_balance      NUMERIC(10,2) NOT NULL,
  closing_balance      NUMERIC(10,2) NOT NULL,
  total_charges        NUMERIC(10,2) NOT NULL,
  total_payments       NUMERIC(10,2) NOT NULL,
  minimum_payment_due  NUMERIC(10,2) NOT NULL,
  due_date             DATE NOT NULL,
  generated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_statements_account_id ON statements(account_id);
CREATE UNIQUE INDEX idx_statements_period ON statements(account_id, period_start, period_end);
```

#### `notification_preferences`
```sql
CREATE TABLE notification_preferences (
  account_id                UUID PRIMARY KEY REFERENCES accounts(account_id),
  transactions_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  statements_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  payment_reminders_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### `portal_accounts`
```sql
-- One portal credential per account holder; created at registration (FR-AUTH-01)
CREATE TABLE portal_accounts (
  account_id     UUID PRIMARY KEY REFERENCES accounts(account_id),
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,        -- bcrypt, cost 12
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_portal_accounts_email ON portal_accounts(email);
```

---

## 8. API Documentation

### 8.1 Base URLs

| Environment | API URL | Web App URL |
|---|---|---|
| Local | `http://localhost:3000` | `http://localhost:4200` |
| Dev | `https://api.dev.pixicred.com` | `https://dev.pixicred.com` |
| Prod | `https://api.pixicred.com` | `https://pixicred.com` |

### 8.2 Response Envelope

```typescript
// Success
{ "data": { ... } }

// Error
{ "error": { "code": "ERROR_CODE", "message": "Human-readable message" } }
```

### 8.3 Endpoints

> Routes marked **🔒 JWT required** validate the `Authorization: Bearer <token>` header. The API Lambda handler decodes the JWT, extracts `accountId`, and confirms it matches the `:accountId` path parameter before calling the service layer. Missing or expired token → 401. Valid token with wrong accountId → 403.

#### Authentication (public — no JWT)
| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/register` | Create portal account; body: `{ email, accountId, password }` |
| `POST` | `/auth/login` | Login; body: `{ email, password }`; returns `{ token, accountId }` |

#### Applications (public — no JWT)
| Method | Path | Description |
|---|---|---|
| `POST` | `/applications` | Submit application (async, returns PENDING) |
| `GET` | `/applications/:applicationId` | Get application status |

#### Accounts 🔒 JWT required
| Method | Path | Description |
|---|---|---|
| `GET` | `/accounts/:accountId` | Get account details + balance |
| `DELETE` | `/accounts/:accountId` | Close account (user-requested) |

#### Transactions 🔒 JWT required
| Method | Path | Description |
|---|---|---|
| `POST` | `/accounts/:accountId/transactions` | Post mock charge |
| `GET` | `/accounts/:accountId/transactions` | List transactions (paginated) |

#### Payments 🔒 JWT required
| Method | Path | Description |
|---|---|---|
| `POST` | `/accounts/:accountId/payments` | Post payment (`amount`: number or `"FULL"`) |

#### Statements 🔒 JWT required
| Method | Path | Description |
|---|---|---|
| `GET` | `/accounts/:accountId/statements` | List statements |
| `GET` | `/accounts/:accountId/statements/:statementId` | Get statement detail |
| `POST` | `/accounts/:accountId/statements` | Generate on-demand statement |

#### Notifications 🔒 JWT required
| Method | Path | Description |
|---|---|---|
| `GET` | `/accounts/:accountId/notifications` | Get notification preferences |
| `PATCH` | `/accounts/:accountId/notifications` | Update notification preferences (`transactionsEnabled`, `statementsEnabled`, `paymentRemindersEnabled`) |

#### Admin / Ops
| Method | Path | Description |
|---|---|---|
| `POST` | `/admin/billing-lifecycle` | Trigger billing lifecycle job on-demand (optional body: `{ "lookaheadDays": N }`) |

### 8.4 Error Codes

| Code | HTTP Status | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Input failed validation |
| `DUPLICATE_APPLICATION` | 409 | Active application already exists for email |
| `APPLICATION_NOT_FOUND` | 404 | No application with given ID |
| `ACCOUNT_NOT_FOUND` | 404 | No account with given ID |
| `ACCOUNT_NOT_ACTIVE` | 422 | Account is SUSPENDED or CLOSED |
| `INSUFFICIENT_CREDIT` | 422 | Charge exceeds available credit |
| `PAYMENT_EXCEEDS_BALANCE` | 422 | Payment exceeds current balance |
| `STATEMENT_NOT_FOUND` | 404 | No statement with given ID |
| `ACCOUNT_ALREADY_CLOSED` | 422 | Account is already CLOSED; cannot close again |
| `UNAUTHORIZED` | 401 | Missing or expired JWT |
| `FORBIDDEN` | 403 | Valid JWT but accountId mismatch |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password on login |
| `PORTAL_ACCOUNT_EXISTS` | 409 | Portal account already registered for this accountId |
| `PORTAL_ACCOUNT_NOT_ELIGIBLE` | 422 | Account's application is not APPROVED; cannot register portal access |
| `INTERNAL_ERROR` | 500 | Unhandled server error |

---

## 9. DevOps & Deployment

### 9.1 Environments

| Environment | Purpose | Compute |
|---|---|---|
| `local` | Dev workstation | Docker + MiniStack |
| `dev` | AWS testing | Lambda (serverless) |
| `prod` | AWS portfolio | Lambda (serverless) |

Both `dev` and `prod` deploy to shared AWS account `408141212087`. Resources from all portfolio projects coexist in this account; PixiCred resources are isolated by the `pixicred-{env}-` name prefix and `Project=pixicred` tag.

### 9.2 CI/CD (GitHub Actions)

```
push to main
  → lint + typecheck (backend)
  → ng lint + ng build (frontend)
  → unit tests
  → esbuild bundles (backend)
  → terraform plan (dev)
  → terraform apply (dev)          [auto — deploys backend + frontend to dev]
  → prisma migrate deploy (dev)    [auto, dedicated migrate.yml workflow]
  → integration tests (dev)
  → manual approval
  → prisma migrate deploy (prod)
  → terraform apply (prod)         [deploys backend + frontend to prod]
```

Frontend assets are uploaded to `pixicred-{env}-frontend` S3 and a CloudFront invalidation is triggered as part of `terraform apply` (or a dedicated `deploy-frontend.yml` workflow step).

A dedicated `.github/workflows/migrate.yml` workflow handles `prisma migrate deploy` against each environment. It triggers on pushes to `main` when `prisma/migrations/**` or `prisma/schema.prisma` changes, or on manual dispatch (`workflow_dispatch`). The workflow fetches `MIGRATIONS_DATABASE_URL` from `pixicred-{env}-secrets` in Secrets Manager and runs `prisma migrate deploy` as `migrations-db-user` (password-based; IAM auth is not used for migrations). After each successful run the `prisma/migrations/` directory is synced to the `pixicred-{env}-migrations` S3 bucket as an audit trail.

### 9.3 Terraform Remote State Bootstrap

Before provisioning any environment, bootstrap remote state once:

```bash
cd infra/terraform/bootstrap
terraform init && terraform apply
# Creates: S3 bucket + DynamoDB table per environment
```

### 9.4 Terraform Module Assessment

**Assessed repo**: `ryanwaite28/ai-projects-aws-infrastructure-provisioning`

The repo targets ECS/ALB/VPC-heavy production infrastructure — architecturally misaligned with this project's serverless Lambda + RDS stack. Adopting it would require stripping most of the module surface and fighting ECS/ALB assumptions throughout.

**Decision**: Write purpose-built Terraform modules scoped to this project's exact needs. The modules (`infra/terraform/modules/lambda`, `sqs`, `rds`, `api-gateway`) are simpler, directly reflect this architecture, and serve as better portfolio artifacts.

### 9.5 Build

```bash
npm run build     # esbuild bundles each Lambda into dist/lambdas/{name}/
npm run test      # vitest unit tests
npm run deploy:dev   # terraform apply envs/dev
npm run deploy:prod  # terraform apply envs/prod (requires manual approval)
```

---

## 10. Local Development

### 10.1 Prerequisites

- Docker + Docker Compose
- Node.js 20+
- AWS CLI (any credentials — MiniStack ignores real values)

### 10.2 Starting the Stack

```bash
docker-compose up -d
# Starts: postgres:5432, ministack:4566, service:3001, api:3000, worker
npm run db:migrate    # prisma migrate deploy against local postgres
npm run seed:local    # optional: seed test data
```

### 10.3 docker-compose.yml (summary)

```yaml
services:
  postgres:
    image: postgres:15
    ports: ["5432:5432"]
    environment:
      POSTGRES_DB: pixicred
      POSTGRES_USER: pixicred
      POSTGRES_PASSWORD: pixicred_local

  ministack:
    image: ministackorg/ministack:latest
    ports: ["4566:4566"]

  ministack-init:
    image: amazon/aws-cli
    entrypoint: ["/bin/sh", "/scripts/init.sh"]
    volumes: ["./infra/ministack:/scripts"]
    depends_on: [ministack]

  service:
    build: .
    command: node dist/local/service-server.js
    ports: ["3001:3001"]
    depends_on: [postgres, ministack-init]

  api:
    build: .
    command: node dist/local/api-server.js
    ports: ["3000:3000"]
    depends_on: [service]

  worker:
    build: .
    command: node dist/local/worker.js
    depends_on: [service, ministack-init]
```

### 10.4 Environment Variables (`.env.example`)

```bash
ENVIRONMENT=local
# Local only: plain password connection used by the service layer + prisma migrate locally.
# In non-local environments, DB_HOST/DB_PORT/DB_NAME/DB_IAM_USER are fetched from Secrets Manager
# and an IAM auth token is generated at runtime via @aws-sdk/rds-signer.
DATABASE_URL=postgresql://pixicred:pixicred_local@localhost:5432/pixicred
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
AWS_ENDPOINT_URL=http://localhost:4566
SERVICE_ENDPOINT=http://localhost:3001
SES_FROM_EMAIL=no-reply@pixicred.com
CREDIT_CHECK_QUEUE_URL=http://localhost:4566/000000000000/pixicred-local-credit-check
NOTIFICATION_QUEUE_URL=http://localhost:4566/000000000000/pixicred-local-notifications
STATEMENT_GEN_QUEUE_URL=http://localhost:4566/000000000000/pixicred-local-statement-gen
SNS_TOPIC_ARN=arn:aws:sns:us-east-1:000000000000:pixicred-local-events
```

### 10.5 Testing the Async Flow Locally

```bash
# Submit application (will trigger full credit check flow via local worker)
curl -X POST http://localhost:3000/applications \
  -H "Content-Type: application/json" \
  -d '{"firstName":"Jane","lastName":"Doe","email":"jane@example.com",
       "dateOfBirth":"1990-01-15","annualIncome":75000,"mockSsn":"12345"}'

# Check application status
curl http://localhost:3000/applications/{applicationId}

# Inspect emails sent locally
curl http://localhost:4566/_ministack/ses/messages

# Post a mock charge (after approval)
curl -X POST http://localhost:3000/accounts/{accountId}/transactions \
  -H "Content-Type: application/json" \
  -d '{"merchantName":"Amazon","amount":49.99,"idempotencyKey":"test-key-001"}'
```

---

## 11. Implementation Plan

Work backwards from a fully operational system.

### Phase 0 — Project Scaffold
- [ ] Repo init: TypeScript, ESLint, Prettier, `tsconfig.json`
- [ ] `docker-compose.yml` (Postgres + MiniStack)
- [ ] Prisma schema setup (`prisma init`, `prisma/schema.prisma` with all models)
- [ ] Terraform bootstrap (S3 + DynamoDB for remote state)
- [ ] `.env.example`, `CLAUDE.md`, `PROJECT.md` committed
- [ ] GitHub Actions CI skeleton (lint + typecheck)

### Phase 1 — Data Model & Service Layer Foundation
- [ ] Prisma schema: all models matching Section 7.1, including `PaymentDueSchedule`
- [ ] `prisma migrate dev` produces initial migration; `prisma migrate deploy` used in CI
- [ ] Typed query functions per domain (Prisma-based)
- [ ] Service layer skeleton (all actions wired, no-op implementations)
- [ ] Service Lambda handler + local service-server.ts
- [ ] Unit tests: service functions (Vitest + Testcontainers)

### Phase 2 — Application & Underwriting
- [ ] `application.service.ts`: `submitApplication`, `getApplication`, `runCreditCheck`
- [ ] Mock SSN credit check logic
- [ ] Email templates: decline, approval (includes opening balance + first due date per FR-EMAIL-02)
- [ ] SNS publish on `APPLICATION_SUBMITTED`
- [ ] `credit-check` SQS Lambda handler
- [ ] Integration test: full apply → credit check → decision
- [ ] Terraform: SNS + SQS credit-check + credit-check Lambda

### Phase 3 — Accounts & Transactions
- [ ] `account.service.ts`: `getAccount`, `closeAccount` (USER_REQUESTED)
- [ ] Account creation sets `currentBalance = 500`, computes `paymentDueDate` (FR-ACC-06/07)
- [ ] `PaymentDueSchedule` created atomically with account (FR-DUE-01)
- [ ] `transaction.service.ts`: `postCharge`, `getTransactions`
- [ ] Idempotency enforcement
- [ ] SNS publish on `TRANSACTION_POSTED`, `ACCOUNT_USER_CLOSED`
- [ ] Integration tests: account creation balance/due date, user close + reapplication
- [ ] Terraform: accounts + transactions API Lambdas (including DELETE route)

### Phase 4 — Payments
- [ ] `payment.service.ts`: `postPayment` (with `amount = "FULL"` support per FR-PAY-01/07)
- [ ] Balance satisfaction logic: set `PaymentDueSchedule.satisfied = true` when `currentBalance` reaches 0 (FR-PAY-03)
- [ ] Idempotency enforcement
- [ ] Integration tests: partial pay, pay-full, balance satisfaction, idempotency
- [ ] Terraform: payments API Lambda

### Phase 4.5 — Billing Lifecycle Jobs
- [ ] `billing-lifecycle.service.ts`: `runBillingLifecycle({ lookaheadDays })`
- [ ] Auto-close sweep: query unpaid accounts 14+ days past due, close them (FR-BILL-04)
- [ ] Reminder sweep: query accounts due within `lookaheadDays`, skip if already reminded today (FR-BILL-03/07)
- [ ] Email templates: payment-due reminder, auto-close, user-close (FR-EMAIL-07/08/09)
- [ ] Notification SQS consumer: handle `PAYMENT_DUE_REMINDER`, `ACCOUNT_AUTO_CLOSED`, `ACCOUNT_USER_CLOSED` events
- [ ] `billing-lifecycle` SQS Lambda handler
- [ ] EventBridge daily cron at 08:00 UTC (FR-BILL-01)
- [ ] `POST /admin/billing-lifecycle` API endpoint + Lambda handler (FR-BILL-06)
- [ ] Integration tests: reminder idempotency, auto-close trigger, manual trigger endpoint
- [ ] Terraform: billing-lifecycle SQS + Lambda + EventBridge rule

### Phase 5 — Statements
- [ ] `statement.service.ts`: `generateStatement`, `generateAllStatements`, `getStatements`, `getStatement`
- [ ] Statement idempotency
- [ ] EventBridge scheduled rules
- [ ] Statement-gen SQS Lambda handler
- [ ] Terraform: EventBridge + SQS + Lambda

### Phase 6 — Notifications
- [ ] `notification.service.ts`: preferences CRUD, email dispatch (including `paymentRemindersEnabled`)
- [ ] Notification SQS Lambda handler — routes all 7 event types: `TRANSACTION_POSTED`, `STATEMENT_GENERATED`, `PAYMENT_DUE_REMINDER`, `ACCOUNT_AUTO_CLOSED`, `ACCOUNT_USER_CLOSED`
- [ ] Integration tests: all email types, preference gating (incl. `paymentRemindersEnabled`)
- [ ] Terraform: notification SQS + Lambda

### Phase 7 — API Gateway & Full Wiring
- [ ] All 7 API Lambda handlers (thin dispatch), including `api-admin` for billing lifecycle trigger
- [ ] `service.client.ts` with Lambda invoke + local HTTP modes
- [ ] Local api-server.ts + worker.ts
- [ ] Terraform: API Gateway v2 + all API Lambdas + routes (including `POST /admin/billing-lifecycle`)
- [ ] End-to-end integration test via HTTP

### Phase 8 — DevOps & Hardening
- [ ] GitHub Actions: CI + deploy-dev + deploy-prod (backend + frontend)
- [ ] CloudWatch alarms (DLQ depth, Lambda errors)
- [ ] Secrets Manager: `MIGRATIONS_DATABASE_URL`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_IAM_USER`, `JWT_SECRET` populated after `terraform apply`
- [ ] Post-Terraform DB user setup: create `pixicred_app` (IAM, `rds_iam` grant) and `migrations-db-user` (password via Secrets Manager) in PostgreSQL
- [ ] `src/db/client.ts` Secrets Manager + IAM token generation (non-local environments only)
- [ ] S3 + CloudFront Terraform module for frontend hosting
- [ ] Route 53 records wired in Terraform (apex + www → CloudFront; api.* → API Gateway)
- [ ] README.md with architecture diagram + setup instructions

### Phase 9 — Frontend (Angular SPA)

> **Depends on**: Phase 8 (API Gateway live, custom domains working, JWT_SECRET in Secrets Manager)

- [ ] Angular 17+ workspace scaffolded in `frontend/`
- [ ] Routing: all pages listed in FR-FE-01 through FR-FE-17
- [ ] Auth service: register, login, JWT storage, logout
- [ ] Auth interceptor: injects `Authorization: Bearer` on protected requests
- [ ] Auth guard: protects all authenticated routes
- [ ] Welcome page (FR-FE-01)
- [ ] Apply flow: form + confirmation + status pages (FR-FE-02/03/04)
- [ ] Account setup page (FR-FE-05)
- [ ] Login page (FR-FE-06)
- [ ] Dashboard (FR-FE-07)
- [ ] Transactions page with cursor pagination (FR-FE-08)
- [ ] Payments page with FULL toggle (FR-FE-09)
- [ ] Statements list + detail + on-demand generate (FR-FE-10)
- [ ] Notification settings with live-toggle (FR-FE-11)
- [ ] Account settings + close account modal (FR-FE-12)
- [ ] Tailwind CSS fintech theme applied consistently across all pages
- [ ] `proxy.conf.json` wired for local `ng serve`
- [ ] `environment.ts` / `environment.prod.ts` with correct API URLs
- [ ] `ng build` produces deployable artifact in `dist/frontend/`
- [ ] Backend: `POST /auth/register` + `POST /auth/login` routes implemented (Phase 9 also ships `auth.service.ts`, `auth.queries.ts`, `auth.handler.ts`, `portal_accounts` migration)

---

## 12. Project Rules & AI-IDE Guidelines

### 12.1 Mandatory Development Process

**Every change must follow this sequence — no exceptions:**

0. **FR gate**: Verify a `FR-*` exists in Section 2 before writing a spec for new behavior
1. **Read PROJECT.md** — find relevant sections and FR codes
2. **Read existing spec** in `specs/` for the affected area (if any)
3. **Write or update a spec** using the format in Section 12.6
4. **Wait for approval**: only `"Approved — proceed."` unlocks implementation
5. **Implement** — only files listed in the approved spec
6. **Write or update tests**
7. **Update the spec** — tick done-when items, set status to ✅ Implemented
8. **Sync related specs**

### 12.2 Settled Decisions — Do Not Re-Litigate

- **TypeScript + Node.js 20** — not Python, not Go
- **PostgreSQL** — not DynamoDB, not Aurora Serverless
- **Private Lambda for service layer in AWS** — not ECS (portfolio), not a public Lambda
- **Direct Lambda invoke** from API Lambdas — not HTTP, not SQS
- **MiniStack** for local AWS emulation — not LocalStack
- **Terraform** for IaC — not CDK, not SAM
- **esbuild** for bundling (backend) — not webpack, not tsc
- **Vitest** for testing — not Jest
- **SQS + SNS fan-out** for async events
- **Single AWS account** with env-prefixed naming
- **No caching layer** — no Redis, no ElastiCache
- **Angular 17+ (standalone components)** for the frontend SPA — not React, not Vue, not Next.js
- **Tailwind CSS** for frontend styling — custom PixiCred fintech design theme; no component library
- **JWT (HS256, 24h)** for portal auth — not sessions, not OAuth, not Cognito
- **bcrypt (cost 12)** for password hashing — not SHA-256, not argon2
- **S3 + CloudFront** for frontend hosting — not Amplify, not Vercel
- **RDS IAM database authentication** for the service Lambda — no static DB password for the application; `pixicred_app` PostgreSQL user uses the `rds_iam` role; `@aws-sdk/rds-signer` generates a 15-minute token at cold start
- **`migrations-db-user`** for Prisma migrations — password-based, Secrets Manager-managed; used exclusively by the `migrate.yml` CI/CD workflow; never used by the application at runtime

### 12.3 Code Quality Rules

- No `any` without a comment explaining why
- All service functions have explicit TypeScript return types
- All DB queries live in `src/db/queries/` — no Prisma calls outside this directory or `src/service/`
- No env-specific logic in `src/service/` — inject clients via parameters
- All errors caught and logged; no unhandled promise rejections
- `idempotencyKey` validated as UUID format on all write endpoints

### 12.3a Service Layer Boundary Rules — Highest Priority

These rules enforce NFR-09. Any violation is a critical defect regardless of whether tests pass.

- **Lambda handlers contain no business logic.** An API Lambda handler may only: (1) parse path/query/body from the API GW event, (2) call `serviceClient.invoke(...)`, (3) map the result to an HTTP response shape. Nothing else.
- **SQS consumer handlers contain no business logic.** An SQS handler may only: (1) parse the SQS message body, (2) call `serviceClient.invoke(...)`, (3) acknowledge or fail the message. Nothing else.
- **No DB access outside `src/service/` and `src/db/`.** Lambda handlers never import from `src/db/`. The service layer owns all persistence.
- **No domain conditionals in handlers.** If a handler contains an `if` or `switch` that changes what data is written or what email is sent — that logic must move to `src/service/`.
- **Validation split**: input *shape* validation (is this a valid UUID? is `amount` a number?) may live in handlers. Business *rule* validation (does this account have sufficient credit? is this SSN a decline?) lives exclusively in `src/service/`.
- **Email sending lives in the service layer.** Handlers never call SES directly. The service layer calls `ses.client.ts` which is a thin infrastructure wrapper — but the *decision* to send an email and its content are always determined inside `src/service/`.

### 12.4 Infrastructure Rules

- No hardcoded ARNs, account IDs, or resource names in code or Terraform — use variables
- All resources tagged per Section 5.2
- All Lambdas have explicit `timeout` and `memory_size` per Section 5.4
- DLQs required for all SQS consumers — no exception
- Terraform state always remote — never local

### 12.5 Git Conventions

- Branch: `feature/FR-APP-01-submit-application`, `fix/FR-TXN-05-idempotency`
- Commit: `feat(FR-APP-01): implement application submission`
- PRs require passing CI before merge; no direct pushes to `main`

### 12.6 Spec Format

```markdown
## Spec: [Feature Name]
**FR references**: FR-XXX-NN
**Status**: 🔄 In Progress | ✅ Implemented | ❌ Blocked

### What
[One paragraph describing what is being built]

### Why
[One sentence referencing the FR and business need]

### New / Modified Files
- `src/service/xxx.service.ts` — [what changes]

### Behavior
[Precise description: inputs, outputs, side effects, error conditions]

### Done When
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Spec status → ✅ Implemented
- [ ] Related specs synced
```

---

## 13. Infrastructure Cost Estimates

### 13.1 Portfolio (Dev + Prod) — Monthly

| Resource | Config | Est. Cost |
|---|---|---|
| RDS `db.t4g.micro` × 2 | Single-AZ, 20 GB | ~$25–30 |
| Lambda | ~10K req/month | ~$0 (free tier) |
| API Gateway | ~10K req/month | ~$0 (free tier) |
| SQS + SNS + SES | Low volume | ~$0 (free tier) |
| CloudWatch Logs | 14-day retention | ~$1–2 |
| Secrets Manager | 4 secrets total | ~$1.60 |
| S3 (TF state) | Negligible | ~$0.01 |
| S3 (frontend) + CloudFront | Low traffic | ~$0–1 |
| Route 53 hosted zone | 1 zone | ~$0.50 |
| **Total** | | **~$29–37/month** |

> RDS is the dominant cost. To reduce further: stop dev RDS nights/weekends (saves ~50% on dev).

### 13.2 Production (Real-World) — Monthly

| Resource | Config | Est. Cost |
|---|---|---|
| ECS Fargate (2 tasks) | 0.5 vCPU / 1 GB, multi-AZ | ~$30–50 |
| ALB | 1 load balancer | ~$16 |
| RDS Multi-AZ `db.r6g.large` | 100 GB | ~$200–250 |
| Lambda + API GW | Moderate traffic | ~$5–20 |
| WAF + CloudWatch | | ~$20–30 |
| **Total** | | **~$275–375/month** |

---

## 14. Testing Plan

### 14.1 Test Layers

| Layer | Tool | What |
|---|---|---|
| Unit | Vitest | Service functions, credit check logic, email templates |
| DB Integration | Vitest + Testcontainers | Query functions against real Postgres |
| API Integration | Vitest + local Express | Route behavior, error codes, idempotency |
| Async Flow | Vitest + MiniStack | Full SQS-triggered flows end-to-end |

### 14.2 Coverage Requirements

- All service layer functions: happy path + all error branches
- All API routes: happy path + validation + 404 cases
- All idempotency paths: must have a dedicated integration test
- All async flows: at least one end-to-end test exercising the queue

### 14.3 Running Tests

```bash
npm run test             # unit tests (no external deps)
npm run test:integration # requires docker-compose up
npm run test:all         # both
```

---

*PixiCred PROJECT.md — v1.4 — Single Source of Truth for AI-Assisted Development*