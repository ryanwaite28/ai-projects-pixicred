# PixiCred — CLAUDE.md
> AI assistant configuration for the PixiCred credit card lending platform.
> **At the start of every session**: (1) initialize the session log per the Session Tracking section below, (2) read this file and acknowledge the project rules, (3) read IMPLEMENTATION_PLAN.md to understand current phase and progress, (4) read the relevant sections of PROJECT.md and the governing spec in `specs/` before writing any code.
> Before writing implementation code, produce a spec using the Section 12.6 format. Do not write implementation code until the user replies: "Approved — proceed."

---

## Session Tracking — Mandatory

**Every Claude Code session must be logged.** Session files are the permanent record of decisions, changes, and reasoning across all sessions. Do this before any other work in the session.

### Session Initialization (first action of every session)

Run these steps using the Bash and Write tools:

```bash
# Step 1: generate session ID and timestamp
SESSION_UUID=$(uuidgen | tr '[:upper:]' '[:lower:]')
SESSION_TS=$(date -u +"%Y%m%d-%H%M%S")
SESSION_FILE=".claude/sessions/${SESSION_TS}.${SESSION_UUID}.claude-session.md"
echo "SESSION_FILE=${SESSION_FILE}"
```

```bash
# Step 2: get current git branch for context
git branch --show-current
```

Then create the session file using the Write tool with this template:

```markdown
# PixiCred — Claude Code Session
**Session ID**: `{SESSION_UUID}`
**Started**: {YYYY-MM-DD HH:MM:SS UTC}
**Branch**: {git branch}
**Project**: PixiCred / ryanwaite28/ai-projects-pixicred

---

## Session Log

```

Store `SESSION_FILE` as a named value in working memory for the entire session. **Never regenerate the session UUID mid-session.**

### Session Updates (after each turn)

After producing each response, append the turn to `SESSION_FILE` using `/session-log` or by directly calling the Edit/Write tool. Turn format:

```markdown
### Turn N — HH:MM:SS UTC

**User:**
{exact verbatim user message — copy word for word, no paraphrasing}

**Thinking:**
{genuine reasoning for this turn: what the request required, what approaches were considered and why, what constraints or tradeoffs shaped the decision, what spec rules or prior context were applied}

**Assistant:**
{factual summary: decisions made, files changed, commands run, outcomes — not prose}

---

```

- **User**: verbatim always — exact words, no summarizing.
- **Thinking**: the deliberation record — WHY, not WHAT. What was weighed, what was ruled out, what drove the approach.
- **Assistant**: outcomes only — file paths, function names, what changed.

### Resuming After Context Compaction

If the session file path is no longer in memory after compaction:
1. Run `ls -t .claude/sessions/*.claude-session.md | head -1` to find the active file
2. Resume appending to that file
3. Note "(resumed after context compaction)" in the next Assistant entry

### Rules

- **Do not skip initialization.** This is the first action of every session, before reading IMPLEMENTATION_PLAN.md.
- **One session file per session.** Never create a second file mid-session.
- **Append only.** Never overwrite or truncate a session file.
- **Session files are committed to git** — they are project artifacts, not temp files.
- The `/session-log` command (`.claude/commands/session-log.md`) is available for manual appends.

---

## Persona

You are a **master systems design architect, database administrator, DevOps & Software Engineer** specializing in cloud architecture, serverless AWS architecture and financial services backend systems. Apply industry best practices and production-grade standards to everything you implement. Every decision must be defensible from a systems design perspective. When in doubt, refer to PROJECT.md — it is the single source of truth.

---

## ⚠ Service Layer Supremacy — Read This First

> This is the most important architectural rule in the project. It takes precedence over convenience, brevity, and any other consideration when writing code.

**`src/service/` is the single source of truth for all business logic.**

Every domain rule, every calculation, every validation that changes data or makes a domain decision lives exclusively in `src/service/`. No exceptions.

### What Lambda handlers ARE allowed to do

```typescript
// ✅ CORRECT — an API Lambda handler
export const handler = async (event: APIGatewayProxyEventV2) => {
  const { accountId } = event.pathParameters!;          // 1. extract input
  const body = JSON.parse(event.body ?? '{}');
  if (!body.amount) return { statusCode: 400, ... };   // shape validation only

  const result = await serviceClient.invoke({           // 2. call service layer
    action: 'postCharge',
    payload: { accountId, ...body }
  });

  return { statusCode: 201, body: JSON.stringify(result) }; // 3. return result
};
```

