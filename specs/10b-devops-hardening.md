# Spec: DevOps & Hardening (Phase 8)
**FR references**: NFR-07, NFR-08
**Status**: ✅ Implemented
**Prerequisite**: Phase 7 (Terraform modules validated, local stack running)

---

## What

Phase 8 makes the system deployable and observable. It produces: the GitHub Actions CI/CD pipeline (`ci.yml` and `migrate.yml`); CloudWatch DLQ-depth and Lambda-error alarms (in Terraform env modules); `src/lib/config.ts` Secrets Manager integration; `src/db/client.ts` database client using `DATABASE_URL` from Secrets Manager; and `README.md`. Infrastructure config (VPC ID, subnet IDs, ACM certificate ARNs) is stored in AWS Parameter Store and consumed by Terraform at plan time — no GitHub secrets needed for these values.

Database is **Supabase** (external managed Postgres). No RDS, no IAM auth token generation. The `DATABASE_URL` Supabase connection pooler URL flows: GitHub environment secret → CI/CD syncs to Secrets Manager → Lambda reads from Secrets Manager at cold start.

---

## Why

NFR-07 requires structured CloudWatch logs and alarms. NFR-08 requires all secrets in Secrets Manager, not env files or code. The CI/CD pipeline enforces test-before-deploy and gated prod promotion.

---

## New / Modified Files

- `src/lib/config.ts` — new: fetches runtime secrets from Secrets Manager at module init time; exports `getConfig()` returning `{ DATABASE_URL, JWT_SECRET }`; local mode reads from `process.env` directly; singleton promise cached for Lambda reuse
- `src/db/client.ts` — modified from Phase 0: calls `getConfig()` from `src/lib/config.ts` and passes `DATABASE_URL` directly to PrismaClient; local mode reads `DATABASE_URL` from env; singleton PrismaClient exported
- `.github/workflows/ci.yml` — modified from Phase 0: full pipeline with pre-deploy shift-left checks, lint → build → test → pre-deploy-check → migrate-dev → deploy-dev → integration-test → approve-prod → migrate-prod → deploy-prod; includes `ng-lint-build`, `deploy-frontend-{env}` (S3 sync + CloudFront invalidation), and `approve-prod` gate
- `.github/workflows/migrate.yml` — modified from Phase 0: syncs `DATABASE_URL` from GitHub env secret to Secrets Manager, then runs `prisma migrate deploy` using the GitHub env secret directly
- `infra/terraform/envs/dev/main.tf` — CloudWatch alarms added (DLQ depth + Lambda errors); reads infra config from SSM Parameter Store (`/pixicred/{env}/acm_certificate_arn`) via `data "aws_ssm_parameter"`
- `infra/terraform/envs/prod/main.tf` — same additions for prod
- `README.md` — architecture overview, local setup, test commands, deployment steps

---

## Behavior

### `src/lib/config.ts` — centralized secrets loader

Fetches all secrets from Secrets Manager once per Lambda cold start. The result is cached so repeated `getConfig()` calls in the same invocation are free.

```typescript
export interface AppConfig {
  DATABASE_URL: string;
  JWT_SECRET: string;
}

let configPromise: Promise<AppConfig> | null = null;

export function getConfig(): Promise<AppConfig> {
  if (configPromise) return configPromise;
  if (process.env.ENVIRONMENT === 'local') {
    configPromise = Promise.resolve({
      DATABASE_URL: process.env.DATABASE_URL!,
      JWT_SECRET:   process.env.JWT_SECRET!,
    });
  } else {
    configPromise = (async () => {
      const sm = new SecretsManagerClient({ region: process.env.AWS_REGION });
      const secret = await sm.send(new GetSecretValueCommand({
        SecretId: `pixicred-${process.env.ENVIRONMENT}-secrets`
      }));
      return JSON.parse(secret.SecretString!) as AppConfig;
    })();
  }
  return configPromise;
}
```

All Lambda handlers that need `JWT_SECRET` call `await getConfig()` at the start of each invocation. The promise resolves instantly after the first cold-start fetch.

### `src/db/client.ts` — Supabase via DATABASE_URL

```typescript
async function buildPrismaClient(): Promise<PrismaClient> {
  let databaseUrl: string;
  if (process.env.ENVIRONMENT === 'local') {
    databaseUrl = process.env.DATABASE_URL!;
  } else {
    const { DATABASE_URL } = await getConfig();
    databaseUrl = DATABASE_URL;
  }
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}
```

`DATABASE_URL` is the Supabase connection pooler URL (port 6543). No RDS signer, no IAM token. `@aws-sdk/rds-signer` is not installed.

### `.github/workflows/ci.yml` — pipeline jobs

```
lint-typecheck    → prisma generate + tsc --noEmit + eslint (backend)
ng-lint-build     → ng lint + ng build --configuration=dev (frontend)
unit-test         → vitest run (backend)
build-backend     → scripts/build.sh + upload dist/ artifact
pre-deploy-check  → shift-left: ACM cert ISSUED, SES verified, S3 bucket exists,
                    Secrets Manager populated (not placeholder), psql connectivity
migrate-dev       → sync DATABASE_URL to Secrets Manager + prisma migrate deploy (dev)
deploy-dev        → terraform apply (dev) + upload Lambda ZIPs to S3
deploy-frontend-dev  → aws s3 sync dist/frontend/ s3://pixicred-dev-frontend/ --delete
                       aws cloudfront create-invalidation --distribution-id <ID> --paths "/*"
integration-test  → HTTP tests against https://api.dev.pixicred.com
approve-prod      → environment: prod-approval  [manual reviewer gate]
build-frontend-prod  → ng build --configuration=production
migrate-prod      → sync DATABASE_URL to Secrets Manager + prisma migrate deploy (prod)
deploy-prod       → terraform apply (prod) + upload Lambda ZIPs to S3
deploy-frontend-prod → aws s3 sync dist/frontend/ s3://pixicred-prod-frontend/ --delete
                       aws cloudfront create-invalidation --distribution-id <ID> --paths "/*"
```

