# PixiCred — Project Retrospective

**Project**: PixiCred — Serverless credit card lending platform
**Stack**: TypeScript / Node.js 20 · Angular 17+ · PostgreSQL / Prisma · AWS Lambda / SQS / SNS / SES · Terraform · GitHub Actions
**Status**: Complete (v1)

---

## Issues Encountered

### Infrastructure & CI/CD

**Terraform `profile` hardcoded — broke CI**
Every `provider "aws"` block hardcoded `profile = "rmw-llc"`. This worked locally but failed in GitHub Actions because there is no `~/.aws/credentials` on the runner — OIDC injects credentials as environment variables, which the AWS SDK ignores when a named profile is explicitly set. The fix was to parameterize the profile as a Terraform variable (`default = "rmw-llc"`) and set `TF_VAR_aws_profile=""` in CI steps, causing the provider to fall back to the environment credential chain when the value is empty.

**Takeaway**: Never hardcode AWS profile names in Terraform provider blocks. Use a variable with a sensible local default and an empty-string override for CI from day one.

---

**Missing Lambda bundles in esbuild — silent deployment gap**
Three Lambda handlers (`api-merchant`, `dispute-resolution`, `transaction-settlement`) were fully implemented, tested, and referenced in Terraform, but were never added to `esbuild.config.ts`. The build step produced no artifact for these handlers and the toolchain test only verified a single bundle, so the gap was invisible in CI until an explicit audit.

**Takeaway**: When adding a new Lambda handler, the esbuild entry and the toolchain test assertion must be added in the same commit. The Done When checklist for each spec should include an explicit "bundle appears in `dist/lambdas/`" checkbox rather than leaving it to a separate audit.

---

**API Gateway routes missing despite Lambda handlers existing**
`POST /merchant/charge` and `POST /accounts/:id/transactions/:id/dispute` were wired in Lambda code and service handler dispatch, but the Terraform API Gateway integration blocks were not added. The routes would return 404 in deployed environments despite the Lambdas being deployed.

**Takeaway**: Each spec's Done When checklist should include an explicit Terraform integration row. The spec-to-infrastructure gap is the hardest kind to catch in review because the code "works" locally through a different path.

---

**Service Lambda had noise environment variables**
Six SQS queue URL variables were set on the service Lambda environment even though the service layer publishes to SNS (not SQS directly) — the queue URLs belong to the consumer Lambdas. These were never read and added unnecessary noise to the Lambda configuration.

**Takeaway**: When writing Terraform `environment` blocks for Lambdas, cross-reference against the actual `process.env` reads in the handler code. Extra variables are not harmful but indicate the IaC and application code drifted.

---

**`dynamodb_table` deprecation warning in Terraform backend**
Terraform 1.15+ deprecated the `dynamodb_table` parameter in S3 backend blocks in favor of `use_lockfile`. This is a non-blocking warning, but it will eventually become an error in a future Terraform release.

**Takeaway**: Track Terraform provider and core version warnings proactively. A warning in a backend block is easy to miss because backends are initialized infrequently.

---

### Testing

**Integration test failure — `card_number` unique constraint**
`makeAccount()` test helpers in `transaction.service.test.ts`, `statement.service.test.ts`, and `account.service.test.ts` all hardcoded `cardNumber: '1234567890123456'`. Tests that needed two accounts within a single `it()` block hit the PostgreSQL unique constraint on `card_number` because `cleanTables` only runs between tests (in `beforeEach`), not mid-test.

The fix was to add a module-level `accountSeq` counter, reset it in `beforeEach`, and generate card numbers as `String(++accountSeq).padStart(16, '0')`. The billing-lifecycle tests already used this pattern (`emailCounter`) — it just wasn't applied consistently.

**Takeaway**: Any `makeAccount`/`makeUser`/`makeX` test helper that creates a row with a unique constraint column must generate unique values, not hardcode them. Establish this as a project convention and code-review it for every new test helper.

---

**`renewCard` test failed due to future-dated test fixture**
The `renewCard` test set `cardExpiry: new Date('2029-06-01')` — three years in the future. `generateCardExpiry(new Date())` returns `now + 36 months`, which landed in May 2029, *before* June 2029. The assertion `after > before` was false.

The root cause was a test fixture that assumed the test would always run before a certain date. The fix was to use a past expiry (`2024-01-01`) so renewal always moves the date forward.

**Takeaway**: Test fixtures for date-based assertions must use clearly past or clearly future values relative to the assertion logic — never a specific future date that will eventually become the past. Document the intent with a comment.

---

**TypeScript error: accessing non-existent `availableCredit` on raw Prisma row**
A new test used `accountRow!.availableCredit` on a raw `prisma.account.findFirst()` result. `availableCredit` is a computed field in the service-layer mapper — it is not a database column and does not exist on the raw Prisma type. The fix was `creditLimit - currentBalance` arithmetic, matching the pattern already used elsewhere in the test file.

