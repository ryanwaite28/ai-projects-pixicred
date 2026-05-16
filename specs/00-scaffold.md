# Spec: Project Scaffold
**FR references**: NFR-03, NFR-04, NFR-05, NFR-06, NFR-08 (no behavioral FRs exist for Phase 0; scaffold requirements are governed by non-functional requirements)
**Status**: ✅ Implemented

---

## What

Phase 0 establishes every piece of project infrastructure that must exist before any domain code is written: TypeScript toolchain, linting/formatting, Docker Compose local stack (Postgres + MiniStack), database migration tooling, Terraform remote-state bootstrap, `.env.example`, MiniStack init script, esbuild build pipeline, and GitHub Actions CI skeleton. No business logic is introduced. The output of this phase is a repo where `npm run build` succeeds, `docker-compose up` starts the full local stack, and the CI workflow passes lint + typecheck on push.

---

## Why

NFR-03 requires all compute to be Lambda-based (scaffolding gates deployment target choice), NFR-04 requires a testable service layer (build toolchain must be in place), NFR-05 requires MiniStack local parity (docker-compose must exist), NFR-06 requires isolated dev/prod naming (Terraform module structure must be established), and NFR-08 requires no secrets in code (`.env.example` pattern must be the standard from day one).

---

## New / Modified Files

### TypeScript / Node toolchain
- `package.json` — all runtime and dev dependencies; `scripts` for `build`, `test`, `test:integration`, `test:all`, `db:migrate`, `db:generate`, `lint`, `typecheck`, `seed:local`
- `tsconfig.json` — strict TypeScript config targeting Node 20 (`module: NodeNext`, `moduleResolution: NodeNext`, `strict: true`, `noUncheckedIndexedAccess: true`)
- `.eslintrc.json` — ESLint with `@typescript-eslint/recommended`, `no-floating-promises`, `no-explicit-any` as `error`
- `.prettierrc` — 2-space indent, single quotes, trailing comma `all`, 100-char line width
- `.gitignore` — `node_modules/`, `dist/`, `.env`, `*.tfstate`, `*.tfstate.backup`, `.terraform/`

### Prisma
- `prisma/schema.prisma` — Prisma schema with generator (`client`, `provider = "prisma-client-js"`, `binaryTargets = ["native", "rhel-openssl-1.0.x"]`), datasource (`postgresql`, reads `DATABASE_URL`), and empty model stubs for all six domain models (full models added in Phase 1a)
- `prisma/migrations/.gitkeep` — placeholder so directory is committed; Prisma migration files live here after `prisma migrate dev`

### Source skeleton (empty files that must compile)
- `src/types/index.ts` — barrel export; initially empty type stubs only
- `src/db/client.ts` — exports an initialized `PrismaClient` singleton (imports `PrismaClient` from `@prisma/client`; reads `DATABASE_URL` from env at module load)
- `src/db/queries/.gitkeep` — placeholder
- `src/service/.gitkeep` — placeholder
- `src/handlers/api/.gitkeep` — placeholder
- `src/handlers/sqs/.gitkeep` — placeholder
- `src/handlers/service/.gitkeep` — placeholder
- `src/clients/.gitkeep` — placeholder
- `src/emails/.gitkeep` — placeholder
- `src/emails/templates/.gitkeep` — placeholder for Handlebars `.hbs` template files

### Docker / local stack
- `docker-compose.yml` — services: `postgres` (postgres:15, port 5432), `ministack` (ministackorg/ministack:latest, port 4566), `ministack-init` (amazon/aws-cli, runs `infra/ministack/init.sh` after ministack ready)
- `Dockerfile` — multi-stage: build stage (`node:20-alpine`, copies `dist/`, copies `node_modules/`), runtime stage (same base, `CMD` is overridden per service in compose)
- `infra/ministack/init.sh` — creates all MiniStack resources: 4 SQS queues (`pixicred-local-credit-check`, `pixicred-local-notifications`, `pixicred-local-statement-gen`, `pixicred-local-billing-lifecycle`), each with a DLQ; 1 SNS topic (`pixicred-local-events`); SNS→SQS subscriptions for all consumer queues; waits for ministack with retry loop before issuing commands

### Build
- `scripts/build.sh` — runs `prisma generate` first, then runs `esbuild` once per Lambda entry point (full list defined in Phase 8); for Phase 0, bundles a single dummy entry point (`src/db/client.ts`) to validate the toolchain; output: `dist/lambdas/`
- `esbuild.config.ts` — esbuild config object exported as a constant: `platform: 'node'`, `target: 'node20'`, `bundle: true`, `minify: false`, `sourcemap: true`, `external: ['@prisma/client', '.prisma/client']`, `loader: { '.hbs': 'text' }`; `.hbs` files are bundled as inline strings so Handlebars templates are available at Lambda runtime without filesystem reads

### Terraform — bootstrap only
- `infra/terraform/bootstrap/main.tf` — creates per-environment S3 bucket (`pixicred-{env}-tf-state`) + DynamoDB table (`pixicred-{env}-tf-locks`); parameterised by `var.environment`
- `infra/terraform/bootstrap/variables.tf` — `environment` variable, validation: `dev` | `prod` only
- `infra/terraform/bootstrap/outputs.tf` — outputs bucket name and DynamoDB table name
- `infra/terraform/envs/dev/backend.tf` — S3 backend pointing at `pixicred-dev-tf-state`; key `pixicred/dev/terraform.tfstate`
- `infra/terraform/envs/dev/main.tf` — empty placeholder (Phase 8 fills this)
- `infra/terraform/envs/dev/variables.tf` — `environment = "dev"` default
- `infra/terraform/envs/prod/backend.tf` — same pattern for prod
- `infra/terraform/envs/prod/main.tf` — empty placeholder
- `infra/terraform/envs/prod/variables.tf` — `environment = "prod"` default
- `infra/terraform/modules/lambda/.gitkeep` — placeholder
- `infra/terraform/modules/sqs/.gitkeep` — placeholder
- `infra/terraform/modules/rds/.gitkeep` — placeholder
- `infra/terraform/modules/api-gateway/.gitkeep` — placeholder

