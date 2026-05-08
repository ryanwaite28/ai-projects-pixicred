# PixiCred — Pre-Implementation Plan
> Everything that must exist **before** Phase 0 code is written. Run `scripts/bootstrap.sh` to automate the majority of this checklist. Read this document at the start of the very first implementation session and again before Phase 8 (DevOps & Hardening).

---

## Decisions Made

| Decision | Value | Rationale |
|---|---|---|
| AWS CLI profile name | `rmw-llc` | Shared SSO profile for the portfolio AWS account; hardcoded in all Terraform provider blocks and shell scripts |
| GitHub Actions auth | OIDC (no long-lived keys) | Preferred security posture; no rotating secrets; role scoped to this repo only |
| GitHub Actions IAM role | `pixicred-github-actions` | Dedicated role with `AdministratorAccess` (portfolio simplicity; can be tightened) |
| GitHub repo | `ryanwaite28/ai-projects-pixicred` | Source of truth for OIDC trust policy sub condition |
| AWS region | `us-east-1` | All resources; ACM certificates for API Gateway must also be in `us-east-1` |
| SES sender (primary) | `no-reply@pixicred.com` | FR-EMAIL-06; covered by verified domain identity `pixicred.com` |
| SES sender (alt) | `pixicred@modernappsllc.com` | Additional verified email identity; usable as a from-address |
| Custom API domain | `api.dev.pixicred.com`, `api.pixicred.com` | Deferred to Phase 8; API Gateway auto-URL works for all earlier phases |

---

## Local Toolchain Prerequisites

Install these before running anything:

| Tool | Version | Install |
|---|---|---|
| Node.js | 20+ | `nvm install 20` |
| Docker + Docker Compose | latest | https://docs.docker.com/get-docker/ |
| AWS CLI v2 | latest | https://aws.amazon.com/cli/ |
| Terraform | 1.7+ | https://developer.hashicorp.com/terraform/install |
| GitHub CLI (`gh`) | latest | https://cli.github.com |

---

## AWS CLI Profile Setup (one-time, manual)

The `rmw-llc` profile must point to AWS account `408141212087`. Two options:

### Option A — AWS SSO (recommended)

```bash
aws configure sso --profile rmw-llc
# Follow prompts:
#   SSO session name: rmw-llc-session
#   SSO start URL:    https://<your-org>.awsapps.com/start
#   SSO region:       us-east-1
#   Account:          408141212087
#   Role:             AdministratorAccess (or equivalent)
```

Refresh when token expires:
```bash
aws sso login --profile rmw-llc
```

### Option B — Static IAM credentials

```bash
aws configure --profile rmw-llc
# AWS Access Key ID:     <from IAM user>
# AWS Secret Access Key: <from IAM user>
# Default region:        us-east-1
```

**Verify before running bootstrap.sh:**
```bash
aws sts get-caller-identity --profile rmw-llc
# Expected: { "Account": "408141212087", ... }
```

---

## `scripts/bootstrap.sh` — What It Automates

Run once (safe to re-run — all steps are idempotent):

```bash
chmod +x scripts/bootstrap.sh
./scripts/bootstrap.sh
```

### Steps performed by bootstrap.sh

| Step | Resource(s) Created | Notes |
|---|---|---|
| 1 | Pre-flight checks | Verifies AWS CLI, Terraform, Node, Docker, gh CLI |
| 2 | AWS profile validation | Confirms profile `rmw-llc` authenticates to account `408141212087` |
| 3 | `.env` file | Copies `.env.example` → `.env` if not already present |
| 4 | Terraform state S3 buckets | `pixicred-dev-tf-state`, `pixicred-prod-tf-state` (versioning + AES-256 encryption) |
| 5 | Terraform state DynamoDB tables | `pixicred-dev-tf-locks`, `pixicred-prod-tf-locks` (PAY_PER_REQUEST) |
| 6 | Migrations audit trail S3 buckets | `pixicred-dev-migrations`, `pixicred-prod-migrations` (versioning + encryption) |
| 7 | GitHub Actions OIDC provider | `token.actions.githubusercontent.com` in IAM (idempotent) |
| 8 | GitHub Actions IAM role | `pixicred-github-actions` with `AdministratorAccess`; trust scoped to `ryanwaite28/ai-projects-pixicred` |
| 9 | GitHub environment secret `AWS_ROLE_ARN` | Set per-environment (`dev`, `prod`, `prod-approval`) via `gh secret set --env` |
| 10 | GitHub repo secret `AWS_REGION` | Set via `gh secret set` (same value for all environments) |
| 11 | GitHub environments `dev`, `prod`, `prod-approval` | Created via `gh api`; `prod` and `prod-approval` require manual reviewer setup; `prod-approval` is the approval gate for downstream prod jobs |
| 12 | Secrets Manager secrets | `pixicred-dev-secrets`, `pixicred-prod-secrets` with placeholder `DATABASE_URL` |
| 13 | SES domain identity | `pixicred.com` domain identity created; DKIM records printed |