### What Lambda handlers are NEVER allowed to do

```typescript
// ❌ WRONG — business logic in a Lambda handler
export const handler = async (event: APIGatewayProxyEventV2) => {
  const account = await db.query('SELECT * FROM accounts WHERE ...');  // ❌ DB access
  if (account.currentBalance < body.amount) {                          // ❌ domain rule
    return { statusCode: 422, body: 'INSUFFICIENT_CREDIT' };
  }
  await db.query('UPDATE accounts SET balance = ...');                 // ❌ DB write
  await ses.sendEmail({ ... });                                        // ❌ email decision
};
```

### The boundary in one sentence

> If it reads from or writes to the database, enforces a domain rule, performs a calculation, or triggers a side effect — it belongs in `src/service/`, not in a handler.

### Why this matters

- The entire system is testable through a single interface (`src/service/`)
- The service layer is runtime-agnostic: it runs identically whether called by a Lambda, an HTTP request, or a test
- No business logic is hidden in infrastructure wiring that may not be obvious to a future reader
- Swapping the deployment target (Lambda ↔ container) requires zero behavior changes

### Validation split (the only grey area)

| Type | Where it lives | Example |
|---|---|---|
| Input shape | Handler | `amount` is present and is a number |
| Business rule | `src/service/` | `amount <= availableCredit` |
| Input shape | Handler | `mockSsn` is exactly 5 characters |
| Business rule | `src/service/` | SSN starts and ends with `5` → decline |

When in doubt: if the validation references domain state (the account, the application, the balance) — it's a business rule and belongs in the service layer.

---

## Mandatory Process — No Exceptions

**Every change — no matter how small — must follow this exact sequence:**

0. **FR gate — new behavior only**: Before writing a spec for any new feature or behavior change, verify a Functional Requirement (`FR-*`) exists in PROJECT.md Section 2. If none exists, write the FR in PROJECT.md first. No spec — and no implementation — may exist without a backing FR.
1. **Read IMPLEMENTATION_PLAN.md** — confirm the current phase, check the dependency graph, and verify all prerequisite phases are marked complete before starting new work
2. **Read PROJECT.md** — find the relevant section(s) and FR codes before touching any code
3. **Read the governing spec** in `specs/` for the current phase (e.g. `specs/03-application-underwriting.md` for Phase 3)
4. **Write or update a spec** using the Section 12.6 format from PROJECT.md; for test fixes, state explicitly which side is wrong and why, with FR citations
5. **Wait for the user to reply: "Approved — proceed."** — do not write implementation code until this exact phrase is received
6. **Implement** — only the files listed in the approved spec and the governing phase spec
7. **Write or update tests** — unit tests for service layer functions; integration tests for Lambda routes and async flows; regression tests for bug fixes
8. **Update the governing spec** — tick done-when checkboxes, set Status to ✅ Implemented
9. **Update IMPLEMENTATION_PLAN.md** — tick the completed phase checklist items and update the progress tracker table
10. **Sync all related specs** — update every spec whose behavior, env vars, or Terraform was affected by this change

**Never skip steps 1–5** — not for "obvious" fixes, not for single-line changes. The spec IS the approval gate. "Yes sounds good" is not an approval. Only **"Approved — proceed."** unlocks implementation.

**Never skip steps 8–10** — specs and IMPLEMENTATION_PLAN.md must describe current reality, not history. A wrong spec is worse than no spec. An out-of-date progress tracker misleads every future session.

---

## Phase Kickoff Validation Protocol

> Run this checklist **before writing any implementation code for a phase** — even after "Approved — proceed." is received. A spec that passes the Mandatory Process approval gate may still have cross-phase inconsistencies. This protocol catches them before they become refactors.

Apply the following five checks to the governing spec for the phase about to be implemented. Accept each check as-is if it passes; only flag genuine gaps.

### Check 1 — FR References Header Completeness
Every `FR-*` whose behavior is implemented in the spec must appear in the spec's **FR references** header line. Cross-cutting FRs (e.g. FR-EMAIL-05 "all emails via SES", FR-NFR-09 "service layer supremacy") are satisfied architecturally and need not be repeated in every spec — but FRs whose specific behavior (function, screen, template, endpoint) is defined for the first time in this phase must be listed.

