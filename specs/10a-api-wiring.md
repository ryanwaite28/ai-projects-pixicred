# Spec: API Gateway & Full Wiring (Phase 7)
**FR references**: NFR-03, NFR-05, NFR-06, FR-FE-16
**Status**: ✅ Implemented
**Prerequisite**: Phase 6 (all service layer functions complete)

---

## What

Phase 7 wires the complete local development stack and all Terraform infrastructure. It builds: the full `scripts/build.sh` that bundles all 12 Lambda entry points; `local/api-server.ts` (Express, port 3000) and `local/worker.ts` (SQS long-poller); all reusable Terraform modules (`lambda`, `sqs`, `rds`, `api-gateway`); and the per-environment root modules (`envs/dev`, `envs/prod`) that compose them — including EventBridge scheduled rules and SQS event source mappings.

---

## Why

NFR-03 requires Lambda-based compute at near-zero rest cost. NFR-05 requires full local parity via MiniStack. NFR-06 requires dev/prod isolation via `pixicred-{env}-` prefixes. No real AWS resources are used until Phase 8 `terraform apply` runs.

---

## New / Modified Files

### Build
- `scripts/build.sh` — runs `prisma generate` then esbuild bundles for all 13 Lambda + 3 local entry points; replaces Phase 0 placeholder
- `esbuild.config.ts` — verified unchanged; `external: ['@prisma/client', '.prisma/client']`, `loader: { '.hbs': 'text' }`, `platform: 'node'`, `target: 'node20'`

### Auth handler stub (replaced by Phase 9)
- `src/handlers/api/auth.handler.ts` — stub: `POST /auth/register` and `POST /auth/login` both throw `NOT_IMPLEMENTED`; included in build.sh; Phase 9 (specs/11-auth.md) replaces with real implementation

### Local development
- `local/api-server.ts` — Express on port 3000; all routes call service dispatch directly; JWT validation middleware on `[JWT required]` routes uses `jsonwebtoken` inline (not via `src/lib/jwt.ts` which is Phase 9); returns `{ data }` / `{ error }` envelope
- `local/worker.ts` — SQS long-poller on all four MiniStack queues; unwraps SNS envelope for notification queue; deletes on success, leaves on error; exits on SIGTERM
- `scripts/seed-local.ts` — inserts a known application, triggers credit check via local worker; used for demo setup

### Terraform modules
- `infra/terraform/modules/lambda/main.tf` — `aws_lambda_function`, `aws_iam_role`, `aws_iam_role_policy`, `aws_cloudwatch_log_group` (14-day retention)
- `infra/terraform/modules/lambda/variables.tf` — `function_name`, `handler`, `memory_size`, `timeout`, `environment`, `policy_json`, `s3_bucket`, `s3_key`
- `infra/terraform/modules/lambda/outputs.tf` — `function_arn`, `function_name`, `invoke_arn`
- `infra/terraform/modules/sqs/main.tf` — main queue + DLQ (`aws_sqs_queue` × 2), `aws_sqs_queue_redrive_policy`
- `infra/terraform/modules/sqs/variables.tf` — `name`, `visibility_timeout_seconds`, `max_receive_count`
- `infra/terraform/modules/sqs/outputs.tf` — `queue_url`, `queue_arn`, `dlq_url`, `dlq_arn`
- `infra/terraform/modules/rds/main.tf` — `aws_db_instance` (Postgres 15, `db.t4g.micro`, single-AZ, 20 GB gp3, 7-day backup, `iam_database_authentication_enabled = true`), `aws_db_subnet_group`, `aws_security_group`
- `infra/terraform/modules/rds/variables.tf`
- `infra/terraform/modules/rds/outputs.tf` — `endpoint`, `port`, `db_name`
- `infra/terraform/modules/api-gateway/main.tf` — `aws_apigatewayv2_api` (HTTP), `aws_apigatewayv2_stage` (`$default`, auto-deploy), one integration + one route per API Lambda route, `aws_lambda_permission` per Lambda, `aws_apigatewayv2_domain_name` + `aws_apigatewayv2_api_mapping` for custom domain (`api.pixicred.com`)
- `infra/terraform/modules/api-gateway/variables.tf` — `name`, `integrations` map of `{ lambda_arn, routes: [{ method, path }] }`, `domain_name`, `acm_certificate_arn`
- `infra/terraform/modules/api-gateway/outputs.tf` — `api_endpoint`, `domain_name_target` (for Route 53 alias)
- `infra/terraform/modules/frontend/main.tf` — `aws_s3_bucket` (`pixicred-{env}-frontend`), `aws_s3_bucket_public_access_block`, `aws_cloudfront_origin_access_control`, `aws_cloudfront_distribution` (HTTPS-only; ACM cert `arn:aws:acm:us-east-1:408141212087:certificate/*`; default root object `index.html`; custom error 403/404 → `index.html` 200 for SPA routing), `aws_s3_bucket_policy` (allows CloudFront OAC only)
- `infra/terraform/modules/frontend/variables.tf` — `env`, `acm_certificate_arn`, `hosted_zone_id`
- `infra/terraform/modules/frontend/outputs.tf` — `cloudfront_domain_name`, `cloudfront_hosted_zone_id`, `s3_bucket_name`
- `infra/terraform/modules/dns/main.tf` — Route 53 A-records (alias): `pixicred.com` + `www.pixicred.com` → CloudFront distribution; `api.pixicred.com` → API Gateway regional domain; uses hosted zone `Z0511624US25VOVRIJF3`
- `infra/terraform/modules/dns/variables.tf` — `hosted_zone_id`, `cloudfront_domain_name`, `cloudfront_hosted_zone_id`, `api_gateway_domain_name`, `api_gateway_hosted_zone_id`

