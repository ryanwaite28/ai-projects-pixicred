# Spec: DevOps & Hardening (Phase 8)
**FR references**: NFR-07, NFR-08
**Status**: 🔄 In Progress
**Prerequisite**: Phase 7 (Terraform modules validated, local stack running)

---

## What

Phase 8 makes the system deployable and observable. It produces: the GitHub Actions CI/CD pipeline (`ci.yml` and `migrate.yml`); CloudWatch DLQ-depth and Lambda-error alarms (in Terraform env modules); `src/db/client.ts` Secrets Manager + RDS IAM token integration; and `README.md`. After `terraform apply`, the database users are created and Secrets Manager is populated per PRE_IMPLEMENTATION_PLAN.md.

---

## Why

NFR-07 requires structured CloudWatch logs and alarms. NFR-08 requires all secrets in Secrets Manager, not env files or code. The CI/CD pipeline enforces test-before-deploy and gated prod promotion.

---

## New / Modified Files

- `src/db/client.ts` — modified: non-local mode fetches Secrets Manager then generates RDS IAM auth token via `@aws-sdk/rds-signer`; local mode reads `DATABASE_URL` from env; singleton PrismaClient exported
- `.github/workflows/ci.yml` — full pipeline from lint to prod deploy
- `.github/workflows/migrate.yml` — dedicated migration workflow using `migrations-db-user`
- `infra/terraform/envs/dev/main.tf` — CloudWatch alarms added (DLQ depth + Lambda errors); `aws_secretsmanager_secret` for `pixicred-dev-secrets`
- `infra/terraform/envs/prod/main.tf` — same additions for prod
- `README.md` — architecture overview, local setup, test commands, deployment steps

---

## Behavior

### `src/db/client.ts` — Secrets Manager + RDS IAM auth

```typescript
let databaseUrl: string;
if (process.env.ENVIRONMENT !== 'local') {
  const sm = new SecretsManagerClient({ region: process.env.AWS_REGION });
  const secret = await sm.send(new GetSecretValueCommand({
    SecretId: `pixicred-${process.env.ENVIRONMENT}-secrets`
  }));
  const { DB_HOST, DB_PORT, DB_NAME, DB_IAM_USER } = JSON.parse(secret.SecretString!);

  const signer = new Signer({
    hostname: DB_HOST, port: Number(DB_PORT),
    region: process.env.AWS_REGION!, username: DB_IAM_USER,
  });
  const token = await signer.getAuthToken();
  databaseUrl = `postgresql://${DB_IAM_USER}:${encodeURIComponent(token)}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=require`;
} else {
  databaseUrl = process.env.DATABASE_URL!;
}
export const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
```

Token is valid 15 minutes — sufficient for Lambda cold-start lifetime. `migrations-db-user` URL is never used here.

### `.github/workflows/ci.yml` — pipeline jobs

```
lint-typecheck  → prisma generate + tsc --noEmit + eslint
unit-test       → vitest run
build           → scripts/build.sh + upload dist/ artifact
deploy-dev      → terraform apply (dev environment)  [auto]
integration-test → HTTP tests against dev API
approve-prod    → environment: prod-approval  [manual reviewer gate]
migrate-prod    → prisma migrate deploy (prod) via migrate.yml reuse
deploy-prod     → terraform apply (prod environment)
```

All jobs use `environment: dev` or `environment: prod` secrets for `AWS_ROLE_ARN`. `AWS_REGION` is repo-level.

### `.github/workflows/migrate.yml` — migration workflow

Triggers on push when `prisma/migrations/**` or `prisma/schema.prisma` changes, or via `workflow_dispatch` with `environment` input (`dev` | `prod`).

Steps:
1. Checkout
2. `aws-actions/configure-aws-credentials` using the target environment's `AWS_ROLE_ARN`
3. Fetch `MIGRATIONS_DATABASE_URL` from `pixicred-{env}-secrets` via AWS CLI
4. `DATABASE_URL=$MIGRATIONS_DATABASE_URL npx prisma migrate deploy`
5. Sync `prisma/migrations/` to `s3://pixicred-{env}-migrations/` as audit trail

`migrations-db-user` (password-based) is used. IAM auth is never used for migrations.

### CloudWatch alarms (Terraform)

- **DLQ-depth alarm** per DLQ: `ApproximateNumberOfMessagesVisible > 0` for 1 evaluation period → `pixicred-{env}-alerts` SNS topic
- **Lambda-error alarm** for service + 4 consumer Lambdas: `Errors > 5` in 5 minutes → alerts topic

---

## Exact Test Cases

### `tests/db/client.test.ts`
```
test('db client reads DATABASE_URL from process.env when ENVIRONMENT is local')
test('db client fetches DB_HOST/DB_PORT/DB_NAME/DB_IAM_USER from Secrets Manager when ENVIRONMENT is not local')
test('db client generates RDS IAM auth token via rds-signer and constructs DATABASE_URL with encoded token')
```

### Terraform validation (shell)
```
terraform -chdir=infra/terraform/envs/dev validate
terraform -chdir=infra/terraform/envs/prod validate
```

---

## Done When
- [ ] `src/db/client.ts` generates IAM token in non-local mode; local mode uses env `DATABASE_URL`; both branches covered by test
- [ ] `ci.yml` pipeline runs end-to-end on push to main; `prod-approval` environment gates the prod deploy
- [ ] `migrate.yml` fetches `MIGRATIONS_DATABASE_URL` from Secrets Manager; runs `prisma migrate deploy`; syncs migrations to S3
- [ ] CloudWatch DLQ-depth alarms on all 4 DLQs; Lambda-error alarms on service + 4 consumers
- [ ] `infra/terraform/envs/dev` and `prod` pass `terraform validate` with alarms included
- [ ] Post-Terraform DB user setup complete: `pixicred_app` (IAM) and `migrations-db-user` (password) exist in RDS
- [ ] `README.md` covers local setup, test commands, and deployment instructions
- [ ] Spec status updated to ✅ Implemented
- [ ] IMPLEMENTATION_PLAN.md Phase 8 row marked complete