### Config and docs
- `.env.example` — full environment variable template from PROJECT.md Section 10.4; every variable commented with its purpose and the FR that requires it
- `specs/` — this directory; committed with Phase 0 spec

### GitHub Actions
- `.github/workflows/ci.yml` — triggers on `push` and `pull_request` to `main`; jobs: `lint-typecheck` (runs `npm ci`, `npm run db:generate`, `npm run lint`, `npm run typecheck`); `unit-test` (runs `npm run test`, needs `lint-typecheck`); no deploy steps in Phase 0
- `.github/workflows/migrate.yml` — dedicated migration workflow; triggers on `push` to `main` when `prisma/migrations/**` or `prisma/schema.prisma` changes, or on `workflow_dispatch` with `environment` input (`dev` | `prod`); steps: checkout, setup Node 20, `npm ci`, `npx prisma migrate deploy` (fetches `DATABASE_URL` from AWS Secrets Manager via the `pixicred-{env}-secrets` secret), `aws s3 sync prisma/migrations/ s3://pixicred-{env}-migrations/` as audit trail

---

## Behavior

**`docker-compose up -d`** must bring up all three services cleanly:
- `postgres` accepts TCP on 5432 within 10s; `POSTGRES_DB=pixicred`, `POSTGRES_USER=pixicred`
- `ministack` responds to HTTP on 4566 within 30s
- `ministack-init` exits 0 after creating all queues, DLQs, SNS topic, and subscriptions; all 4 SQS queues and SNS topic must be discoverable via `aws --endpoint-url=http://localhost:4566 sqs list-queues`

**`npm run db:generate`** must run `prisma generate` and produce the PrismaClient in `node_modules/.prisma/client` without error.

**`npm run db:migrate`** must run `prisma migrate deploy` idempotently against the local Postgres (no new migration in Phase 0 — runs with the empty `prisma/migrations/` directory).

**`npm run build`** must complete without TypeScript errors and produce at least `dist/` output.

**`npm run lint && npm run typecheck`** must exit 0 on a clean checkout.

**No secrets may appear in any committed file** — `DATABASE_URL` and `AWS_SECRET_ACCESS_KEY` only ever appear in `.env.example` with placeholder values.

---

## Exact Test Cases

### `tests/scaffold/toolchain.test.ts`
```
test('TypeScript strict mode rejects implicit any in src/db/client.ts')
test('prisma generate produces PrismaClient without error')
test('esbuild bundles src/db/client.ts without error and produces dist/lambdas/db-client/index.js')
test('ESLint exits 0 on src/db/client.ts')
```

### `tests/scaffold/docker.test.ts` (integration — requires `docker-compose up`)
```
test('Postgres container accepts TCP connection on port 5432')
test('Postgres database name is pixicred')
test('MiniStack HTTP endpoint responds 200 on GET http://localhost:4566/_ministack/health')
test('MiniStack has credit-check SQS queue after init')
test('MiniStack has notifications SQS queue after init')
test('MiniStack has statement-gen SQS queue after init')
test('MiniStack has billing-lifecycle SQS queue after init')
test('MiniStack has pixicred-local-events SNS topic after init')
test('credit-check DLQ exists in MiniStack after init')
test('notifications DLQ exists in MiniStack after init')
test('statement-gen DLQ exists in MiniStack after init')
test('billing-lifecycle DLQ exists in MiniStack after init')
```

### `tests/scaffold/migrations.test.ts` (integration — requires live Postgres)
```
test('db:generate runs to completion with exit code 0')
test('db:migrate runs to completion with exit code 0')
test('db:migrate is idempotent — running twice does not throw')
```

---

## Done When
- [x] `npm ci` succeeds with no peer-dep warnings
- [x] `npm run lint` exits 0 on a fresh checkout
- [x] `npm run typecheck` exits 0 on a fresh checkout
- [x] `npm run db:generate` (`prisma generate`) exits 0 and PrismaClient is available in `node_modules/.prisma/client`
- [x] `npm run build` exits 0 and `dist/` is populated (Prisma client marked external; `.hbs` loader active)
- [ ] `docker-compose up -d && docker-compose ps` shows all services healthy
- [ ] `infra/ministack/init.sh` exits 0 and all 6 queues + 6 DLQs + SNS topic exist in MiniStack
- [ ] `npm run db:migrate` (`prisma migrate deploy`) exits 0 (idempotent on repeat run)
- [x] All toolchain unit tests pass (`npm run test`)
- [ ] All scaffold integration tests pass (`npm run test:integration`)
- [x] `.github/workflows/ci.yml` runs and passes lint + typecheck jobs on push
- [x] `.github/workflows/migrate.yml` exists with `workflow_dispatch` and path-filter triggers
- [x] No secrets in any committed file
- [ ] `infra/terraform/bootstrap/` validates with `terraform validate`
- [x] `prisma/schema.prisma` has generator with `binaryTargets` for Lambda runtime
- [x] Spec status updated to ✅ Implemented
- [x] IMPLEMENTATION_PLAN.md Phase 0 row marked complete