### Terraform environments
- `infra/terraform/envs/dev/main.tf` — composes all modules for `dev`; wires IAM roles (Section 5.7); provisions SNS topic (`pixicred-dev-events`); 3 EventBridge rules; SQS event source mappings for all 4 consumer Lambdas; S3 bucket for Lambda packages (`pixicred-dev-lambda-packages`); includes `frontend` and `dns` modules
- `infra/terraform/envs/dev/variables.tf`, `outputs.tf` — outputs `api_endpoint`, `frontend_url`
- `infra/terraform/envs/prod/main.tf` — identical structure with `environment = "prod"`
- `infra/terraform/envs/prod/variables.tf`, `outputs.tf`

---

## Behavior

### `scripts/build.sh` — entry points

```
src/handlers/api/applications.handler.ts  → dist/lambdas/api-applications/index.js
src/handlers/api/accounts.handler.ts      → dist/lambdas/api-accounts/index.js
src/handlers/api/transactions.handler.ts  → dist/lambdas/api-transactions/index.js
src/handlers/api/payments.handler.ts      → dist/lambdas/api-payments/index.js
src/handlers/api/statements.handler.ts    → dist/lambdas/api-statements/index.js
src/handlers/api/notifications.handler.ts → dist/lambdas/api-notifications/index.js
src/handlers/api/auth.handler.ts          → dist/lambdas/api-auth/index.js
src/handlers/api/admin.handler.ts         → dist/lambdas/api-admin/index.js
src/handlers/service/service.handler.ts   → dist/lambdas/service/index.js
src/handlers/sqs/credit-check.handler.ts  → dist/lambdas/credit-check/index.js
src/handlers/sqs/notification.handler.ts  → dist/lambdas/notification/index.js
src/handlers/sqs/statement-gen.handler.ts → dist/lambdas/statement-gen/index.js
src/handlers/sqs/billing-lifecycle.handler.ts → dist/lambdas/billing-lifecycle/index.js
local/api-server.ts                       → dist/local/api-server.js
local/service-server.ts                   → dist/local/service-server.js
local/worker.ts                           → dist/local/worker.js
```

Each bundle: `platform: 'node'`, `target: 'node20'`, `bundle: true`, `sourcemap: true`.

### `local/api-server.ts` — route table

```
POST   /applications                                → submitApplication
GET    /applications/:applicationId                 → getApplication
POST   /auth/register                               → registerPortalAccount
POST   /auth/login                                  → loginPortalAccount
GET    /accounts/:accountId                         → getAccount          [JWT required]
DELETE /accounts/:accountId                         → closeAccount({ reason: 'USER_REQUESTED' })  [JWT required]
POST   /accounts/:accountId/transactions            → postCharge          [JWT required]
GET    /accounts/:accountId/transactions            → getTransactions     [JWT required]
POST   /accounts/:accountId/payments                → postPayment         [JWT required]
GET    /accounts/:accountId/statements              → getStatements       [JWT required]
GET    /accounts/:accountId/statements/:statementId → getStatement        [JWT required]
POST   /accounts/:accountId/statements              → generateStatement   [JWT required]
GET    /accounts/:accountId/notifications           → getNotificationPreferences  [JWT required]
PATCH  /accounts/:accountId/notifications           → updateNotificationPreferences  [JWT required]
POST   /admin/billing-lifecycle                     → sqsClient.sendMessage(BILLING_LIFECYCLE_QUEUE_URL, ...)
```