The CloudFront distribution ID is read from Terraform output (`terraform output -raw cloudfront_distribution_id`). All jobs use `environment: dev` or `environment: prod` secrets for `AWS_ROLE_ARN`.

#### Pre-deploy shift-left checks (`pre-deploy-check` job)

Runs after build artifacts are ready but before any deployment. Fails fast on infrastructure gaps:

1. **ACM cert** — reads ARN from SSM `/pixicred/dev/acm_certificate_arn`, asserts status is `ISSUED`
2. **SES domain** — asserts `pixicred.com` `VerifiedForSendingStatus` is `True`
3. **Lambda packages S3 bucket** — `s3api head-bucket pixicred-dev-lambda-packages`
4. **Secrets Manager populated** — fetches `pixicred-dev-secrets`, asserts `DATABASE_URL` is non-empty and not `PLACEHOLDER`, and `JWT_SECRET` is non-empty
5. **Database connectivity** — installs `postgresql-client`, runs `psql "$DATABASE_URL" -c "SELECT 1"` using `secrets.DATABASE_URL` from the GitHub environment

### `.github/workflows/migrate.yml` — migration workflow

Triggers via `workflow_dispatch` with `environment` input (`dev` | `prod`).

Steps:
1. Checkout
2. `aws-actions/configure-aws-credentials` using the target environment's `AWS_ROLE_ARN`
3. Sync `DATABASE_URL` from GitHub environment secret to `pixicred-{env}-secrets` in Secrets Manager (jq merge — does not overwrite other keys)
4. `npx prisma migrate deploy` with `DATABASE_URL=${{ secrets.DATABASE_URL }}`
5. Sync `prisma/migrations/` to `s3://pixicred-{env}-migrations/` as audit trail

The `DATABASE_URL` GitHub environment secret is the Supabase connection pooler URL for that environment. Secrets Manager is kept in sync so Lambdas can fetch it at cold start.

### SSM Parameter Store

Terraform reads infra config via `data "aws_ssm_parameter"` — no GitHub secrets needed for these:

| SSM path | Value | Consumer |
|---|---|---|
| `/pixicred/vpc_id` | VPC ID | Terraform `module.service_lambda`, `module.rds` (if added) |
| `/pixicred/subnet_ids` | JSON array of subnet IDs | Terraform |
| `/pixicred/dev/acm_certificate_arn` | Dev ACM cert ARN | `module.api_gateway`, `module.frontend` |
| `/pixicred/prod/acm_certificate_arn` | Prod ACM cert ARN | `module.api_gateway`, `module.frontend` |

All SSM parameters are created by `scripts/bootstrap.sh` and referenced at Terraform plan time.

### CloudWatch alarms (Terraform)

- **DLQ-depth alarm** per DLQ: `ApproximateNumberOfMessagesVisible > 0` for 1 evaluation period → `pixicred-{env}-alerts` SNS topic
- **Lambda-error alarm** for service + 4 consumer Lambdas: `Errors > 5` in 5 minutes → alerts topic

---

## Exact Test Cases

### `tests/lib/config.test.ts`
```
test('getConfig returns DATABASE_URL and JWT_SECRET from env vars when ENVIRONMENT is local')
test('getConfig fetches secret from Secrets Manager when ENVIRONMENT is not local')
test('getConfig returns JWT_SECRET from fetched secret')
test('getConfig caches the result — Secrets Manager is called only once across multiple getConfig() calls')
```

### `tests/db/client.test.ts`
```
test('db client reads DATABASE_URL from process.env when ENVIRONMENT is local')
test('db client calls getConfig() and passes DATABASE_URL directly to PrismaClient in non-local mode')
test('getPrisma() called multiple times returns cached PrismaClient instance')
```

### Terraform validation (shell)
```
terraform -chdir=infra/terraform/envs/dev validate
terraform -chdir=infra/terraform/envs/prod validate
```

---

## Done When
- [x] `src/lib/config.ts` — `getConfig()` returns `{ DATABASE_URL, JWT_SECRET }`; fetches from Secrets Manager in non-local mode; caches result; returns env vars in local mode; all 4 test cases pass
- [x] `src/db/client.ts` uses `getConfig()` to get `DATABASE_URL`; passes it directly to PrismaClient; no RDS signer; all 3 test cases pass
- [x] `ci.yml` — backend + frontend lint/build/test; `pre-deploy-check` shift-left job; `migrate-dev` syncs DATABASE_URL to SM; `deploy-frontend-{env}` S3 sync + CloudFront invalidation; `prod-approval` gates prod
- [x] `migrate.yml` syncs DATABASE_URL from GitHub env secret to Secrets Manager; runs `prisma migrate deploy` using GitHub env secret; syncs migrations to S3
- [x] SSM parameters provisioned by `bootstrap.sh`: `/pixicred/vpc_id`, `/pixicred/subnet_ids`, `/pixicred/dev/acm_certificate_arn`, `/pixicred/prod/acm_certificate_arn`
- [x] CloudWatch DLQ-depth alarms on all 4 DLQs; Lambda-error alarms on service + 4 consumers
- [x] `infra/terraform/envs/dev` and `prod` pass `terraform validate` with SSM data sources and alarms included
- [x] `README.md` covers local setup, test commands, and deployment instructions
- [x] Spec status updated to ✅ Implemented
- [x] IMPLEMENTATION_PLAN.md Phase 8 row marked complete