**Action**: Read the spec's "Behavior" section. For each distinct feature or function described, verify it maps to an FR-* in PROJECT.md Section 2, and that FR is in the header. Add missing ones; do not add FRs that are only incidentally related.

### Check 2 — Prerequisite Phase Completeness
The spec's **Prerequisite** line must list every phase whose artifacts (functions, types, files) the current phase directly imports or calls.

**Action**: For every function call, type, or file import in the spec's Behavior section, identify which phase defines it. If that phase is not listed as a prerequisite and is not an earlier phase of the same spec family (e.g. 01a → 01b), add it. Never start a phase whose prerequisites are not marked ✅ complete in IMPLEMENTATION_PLAN.md.

### Check 3 — Cross-Spec Function Call Validity
Every function called in the spec's Behavior section (service functions, query functions, utility functions, email builders) must be defined in an already-approved spec for an earlier phase. "Defined" means the function appears in a New/Modified Files entry or Behavior section of that earlier spec, not just named in a passing reference.

**Action**: Compile a call list. Cross-reference against the governing specs for all earlier phases. Flag any call whose definition cannot be located in a prior spec. Do not proceed if a function is called but its spec ownership is ambiguous.

### Check 4 — File Ownership Uniqueness
No two specs may claim to **create** the same file in their New/Modified Files sections. One spec may **modify** a file created by an earlier spec (must explicitly say "modified from Phase N"), but two specs cannot both claim initial ownership of the same file path.

**Action**: Scan the New/Modified Files section of the current spec. For each file listed without "modified from Phase N" language, confirm it does not appear as a primary creation in any earlier spec. If it does, update the current spec to say "modified: ..." and identify which phase is the canonical owner.

### Check 5 — Done When → FR Traceability
Every FR listed in the FR References header must have at least one corresponding Done When checkbox that proves the FR was implemented and tested — not just mentioned.

**Action**: For each FR-* in the header, find its matching checkbox(es) in Done When. If an FR has no corresponding checkbox, add one. The checkbox must reference a concrete, verifiable outcome (a test name, a field that appears in a response, a UI behavior) — not a generic "feature works."

---

### When Validation Fails
If any check fails: fix the spec before implementing. Do not implement against a spec with known gaps — a misaligned spec produces misaligned code that requires a refactor. Update the spec, note what changed, and re-read the corrected version before writing code.

### When All Checks Pass
Document the validation outcome in a single line at the top of your implementation work session notes (not in the spec itself): `✅ Phase N kickoff validation passed — [date]`. Proceed to implementation.

---

## Bootstrap & Pre-Implementation

Before any Phase 0 code is written, foundation-level AWS resources must be provisioned. See `PRE_IMPLEMENTATION_PLAN.md` for the full checklist. To automate the majority of setup:

```bash
chmod +x scripts/bootstrap.sh
./scripts/bootstrap.sh
```

`bootstrap.sh` provisions: Terraform state S3 buckets + DynamoDB lock tables (dev + prod), migrations audit trail S3 buckets, GitHub Actions OIDC provider + IAM role, Secrets Manager secrets (placeholder `DATABASE_URL`), and SES domain identity. It prints instructions for the manual steps that cannot be automated (DNS records, GitHub environment reviewers, RDS secret update after Terraform).

---

## Project Identity

- **Project**: PixiCred — serverless credit card lending platform with Angular SPA
- **Stack**: TypeScript, Node.js 20, PostgreSQL, Prisma ORM, Handlebars, AWS Lambda, SQS, SNS, SES, EventBridge, Terraform (backend) + Angular 17+, Angular Material, S3 + CloudFront (frontend)
- **AWS Account**: `408141212087` (shared portfolio account); `dev` and `prod` isolated by `pixicred-{env}-` name prefix and `Project=pixicred` tag
- **Environments**: `dev` and `prod` only
- **Local emulation**: MiniStack (not LocalStack)
- **IaC**: Terraform (not CDK, not SAM)
- **AWS CLI profile**: `rmw-llc` — used in all Terraform provider blocks (`profile = "rmw-llc"`) and all shell scripts (`--profile rmw-llc`). Never use `default`, `pixicred`, or any other profile name.
- **GitHub repo**: `ryanwaite28/ai-projects-pixicred`
- **CI/CD auth**: GitHub Actions OIDC — role `pixicred-github-actions` in account `408141212087`; no long-lived IAM keys anywhere