> **Note on Terraform state bootstrap**: `bootstrap.sh` uses the AWS CLI directly (not the `infra/terraform/bootstrap/` Terraform module) because the module doesn't exist until Phase 0 scaffold is written. The Terraform module serves as the auditable, version-controlled record of what bootstrap.sh provisioned. After Phase 0 is complete, the module can be imported to bring bootstrap resources under Terraform management if desired.

---

## Pre-Provisioned Infrastructure

The following resources were provisioned manually before Phase 0 and are **already live**. Do not re-create them. `bootstrap.sh` verifies their existence and skips creation.

### Route 53

| Resource | Value | Status |
|---|---|---|
| Hosted Zone | `pixicred.com.` | ✅ Active |
| Hosted Zone ID | `Z0511624US25VOVRIJF3` | — |
| NS delegation | Registrar NS records updated | ✅ Complete |
| Existing records | MX, TXT, and all prior records migrated from registrar | ✅ Complete |

Name servers (for reference — already set at registrar):
```
ns-1902.awsdns-45.co.uk
ns-1058.awsdns-04.org
ns-11.awsdns-01.com
ns-878.awsdns-45.net
```

Verify delegation at any time:
```bash
dig NS pixicred.com +short
```

### ACM Certificates

Both certificates cover the apex domain (`pixicred.com`) and wildcard (`*.pixicred.com`). All DNS validation records are in Route 53. Certificates must be in `us-east-1` for API Gateway.

| Environment | ARN | Status |
|---|---|---|
| dev | `arn:aws:acm:us-east-1:408141212087:certificate/09299ef4-d8c9-4e84-b0d1-442dc3ef91ad` | ✅ Issued |
| prod | `arn:aws:acm:us-east-1:408141212087:certificate/856c4408-d285-4df3-b694-65d4aef299ba` | ✅ Issued |

### SES Identities

| Identity | ARN | Status |
|---|---|---|
| Domain `pixicred.com` | `arn:aws:ses:us-east-1:408141212087:identity/pixicred.com` | ✅ Verified |
| Email `pixicred@modernappsllc.com` | `arn:aws:ses:us-east-1:408141212087:identity/pixicred@modernappsllc.com` | ✅ Verified |

The domain identity covers sending from any `@pixicred.com` address (including `no-reply@pixicred.com`). DKIM records and all SES DNS records are in Route 53.

---

## Post-Bootstrap Manual Steps

These cannot be automated and must be completed by hand:

### ~~1. Add SES DKIM DNS records~~ — ✅ Complete

SES domain identity `pixicred.com` is verified. DKIM and all related DNS records are in Route 53. No action needed.

### 2. Add required reviewers to the GitHub `prod-approval` environment

bootstrap.sh creates all three environments (`dev`, `prod`, `prod-approval`) but cannot set protection rules via the CLI. Only `prod-approval` needs required reviewers:
- GitHub repo → Settings → Environments → `prod-approval` → Required reviewers → add yourself

`prod-approval` is the single approval gate for all prod work. Approve once there; every downstream prod job then runs automatically against the `prod` environment without additional prompts. `prod` itself has no required reviewers.

### 3. Request SES production access (required to send to unverified recipients)

By default, new AWS accounts are in SES sandbox mode. In sandbox mode, you can only send to verified email addresses. For a portfolio project where you control all test recipient addresses, sandbox mode may be acceptable — just verify your test email addresses:

```bash
aws sesv2 create-email-identity \
  --email-identity your-test-email@gmail.com \
  --region us-east-1 \
  --profile rmw-llc
# Click the verification link in the email AWS sends
```

To send to arbitrary recipients (required for production use):
- AWS Console → SES → Account dashboard → Request production access
- Typically approved within 24 hours

### 4. Set up GitHub CLI authentication (required for bootstrap.sh steps 9–11)

```bash
gh auth login
# Follow prompts → GitHub.com → HTTPS → authenticate via browser
```

If `gh` is not installed, add the GitHub secrets manually:
- Repo Settings → Environments → create `dev`, `prod`, `prod-approval`; for each environment add:
  - `AWS_ROLE_ARN` = `arn:aws:iam::408141212087:role/pixicred-github-actions`