JWT validation for `[JWT required]` routes in `local/api-server.ts`: decode Bearer token from `Authorization` header using `jsonwebtoken` inline, verify HS256 signature with `JWT_SECRET` env var, assert `accountId` in payload matches `:accountId` path param. On failure return 401 UNAUTHORIZED or 403 FORBIDDEN. **Note**: `src/lib/jwt.ts` is not created until Phase 9 — this local-server JWT check is implemented inline and is not shared with Lambda handlers. Lambda handlers gain JWT enforcement in Phase 9 when `src/lib/jwt.ts` exists.

### `local/worker.ts` — polling behavior

Long-polls each queue with `WaitTimeSeconds = 20`. Round-robin across all four queues. Notification queue: parses `record.body` as SNS envelope then `envelope.Message` as the inner event. Deletes message on success; leaves on queue on error. Exits on `SIGTERM`.

### Terraform IAM roles (PROJECT.md Section 5.7)

| Lambda | `lambda:InvokeFunction` on | Other |
|---|---|---|
| api-* (including api-auth) | service Lambda ARN | — |
| api-admin | — | `sqs:SendMessage` on billing-lifecycle queue |
| service | — | `ses:SendEmail`, `sns:Publish`, `secretsmanager:GetSecretValue`, `rds-db:connect` (scoped to `pixicred_app`) |
| credit-check | service Lambda ARN | `sqs:ReceiveMessage`, `sqs:DeleteMessage` on credit-check queue |
| notification | service Lambda ARN | `sqs:ReceiveMessage`, `sqs:DeleteMessage` on notification queue |
| statement-gen | service Lambda ARN | `sqs:ReceiveMessage`, `sqs:DeleteMessage` on statement-gen queue |
| billing-lifecycle | service Lambda ARN | `sqs:ReceiveMessage`, `sqs:DeleteMessage` on billing-lifecycle queue |

No IAM role is shared across functions.

### `infra/terraform/modules/frontend/` — S3 + CloudFront (FR-FE-16)

The `frontend` Terraform module provisions:
- `aws_s3_bucket` named `pixicred-{env}-frontend` — no public access; all objects private; served only via CloudFront OAC
- `aws_cloudfront_distribution` — origin is the S3 bucket via OAC; HTTPS-only (`redirect-to-https`); price class `PriceClass_100` (US/EU); aliases `pixicred.com` and `www.pixicred.com` (prod only; dev uses the CloudFront subdomain directly); ACM certificate ARN passed as variable; default root object `index.html`
- Custom error responses: `403 → /index.html (200)` and `404 → /index.html (200)` — required for Angular SPA client-side routing
- `aws_s3_bucket_policy` granting `s3:GetObject` to the CloudFront OAC principal only

Frontend assets are uploaded by the CI/CD pipeline (see Phase 8 spec), not by Terraform. Terraform only provisions the infrastructure.

### `infra/terraform/modules/dns/` — Route 53 records

Uses pre-existing hosted zone `Z0511624US25VOVRIJF3` (`pixicred.com.`):

| Record | Type | Alias target |
|---|---|---|
| `pixicred.com` | A (alias) | CloudFront distribution |
| `www.pixicred.com` | A (alias) | CloudFront distribution |
| `api.pixicred.com` | A (alias) | API Gateway regional custom domain |

All three are `aws_route53_record` resources with `alias` blocks. The `evaluate_target_health = false` for CloudFront; `true` for API Gateway.

### API Gateway custom domain (`api.pixicred.com`)

In `infra/terraform/modules/api-gateway/main.tf`:
- `aws_apigatewayv2_domain_name` — `domain_name = "api.pixicred.com"`, ACM cert ARN passed as variable
- `aws_apigatewayv2_api_mapping` — maps the `$default` stage to the custom domain
- Output `domain_name_target` and `domain_name_hosted_zone_id` (from `aws_apigatewayv2_domain_name.domain_name_configuration`) for use by the `dns` module

### JWT validation in account-scoped API Lambda handlers