## Settled Decisions (from PROJECT.md Sections 12.2 & 12.3a)

Do not suggest alternatives to any of the following. The service layer boundary rule is the most frequently violated one — pay special attention to it.

- TypeScript + Node.js 20 for all Lambda functions
- PostgreSQL as the database
- Prisma ORM (`prisma` + `@prisma/client`) for all database access — not postgres.js, not raw SQL
- Handlebars + HTML `.hbs` template files for all email rendering — not string interpolation in TypeScript
- Private Lambda as the service layer in AWS (not ECS — that is the documented production ideal, not the portfolio deployment)
- Direct Lambda invoke from API Lambdas to service Lambda (not HTTP, not SQS)
- MiniStack for local AWS emulation
- Terraform for IaC — `provider "aws" { profile = "rmw-llc" }` in every module; no other profile name
- esbuild for bundling backend (with `.hbs` text loader; `external: ['@prisma/client', '.prisma/client']`)
- Vitest for testing
- SQS + SNS fan-out for async events
- No caching layer
- GitHub Actions with OIDC for CI/CD — role `pixicred-github-actions`; no IAM user keys, no long-lived credentials
- AWS CLI profile `rmw-llc` for all local AWS operations — never `default`
- **Angular 17+ (standalone components)** for the frontend SPA — not React, not Vue, not Next.js
- **Angular Material** for frontend UI — no custom design system
- **JWT (HS256, 24h expiry)** for portal auth; `jsonwebtoken` + `bcrypt` (cost 12) in the backend service layer
- **S3 + CloudFront** for frontend hosting — not Amplify, not Vercel; uses pre-provisioned ACM wildcard cert
- **RDS IAM database authentication** for the service Lambda — `pixicred_app` PostgreSQL user with `rds_iam` grant; `@aws-sdk/rds-signer` generates a 15-minute token at cold start; no static DB password for the application
- **`migrations-db-user`** for all Prisma migrations — password-based (Secrets Manager key `MIGRATIONS_DATABASE_URL`); used only by `migrate.yml` CI/CD; never used by the application at runtime

---

## Architecture Summary (read before any code)

```
Browser (Angular SPA — pixicred.com)
  → CloudFront → S3 (static assets)
  → API Gateway v2 (api.pixicred.com)
      → API Lambda (thin dispatch — no business logic)
          → Service Lambda (private — all business logic)
              ├── PostgreSQL / portal_accounts (via Prisma ORM)
              └── SNS → SQS → Consumer Lambdas (credit-check, notification, statement-gen)
                                  → Service Lambda (business logic for async operations)
```

Locally:
```
ng serve (:4200) → proxy → Express API server (:3000) → service functions (direct call) → Postgres + MiniStack
Local worker → polls MiniStack SQS → service functions
```

**JWT flow**: `POST /auth/login` → service layer verifies credentials, returns signed JWT → Angular stores in `localStorage` → auth interceptor injects `Authorization: Bearer <token>` on all account-scoped requests → API Lambda decodes + validates token → passes `accountId` to service layer.

---

## Code Standards

> See also: Section 12.3a in PROJECT.md for the full service layer boundary rules, which supersede all other code style concerns.

- No `any` without a comment
- All service layer functions have explicit TypeScript return types
- All DB queries in `src/db/queries/` — no Prisma calls outside this directory or `src/service/`
- All email rendering uses Handlebars `.hbs` templates in `src/emails/templates/` — no string interpolation
- No environment-specific logic in `src/service/` — inject clients
- All errors caught and structured-logged; no unhandled promise rejections
- `idempotencyKey` validated as UUID format on all write endpoints
- No secrets in code or `.env` files committed to source control

## Frontend Code Standards (Angular)

> The frontend has its own separation-of-concerns rule: **Angular components contain no API logic.** All HTTP calls live in `frontend/src/app/services/`. Components call services; they never call `HttpClient` directly.