- Repo Settings → Secrets and variables → Actions → New repository secret:
  - `AWS_REGION` = `us-east-1`

---

## Ordering: Bootstrap → Phase 0 → Phase 8

```
BEFORE Phase 0:
  1. Install local toolchain (Node 20, Docker, AWS CLI, Terraform, gh)
  2. Configure AWS CLI profile 'rmw-llc'
  3. Run: ./scripts/bootstrap.sh
  4. Complete post-bootstrap manual steps (SES DNS, GitHub env reviewer)
  5. Verify: aws sts get-caller-identity --profile rmw-llc

Phase 0 — scaffold code (see specs/00-scaffold.md):
  • Writes infra/terraform/bootstrap/ Terraform module (for auditability)
  • Writes infra/terraform/envs/dev|prod/ (empty placeholders)
  • Writes esbuild.config.ts, Dockerfile, docker-compose.yml, etc.
  • Does NOT run terraform apply on env modules yet

Phases 1–7 — domain implementation:
  • All AWS infrastructure provisioning is deferred
  • Local development uses docker-compose + MiniStack only
  • No real AWS resources needed beyond what bootstrap.sh created

Phase 8 — DevOps & Hardening (see specs/10-infrastructure.md):
  • Run: terraform init && terraform apply on infra/terraform/envs/dev/
  • After terraform apply: update Secrets Manager DATABASE_URL (see below)
  • Run: prisma migrate deploy against dev RDS
  • Configure custom domain (optional, see below)
```

---

## Post-Terraform (Phase 8) Steps

These are only relevant during Phase 8 when the full AWS infrastructure is provisioned.

### Update Secrets Manager after RDS provisioning

The application uses **RDS IAM authentication** (no static DB password for the app). The `migrations-db-user` uses a password managed by Secrets Manager. After `terraform apply` completes:

#### Step 1 — Populate Secrets Manager with RDS connection details

```bash
# Get RDS endpoint from Terraform output
RDS_ENDPOINT=$(terraform -chdir=infra/terraform/envs/dev output -raw rds_endpoint)
MIGRATIONS_PASSWORD="<choose-a-strong-password>"

aws secretsmanager put-secret-value \
  --secret-id pixicred-dev-secrets \
  --secret-string "{
    \"DB_HOST\": \"${RDS_ENDPOINT}\",
    \"DB_PORT\": \"5432\",
    \"DB_NAME\": \"pixicred\",
    \"DB_IAM_USER\": \"pixicred_app\",
    \"MIGRATIONS_DATABASE_URL\": \"postgresql://migrations-db-user:${MIGRATIONS_PASSWORD}@${RDS_ENDPOINT}:5432/pixicred?sslmode=require\",
    \"JWT_SECRET\": \"<generate-with: openssl rand -hex 32>\"
  }" \
  --region us-east-1 \
  --profile rmw-llc
```

Repeat for `pixicred-prod-secrets` after the prod Terraform apply.

#### Step 2 — Create PostgreSQL database users (run once per environment)

Connect to RDS as the master user (Terraform outputs the master username/password or it is in Secrets Manager via Terraform):

```sql
-- IAM-authenticated app user (no password — auth via RDS IAM token)
CREATE USER pixicred_app;
GRANT rds_iam TO pixicred_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pixicred_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pixicred_app;

-- Migrations user (password-based; Secrets Manager manages the password)
CREATE USER "migrations-db-user" WITH PASSWORD '<same password used in MIGRATIONS_DATABASE_URL>';
GRANT ALL PRIVILEGES ON DATABASE pixicred TO "migrations-db-user";
GRANT ALL PRIVILEGES ON SCHEMA public TO "migrations-db-user";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO "migrations-db-user";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO "migrations-db-user";
```

`pixicred_app` is for runtime reads/writes only (no DDL). `migrations-db-user` has full DDL and is used exclusively by the `migrate.yml` CI/CD workflow.

### Custom API domain setup (optional, Phase 8)

To use `api.dev.pixicred.com` and `api.pixicred.com`:

1. **Route 53 hosted zone** — ✅ already provisioned (`Z0511624US25VOVRIJF3`); NS delegation complete.
2. **ACM certificates** — ✅ already issued (see Pre-Provisioned Infrastructure above); both dev and prod certs cover `pixicred.com` and `*.pixicred.com` in `us-east-1`. Reference these ARNs in Terraform — do not request new certs.
3. **API Gateway custom domain** — wired in Terraform env modules during Phase 8; Terraform will create Route 53 A/CNAME alias records automatically.

If skipping custom domain, API Gateway provides a URL like `https://{id}.execute-api.us-east-1.amazonaws.com` and no further setup is needed.