**Deferred to Phase 9.** `src/lib/jwt.ts` does not exist until Phase 9 (specs/11-auth.md). Lambda handlers for `[JWT required]` routes gain JWT enforcement in Phase 9 when Phase 9 creates `validateBearerToken`. Phase 7 Lambda handlers do not include JWT checks — they are unauthenticated at the Lambda level until Phase 9 completes. The `local/api-server.ts` provides JWT enforcement for local development using inline `jsonwebtoken` calls.

### EventBridge rules

| Rule name | Schedule (UTC) | Target | Payload |
|---|---|---|---|
| `pixicred-{env}-billing-lifecycle-daily` | `cron(0 8 * * ? *)` | billing-lifecycle SQS | `{ "lookaheadDays": 7 }` |
| `pixicred-{env}-stmt-weekly` | `cron(0 0 ? * MON *)` | statement-gen SQS | `{ "period": "weekly" }` |
| `pixicred-{env}-stmt-monthly` | `cron(0 0 1 * ? *)` | statement-gen SQS | `{ "period": "monthly" }` |

---

## Exact Test Cases

### `tests/local/api-server.test.ts`
```
test('POST /applications returns 201 PENDING on valid input')
test('POST /applications returns 409 DUPLICATE_APPLICATION for duplicate email')
test('GET /applications/:applicationId returns 200 with application data after credit check completes')
test('POST /accounts/:accountId/transactions returns 201 with updated balance')
test('POST /accounts/:accountId/transactions returns 201 with original transaction on idempotent replay')
test('POST /accounts/:accountId/payments with amount FULL returns 201 and balance reaches zero')
test('DELETE /accounts/:accountId returns 200 with CLOSED account')
test('POST /accounts/:accountId/statements returns 201 with generated statement')
test('PATCH /accounts/:accountId/notifications returns 200 with updated preferences')
test('POST /admin/billing-lifecycle returns 202 immediately')
test('GET /nonexistent-route returns 404')
test('GET /accounts/:accountId without JWT returns 401 UNAUTHORIZED')
test('GET /accounts/:accountId with JWT for different accountId returns 403 FORBIDDEN')
```

### `tests/local/worker.test.ts`
```
test('worker processes credit-check queue message and invokes runCreditCheck')
test('worker processes notification queue message and unwraps SNS envelope before routing')
test('worker processes statement-gen queue message and invokes generateAllStatements')
test('worker processes billing-lifecycle queue message and invokes runBillingLifecycle')
test('worker deletes message from queue after successful processing')
test('worker leaves message on queue when processing throws an error')
```

### Terraform validation (shell, not Vitest)
```
terraform -chdir=infra/terraform/modules/lambda validate
terraform -chdir=infra/terraform/modules/sqs validate
terraform -chdir=infra/terraform/modules/rds validate
terraform -chdir=infra/terraform/modules/api-gateway validate
terraform -chdir=infra/terraform/envs/dev validate
terraform -chdir=infra/terraform/envs/prod validate
```

---

## Done When
- [x] `scripts/build.sh` bundles all entry points (including auth.handler.ts stub) and exits 0
- [x] `local/api-server.ts` serves all routes; JWT validation enforced on account-scoped routes via inline `jsonwebtoken` (not via jwt.ts)
- [x] `local/worker.ts` polls all 4 MiniStack queues; notification queue correctly unwraps SNS envelope
- [x] `src/handlers/api/auth.handler.ts` stub created — both routes throw NOT_IMPLEMENTED; Phase 9 replaces
- [x] All Terraform modules pass `terraform validate` (including `frontend` and `dns`)
- [x] `infra/terraform/envs/dev` and `prod` pass `terraform validate`
- [x] RDS module has `iam_database_authentication_enabled = true`
- [x] 3 EventBridge rules provisioned with correct cron expressions
- [x] All 4 SQS consumer Lambdas have event source mappings
- [x] All Lambda IAM roles match PROJECT.md Section 5.7 — no shared roles; service role has `rds-db:connect` not `rds-data:*`
- [x] `frontend` module: S3 bucket + CloudFront distribution with SPA 403/404→200 error responses; OAC-only bucket policy (FR-FE-16)
- [x] `dns` module: 3 Route 53 A-alias records (apex, www → CloudFront; api → API Gateway custom domain)
- [x] API Gateway custom domain `api.pixicred.com` wired with ACM cert; stage mapping in place
- [x] JWT enforcement on Lambda handlers deferred to Phase 9 — not a Phase 7 requirement
- [x] End-to-end HTTP integration tests pass against local stack
- [x] Spec status updated to ✅ Implemented
- [x] IMPLEMENTATION_PLAN.md Phase 7 row marked complete