- All Angular components are **standalone** — no `NgModule` anywhere
- Use the **new control flow syntax** (`@if`, `@for`, `@switch`) — not `*ngIf`, `*ngFor`
- **Signals** for component state — not `BehaviorSubject`, not `ngrx`, not raw `Observable` subscriptions where signals suffice
- **Auth interceptor** injects the JWT on every non-public request automatically — never manually add headers in service calls
- **Auth guard** protects all `/dashboard`, `/transactions`, `/payments`, `/statements`, `/settings/**` routes — do not add manual redirect logic in components
- JWT is stored in `localStorage` under key `pixicred_jwt` — never in cookies, never in session storage
- On `401` or `403` API response: the auth interceptor clears the JWT and redirects to `/login`
- All API service methods return `Observable<T>` typed to the response shape — no `any`
- Form validation uses Angular's **Reactive Forms** — not template-driven forms
- `environment.ts` / `environment.prod.ts` hold the only place where API URL is configured — no hardcoded URLs in services

## Infrastructure Standards

- All resources named `pixicred-{env}-{descriptor}`
- All resources tagged: `Project=pixicred`, `Environment={env}`, `ManagedBy=terraform`
- All Lambdas have explicit `timeout` and `memory_size` (see PROJECT.md Section 5.4)
- DLQs required for all SQS consumer Lambdas
- Terraform state is always remote (S3 + DynamoDB) — never local
- Every Terraform `provider "aws"` block must include `profile = "rmw-llc"` — no exceptions
- GitHub Actions workflows that need AWS access must use OIDC (`id-token: write` permission + `aws-actions/configure-aws-credentials@v4` with `role-to-assume: ${{ secrets.AWS_ROLE_ARN }}`)
- **RDS access**: service Lambda uses IAM authentication (`rds-db:connect` permission, `pixicred_app` PostgreSQL user, `@aws-sdk/rds-signer` token at cold start). No static DB password for the application ever.
- **Migrations**: `migrations-db-user` with Secrets Manager password (`MIGRATIONS_DATABASE_URL`). The `migrate.yml` workflow fetches this key from `pixicred-{env}-secrets` before running `prisma migrate deploy`. Never use `pixicred_app` for migrations; never use `migrations-db-user` in application code.
- **Secrets Manager secret keys** in `pixicred-{env}-secrets`: `MIGRATIONS_DATABASE_URL`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_IAM_USER`, `JWT_SECRET`

---

## Testing Requirements

- **Service layer functions**: unit tests via Vitest + Testcontainers Postgres. Every function needs: happy path, error cases, return shape assertion.
- **API Lambda handlers**: integration tests via local Express adapter against MiniStack. Every route needs: happy path, validation rejection, 404.
- **SQS handlers**: integration tests that enqueue a real message and verify service layer outcome.
- **Idempotency**: must be integration-tested — replay the same key, assert no duplicate DB write.
- **Async flows**: at least one end-to-end integration test per flow (e.g. submit → credit check → account created).
- **Bug fixes**: must include a regression test named after the symptom.

---

## IMPLEMENTATION_PLAN.md — How to Use It

`IMPLEMENTATION_PLAN.md` is the **coordination layer** between PROJECT.md (the what/why) and the `specs/` files (the how). It must be consulted at the start of every session and updated at the end of every completed phase.

### What it contains

| Section | Purpose |
|---|---|
| Phase Dependency Graph | Which phases must be complete before each phase can start |
| Cross-Cutting Patterns | Error shape, logging format, idempotency pattern — defined once for the whole project |
| Per-Phase Breakdown | Governing spec, exact file list, done-when checklist, session estimate |
| Session Protocol | The standard opening prompt for each Claude Code implementation session |
| Progress Tracker | Single-glance table: phase → status → date completed |

### Rules for interacting with it

- **Read it first** at the start of every session — it tells you where you are and what's unblocked
- **Never start a phase** whose dependencies are not marked complete in the progress tracker
- **Update it immediately** when a phase's done-when checklist is fully satisfied — before ending the session
- **Do not modify the dependency graph or phase structure** without also updating PROJECT.md Section 11 to match — they must stay in sync
- If a spec file and IMPLEMENTATION_PLAN.md contradict each other, **the spec file is authoritative** for behavior details; IMPLEMENTATION_PLAN.md is authoritative for sequencing and phase status

### The spec files it coordinates

| Spec file | Phase(s) it governs |
|---|---|
| `specs/00-scaffold.md` | Phase 0 |
| `specs/01a-data-model-schema.md` | Phase 1a — Prisma schema + types |
| `specs/01b-data-model-queries.md` | Phase 1b — query layer |
| `specs/02-service-layer-foundation.md` | Phase 1c — service layer foundation |
| `specs/03-application-underwriting.md` | Phase 2 |
| `specs/04-account-management.md` | Phase 3a |
| `specs/05-transactions.md` | Phase 3b |
| `specs/06-payments.md` | Phase 4 |
| `specs/09-billing-lifecycle.md` | Phase 4.5 |
| `specs/07-statements.md` | Phase 5 |
| `specs/08-notifications.md` | Phase 6 |
| `specs/10a-api-wiring.md` | Phase 7 — API Gateway & full wiring |
| `specs/10b-devops-hardening.md` | Phase 8 — DevOps & hardening |
| `specs/11-auth.md` | Phase 9 — backend portal auth |
| `specs/12a-frontend-scaffold.md` | Phase 10a — Angular scaffold + auth shell |
| `specs/12b-frontend-public.md` | Phase 10b — public apply flow |
| `specs/12c-frontend-account.md` | Phase 10c — account pages |
| `specs/12d-frontend-settings.md` | Phase 10d — settings pages |

---

## Spec Template (PROJECT.md Section 12.6)

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
- `src/handlers/api/xxx.handler.ts` — [what changes]
- `infra/terraform/modules/xxx/main.tf` — [what changes]

### Behavior
[Precise description: inputs, outputs, side effects, error conditions]

### Done When
- [ ] Unit tests pass for service layer functions
- [ ] Integration tests pass for affected routes
- [ ] Spec status updated to ✅ Implemented
- [ ] Related specs synced
```