**Takeaway**: When writing tests that access raw Prisma rows, check the schema directly rather than assuming the domain type fields map 1:1 to DB columns. Computed/derived fields are a common source of confusion at the DB-layer boundary.

---

**Async flow integration test was missing**
`specs/03-application-underwriting.md` had an unchecked Done When item for an end-to-end flow test. The individual service functions (`submitApplication`, `runCreditCheck`) were unit-tested in isolation but no test verified the chained result: submit → credit check → account created + correct balances + PaymentDueSchedule + NotificationPreferences + SNS events in order.

**Takeaway**: End-to-end service-layer flow tests are distinct from unit tests and must be planned explicitly. Each spec's Done When checklist should have a dedicated row for the integration flow test, not just "all unit tests pass."

---

### Frontend

**Frontend `Account` interface missing card fields**
The backend `Account` type included `cardNumber`, `cardExpiry`, and `cardCvv`, but the frontend `Account` interface in `account.service.ts` omitted these three fields. This was not caught by the Angular build because the interface was not used in a way that would expose the missing fields until the settings page needed them.

**Takeaway**: When the backend type is finalized for a phase, the frontend interface should be updated in the same PR. A shared type schema or code generation (e.g., OpenAPI) would prevent this class of drift.

---

**Navigation dead-end for `/settings/notifications`**
The `/settings/notifications` route was implemented and guarded, but there was no link to it in the navbar or from the settings/account page. The route was accessible only by typing the URL directly.

**Takeaway**: Every route that is implemented must have at least one navigation entry point — either in the navbar, a sibling page, or a clear "next step" link. Navigation completeness should be a Done When checklist item in every frontend spec.

---

**ESLint did not honor `_`-prefixed unused variables**
`@typescript-eslint/recommended` enables `no-unused-vars` without the conventional `argsIgnorePattern: "^_"` and `varsIgnorePattern: "^_"` options. Parameters intentionally prefixed with `_` (e.g., `_input`, `_record`) were flagged as errors even though the prefix is the TypeScript/JavaScript convention for intentionally unused parameters.

**Takeaway**: Configure `argsIgnorePattern` and `varsIgnorePattern` to `"^_"` from the start. This is the standard TypeScript convention and the ESLint default not honoring it is a known footgun.

---

## Lessons Learned

**Spec-first discipline pays off in large projects**
Writing a spec for every feature before coding — and waiting for "Approved — proceed." — prevented scope creep and kept implementation focused. The one time this paid off most visibly was catching cross-phase inconsistencies (missing prerequisites, ambiguous function ownership) before they became mid-implementation refactors.

**Done When checklists need infrastructure rows, not just code rows**
Most spec checkboxes covered service functions and tests. Infrastructure — esbuild entries, API Gateway routes, Lambda environment variables — was underrepresented. An esbuild entry or a Terraform integration block is as much "part of the feature" as the service function that powers it.

**Test helpers with unique constraint columns need per-call unique values**
This bit multiple test files. The billing-lifecycle tests solved it early with an `emailCounter`; the others didn't follow the pattern. Establishing a linting rule or a shared `makeUniqueCardNumber()` utility early would have prevented all three failures.

**Environment parity between local and CI requires explicit thought**
The Terraform profile issue, the MiniStack init script, and the `dynamodb_table` warning are all the same class of problem: a local-only assumption that silently doesn't apply in CI. A CI-first mindset — write IaC and scripts to work without local developer state, then add local overrides as variables/defaults — would have caught these earlier.

**Audit phases are necessary and valuable**
A deliberate "audit" phase after all implementation phases were complete surfaced 8 distinct issues that individual spec reviews had missed. This audit should be a planned final phase in future projects, not something triggered by noticing something is wrong.

**Separation of concerns in the test suite matters**
The Testcontainers integration tests (service-layer + DB queries) and the handler unit tests (mocked serviceClient) serve different purposes. Keeping them in separate `vitest.*.config.ts` files and separate directories made it easy to run each independently and diagnose failures without noise.

---

## What to Take Into Future Projects

| Decision | Carry Forward |
|---|---|
| Spec-first with explicit approval gate | Yes — non-negotiable |
| Done When checklist items for IaC (esbuild, API Gateway, Lambda env) | Yes — add to spec template |
| Counter-based unique values in all test factory helpers | Yes — project convention from day one |
| `argsIgnorePattern: "^_"` in ESLint config | Yes — include in project scaffold |
| Terraform `aws_profile` as variable with empty-string CI override | Yes — standard pattern for all future Terraform projects |
| Session log per CLAUDE.md | Yes — invaluable cross-session continuity |
| Dedicated audit phase after all implementation phases | Yes — plan it explicitly, don't leave it to chance |
| `TF_VAR_*` environment variables for CI-specific Terraform overrides | Yes — cleaner than provider-level environment detection |
| Angular signals + new control flow syntax (`@if`, `@for`) | Yes — reactive and ergonomic; signals over BehaviorSubject |
| Service layer boundary (`src/service/` owns all business logic) | Yes — the single most important architectural decision |