---

## Verification Checklist

Run this before starting Phase 0 to confirm bootstrap completed correctly:

```bash
# AWS profile works
aws sts get-caller-identity --profile rmw-llc

# Terraform state S3 buckets exist
aws s3 ls s3://pixicred-dev-tf-state --profile rmw-llc
aws s3 ls s3://pixicred-prod-tf-state --profile rmw-llc

# Terraform DynamoDB lock tables exist
aws dynamodb describe-table --table-name pixicred-dev-tf-locks --profile rmw-llc --query 'Table.TableStatus'
aws dynamodb describe-table --table-name pixicred-prod-tf-locks --profile rmw-llc --query 'Table.TableStatus'

# Migrations S3 buckets exist
aws s3 ls s3://pixicred-dev-migrations --profile rmw-llc
aws s3 ls s3://pixicred-prod-migrations --profile rmw-llc

# OIDC provider exists
aws iam list-open-id-connect-providers --profile rmw-llc | grep token.actions.githubusercontent.com

# GitHub Actions IAM role exists
aws iam get-role --role-name pixicred-github-actions --profile rmw-llc --query 'Role.Arn'

# Secrets Manager secrets exist
aws secretsmanager describe-secret --secret-id pixicred-dev-secrets --profile rmw-llc --query 'Name'
aws secretsmanager describe-secret --secret-id pixicred-prod-secrets --profile rmw-llc --query 'Name'

# SES domain identity exists and verified
aws sesv2 get-email-identity --email-identity pixicred.com --profile rmw-llc --query 'VerifiedForSendingStatus'
# Expected: "true"

# SES email identity exists
aws sesv2 get-email-identity --email-identity pixicred@modernappsllc.com --profile rmw-llc --query 'VerifiedForSendingStatus'
# Expected: "true"

# Route 53 hosted zone exists (Z0511624US25VOVRIJF3)
aws route53 get-hosted-zone --id Z0511624US25VOVRIJF3 --profile rmw-llc --query 'HostedZone.Name'
# Expected: "pixicred.com."

# ACM certificate (dev) issued
aws acm describe-certificate \
  --certificate-arn arn:aws:acm:us-east-1:408141212087:certificate/09299ef4-d8c9-4e84-b0d1-442dc3ef91ad \
  --profile rmw-llc --query 'Certificate.Status'
# Expected: "ISSUED"

# ACM certificate (prod) issued
aws acm describe-certificate \
  --certificate-arn arn:aws:acm:us-east-1:408141212087:certificate/856c4408-d285-4df3-b694-65d4aef299ba \
  --profile rmw-llc --query 'Certificate.Status'
# Expected: "ISSUED"

# Local .env exists
test -f .env && echo ".env: OK" || echo ".env: MISSING — run bootstrap.sh"
```

All commands should return without errors before proceeding to Phase 0.

---

## Terraform Provider Block Reference

All Terraform modules must use this provider configuration:

```hcl
provider "aws" {
  region  = "us-east-1"
  profile = "rmw-llc"

  default_tags {
    tags = {
      Project     = "pixicred"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
```

The `profile = "rmw-llc"` line is non-negotiable — do not use `default`, `pixicred`, or any other profile name.

---

## GitHub Actions Workflow Reference

### Environment structure

| Environment | Purpose | Has `AWS_ROLE_ARN` | Requires approval |
|---|---|---|---|
| `dev` | Dev deploys | ✅ (env-level secret) | No |
| `prod-approval` | Single approval gate — approve here once, all downstream prod jobs run | ✅ (env-level secret) | ✅ Yes |
| `prod` | Prod deploys — runs automatically after prod-approval is approved | ✅ (env-level secret) | No |

`AWS_ROLE_ARN` is an **environment-level** secret. `AWS_REGION` is a **repo-level** secret (same value for all environments).

### Workflow pattern

All GitHub Actions workflows that need AWS access must use:

```yaml
permissions:
  id-token: write   # required for OIDC token generation
  contents: read

jobs:
  deploy:
    environment: dev   # or prod — AWS_ROLE_ARN is resolved from the environment's secrets
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}   # environment-level
          aws-region: ${{ secrets.AWS_REGION }}          # repo-level
```

For prod deploys, reference `prod-approval` first to gate the release:

```yaml
jobs:
  approve:
    environment: prod-approval   # pauses here for reviewer approval

  deploy:
    needs: approve
    environment: prod
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: ${{ secrets.AWS_REGION }}
```

The `id-token: write` permission is mandatory for OIDC — without it, the token cannot be generated and the assume-role call will fail.