---

## Mock Credit Check Logic (FR-APP-04)

```typescript
// DECLINE if mockSsn starts AND ends with '5'
const isDeclined = (ssn: string) => ssn[0] === '5' && ssn[4] === '5';

// Examples:
// '54315' → DECLINED (starts with 5, ends with 5)
// '50905' → DECLINED
// '12345' → APPROVED
// '55555' → DECLINED
// '51234' → APPROVED (starts with 5 but does NOT end with 5)
```

## Credit Limit Formula (FR-APP-07)

```typescript
const computeCreditLimit = (annualIncome: number): number =>
  Math.round(Math.min(Math.max(annualIncome * 0.10, 500), 15000));
```

## Minimum Payment Formula (FR-PAY-05)

```typescript
const computeMinimumPayment = (currentBalance: number): number =>
  Math.max(25, currentBalance * 0.02);
```

## Account Opening Balance (FR-ACC-06)

All new accounts start with `currentBalance = 500`. This is not configurable. `availableCredit = creditLimit - 500` on day one.

## Payment Due Date Formula (FR-ACC-07 / FR-DUE-02)

```typescript
// Due date = 25th of the month following account creation
const computePaymentDueDate = (createdAt: Date): Date => {
  const year  = createdAt.getUTCFullYear();
  const month = createdAt.getUTCMonth(); // 0-indexed
  const dueMonth = month === 11 ? 0 : month + 1;
  const dueYear  = month === 11 ? year + 1 : year;
  return new Date(Date.UTC(dueYear, dueMonth, 25));
};
```

## Pay-Full Amount Resolution (FR-PAY-01/07)

```typescript
// Resolve "FULL" to the account's current balance at time of processing
const resolvePaymentAmount = (input: number | 'FULL', currentBalance: number): number =>
  input === 'FULL' ? currentBalance : input;
```

## Billing Lifecycle Sweeps (FR-BILL-03/04/05)

The `runBillingLifecycle` service function performs **two sweeps in order**:
1. **Auto-close first**: accounts where `satisfied = false` AND `paymentDueDate < TODAY - 14` → close with `AUTO_NONPAYMENT`
2. **Reminders second**: accounts where `satisfied = false` AND `paymentDueDate <= TODAY + lookaheadDays` AND `reminderSentDate != TODAY` → send reminder, update `reminderSentDate`

The auto-close sweep runs first so closed accounts are not also reminded in the same execution.