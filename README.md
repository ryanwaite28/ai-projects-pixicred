# PixiCred

Serverless credit card lending platform. Angular SPA frontend, TypeScript Lambda backend, PostgreSQL via Prisma ORM, AWS infrastructure managed by Terraform.

---

## Architecture

```
Browser (Angular SPA — pixicred.com)
  → CloudFront → S3 (static assets)
  → API Gateway v2 (api.pixicred.com)
      → API Lambda (thin dispatch — shape validation only)
          → Service Lambda (all business logic)
              ├── PostgreSQL via Prisma ORM (RDS IAM auth)
              └── SNS → SQS → Consumer Lambdas
                    (credit-check, notification, statement-gen, billing-lifecycle)
```

AWS account: `408141212087`. Environments: `dev` and `prod`, isolated by `pixicred-{env}-` name prefix and `Project=pixicred` tag.

---

## Prerequisites

- Node.js 20+
- Docker (for local Postgres and MiniStack)
- AWS CLI configured with profile `rmw-llc`
- Terraform 1.15+
- Angular CLI (`npm install -g @angular/cli`)

---

## Local Setup

### 1. Install dependencies

```bash
npm ci
cd frontend && npm ci && cd ..
```

### 2. Generate Prisma client

```bash
npm run db:generate
```

### 3. Start local services (MiniStack + Postgres)

```bash
docker compose up -d
```

### 4. Apply migrations

```bash
npm run db:migrate
```

### 5. Seed local data (optional)

```bash
npx tsx scripts/seed-local.ts
```

### 6. Start backend API server

```bash
npm run local:api
```

### 7. Start async worker

```bash
npm run local:worker
```

### 8. Start Angular dev server

```bash
cd frontend && npx ng serve
```

Frontend available at `http://localhost:4200`. Backend API at `http://localhost:3000`.

---

## Environment Variables (local)

Copy `.env.example` to `.env` and fill in values:

```
ENVIRONMENT=local
DATABASE_URL=postgresql://pixicred:pixicred_local@localhost:5432/pixicred
JWT_SECRET=local-dev-secret
AWS_REGION=us-east-1
MINISTACK_ENDPOINT=http://localhost:4566
```

---

## Testing

### Unit tests (backend)

```bash
npm test
```

### Integration tests (requires Docker)

```bash
npm run test:integration
```

### Frontend lint + build

```bash
cd frontend && npx ng lint && npx ng build --configuration=production
```

### Type check

```bash
npm run typecheck
```

---

## Deployment

### Bootstrap (one-time, before first `terraform apply`)

```bash
chmod +x scripts/bootstrap.sh
./scripts/bootstrap.sh
```

This provisions: Terraform state S3 buckets + DynamoDB lock tables, GitHub Actions OIDC provider + IAM role, Secrets Manager secrets (placeholder values), and SES domain identity.

After running, complete the manual steps printed by the script (DNS records, GitHub environment reviewers, RDS secret population).

### CI/CD pipeline

Push to `main` triggers the full pipeline:

```
lint-typecheck → ng-lint-build → unit-test → build-backend
  → deploy-dev → deploy-frontend-dev → integration-test
  → approve-prod (manual gate)
  → migrate-prod → deploy-prod → deploy-frontend-prod
```

### Manual migration

```bash
# dev
gh workflow run migrate.yml -f environment=dev

# prod (requires approval gate)
gh workflow run migrate.yml -f environment=prod
```

### Manual Terraform apply (local)

```bash
# dev
cd infra/terraform/envs/dev
terraform init
terraform apply \
  -var="vpc_id=<VPC_ID>" \
  -var="subnet_ids=<SUBNET_IDS>" \
  -var="db_password=<DB_PASSWORD>" \
  -var="acm_certificate_arn=<ACM_CERT_ARN>"
```

---

## Key Scripts

| Script | Purpose |
|---|---|
| `npm run db:generate` | Generate Prisma client from schema |
| `npm run db:migrate` | Apply pending migrations locally |
| `npm run db:studio` | Open Prisma Studio |
| `npm run build` | Build all Lambda bundles via esbuild |
| `npm test` | Run unit tests |
| `npm run test:integration` | Run integration tests with Testcontainers |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript type check |

---

## Secrets

All runtime secrets live in AWS Secrets Manager under `pixicred-{env}-secrets`. Keys: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_IAM_USER`, `JWT_SECRET`, `MIGRATIONS_DATABASE_URL`.

No secrets are stored in source control or environment files.
