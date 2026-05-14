#!/usr/bin/env bash
# PixiCred bootstrap.sh
# Provisions foundation-level resources for:
#   --local   MiniStack (localhost:4566) for local development
#   (default) Real AWS: Terraform state, OIDC, IAM, Secrets Manager, SES
#
# Safe to re-run — every step is idempotent.
# See PRE_IMPLEMENTATION_PLAN.md for full context and post-bootstrap manual steps.
#
# Usage:
#   ./scripts/bootstrap.sh                     # production AWS mode
#   ./scripts/bootstrap.sh --local             # local MiniStack mode
#   ./scripts/bootstrap.sh --local --no-lambdas  # skip Lambda build/deploy

set -euo pipefail

# ── Flags ───────────────────────────────────────────────────────────────────────
LOCAL_MODE=false
NO_LAMBDAS=false
for arg in "$@"; do
  case "$arg" in
    --local)       LOCAL_MODE=true ;;
    --no-lambdas)  NO_LAMBDAS=true ;;
  esac
done

# ── Configuration ──────────────────────────────────────────────────────────────
readonly AWS_PROFILE="rmw-llc"
readonly AWS_REGION="us-east-1"
readonly AWS_ACCOUNT="408141212087"
readonly GITHUB_REPO="ryanwaite28/ai-projects-pixicred"
readonly OIDC_HOST="token.actions.githubusercontent.com"
readonly OIDC_ARN="arn:aws:iam::${AWS_ACCOUNT}:oidc-provider/${OIDC_HOST}"
readonly ROLE_NAME="pixicred-github-actions"
readonly ROLE_ARN="arn:aws:iam::${AWS_ACCOUNT}:role/${ROLE_NAME}"
readonly SES_DOMAIN="pixicred.com"
readonly SES_SENDER="no-reply@pixicred.com"
readonly SES_EMAIL_IDENTITY="pixicred@modernappsllc.com"
readonly HOSTED_ZONE_ID="Z0511624US25VOVRIJF3"
readonly ACM_CERT_ARN_DEV="arn:aws:acm:us-east-1:408141212087:certificate/09299ef4-d8c9-4e84-b0d1-442dc3ef91ad"
readonly ACM_CERT_ARN_PROD="arn:aws:acm:us-east-1:408141212087:certificate/856c4408-d285-4df3-b694-65d4aef299ba"
readonly ENVS=("dev" "prod")
readonly MINISTACK_ENDPOINT="${MINISTACK_ENDPOINT:-http://localhost:4566}"

# ── Output helpers ──────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
info()    { echo -e "${GREEN}[bootstrap]${NC} $*"; }
success() { echo -e "${GREEN}[bootstrap] ✓${NC} $*"; }
warn()    { echo -e "${YELLOW}[bootstrap] WARN:${NC} $*"; }
error()   { echo -e "${RED}[bootstrap] ERROR:${NC} $*" >&2; exit 1; }
step()    { echo -e "\n${BLUE}${BOLD}── $* ──${NC}"; }
banner()  { echo -e "\n${CYAN}${BOLD}$*${NC}"; }

# ── AWS CLI wrappers ─────────────────────────────────────────────────────────────
# Production: named profile → real AWS
aws_cmd() { aws --profile "${AWS_PROFILE}" --region "${AWS_REGION}" "$@"; }

# MiniStack: dummy credentials → localhost
ms() {
  AWS_ACCESS_KEY_ID=test \
  AWS_SECRET_ACCESS_KEY=test \
  AWS_DEFAULT_REGION="${AWS_REGION}" \
  aws --endpoint-url "${MINISTACK_ENDPOINT}" "$@"
}

# ── MiniStack idempotency helpers ────────────────────────────────────────────────
ms_queue_exists()  { ms sqs get-queue-url --queue-name "$1" >/dev/null 2>&1; }
ms_bucket_exists() { ms s3api head-bucket --bucket "$1" >/dev/null 2>&1; }
ms_topic_arn()     { ms sns list-topics --query "Topics[?ends_with(TopicArn,':$1')].TopicArn | [0]" --output text 2>/dev/null; }
ms_secret_exists() { ms secretsmanager describe-secret --secret-id "$1" >/dev/null 2>&1; }

# Updates if exists, creates if not
upsert_secret() {
  local name="$1" value="$2"
  if ms_secret_exists "$name"; then
    ms secretsmanager put-secret-value \
      --secret-id "$name" \
      --secret-string "$value" >/dev/null
    info "Updated secret: ${name}"
  else
    ms secretsmanager create-secret \
      --name "$name" \
      --secret-string "$value" >/dev/null
    info "Created secret: ${name}"
  fi
}

# Creates once; skips on subsequent runs (stable values that shouldn't be overwritten)
create_secret_once() {
  local name="$1" value="$2"
  if ms_secret_exists "$name"; then
    info "Secret ${name}: already exists — skipping"
  else
    ms secretsmanager create-secret \
      --name "$name" \
      --secret-string "$value" >/dev/null
    info "Created secret: ${name}"
  fi
}

# ────────────────────────────────────────────────────────────────────────────────
if [ "${LOCAL_MODE}" = true ]; then
# ════════════════════════════════════════════════════════════════════════════════
#  LOCAL MODE — MiniStack
# ════════════════════════════════════════════════════════════════════════════════

banner "PixiCred Bootstrap — LOCAL (MiniStack)"

# ── Pre-flight ──────────────────────────────────────────────────────────────────
step "Pre-flight checks (local)"

command -v aws    >/dev/null 2>&1 || error "AWS CLI not installed. See https://aws.amazon.com/cli/"
command -v node   >/dev/null 2>&1 || error "Node.js 20+ not installed. Run: nvm install 20"
command -v docker >/dev/null 2>&1 || error "Docker not installed. See https://docs.docker.com/get-docker/"

info "Required tools: OK"

# ── MiniStack health check ───────────────────────────────────────────────────────
step "MiniStack health check"

if ! ms s3 ls >/dev/null 2>&1; then
  error "MiniStack not reachable at ${MINISTACK_ENDPOINT}.\nStart it first: docker-compose up -d ministack"
fi

success "MiniStack is running at ${MINISTACK_ENDPOINT}"

# ── .env setup ──────────────────────────────────────────────────────────────────
step ".env setup"

if [ -f .env ]; then
  info ".env already exists — skipping copy"
else
  if [ ! -f .env.example ]; then
    warn ".env.example not found (Phase 0 scaffold not yet written). Skipping .env creation."
    warn "After Phase 0: cp .env.example .env"
  else
    cp .env.example .env
    info "Created .env from .env.example"
  fi
fi

# ── SQS DLQs ────────────────────────────────────────────────────────────────────
step "SQS Dead-Letter Queues"

readonly QUEUES=("credit-check" "notifications" "statement-gen" "billing-lifecycle")

for QUEUE in "${QUEUES[@]}"; do
  DLQ_NAME="pixicred-local-${QUEUE}-dlq"
  if ms_queue_exists "${DLQ_NAME}"; then
    info "DLQ ${DLQ_NAME}: already exists"
  else
    ms sqs create-queue --queue-name "${DLQ_NAME}" >/dev/null
    info "Created DLQ: ${DLQ_NAME}"
  fi
done

# ── SQS Queues (with redrive to DLQ) ────────────────────────────────────────────
step "SQS Queues"

for QUEUE in "${QUEUES[@]}"; do
  QUEUE_NAME="pixicred-local-${QUEUE}"
  DLQ_NAME="pixicred-local-${QUEUE}-dlq"

  if ms_queue_exists "${QUEUE_NAME}"; then
    info "Queue ${QUEUE_NAME}: already exists"
    continue
  fi

  DLQ_URL=$(ms sqs get-queue-url --queue-name "${DLQ_NAME}" --query 'QueueUrl' --output text)
  DLQ_ARN=$(ms sqs get-queue-attributes \
    --queue-url "${DLQ_URL}" \
    --attribute-names QueueArn \
    --query 'Attributes.QueueArn' \
    --output text)

  REDRIVE_POLICY="{\"deadLetterTargetArn\":\"${DLQ_ARN}\",\"maxReceiveCount\":\"3\"}"

  ms sqs create-queue \
    --queue-name "${QUEUE_NAME}" \
    --attributes "RedrivePolicy=${REDRIVE_POLICY}" \
    >/dev/null

  info "Created queue: ${QUEUE_NAME} (redrive → ${DLQ_NAME})"
done

# ── SNS Topic ───────────────────────────────────────────────────────────────────
step "SNS Topic"

readonly SNS_TOPIC_NAME="pixicred-local-events"
EXISTING_TOPIC_ARN=$(ms_topic_arn "${SNS_TOPIC_NAME}" || true)

if [ -n "${EXISTING_TOPIC_ARN}" ] && [ "${EXISTING_TOPIC_ARN}" != "None" ]; then
  info "SNS topic ${SNS_TOPIC_NAME}: already exists (${EXISTING_TOPIC_ARN})"
  TOPIC_ARN="${EXISTING_TOPIC_ARN}"
else
  TOPIC_ARN=$(ms sns create-topic --name "${SNS_TOPIC_NAME}" --query 'TopicArn' --output text)
  info "Created SNS topic: ${SNS_TOPIC_NAME} (${TOPIC_ARN})"
fi

# ── SNS → SQS Subscriptions ─────────────────────────────────────────────────────
step "SNS → SQS Subscriptions"

# Each consumer queue subscribes to the SNS topic
# (All messages fan out; consumers filter by MessageAttribute in the handler)
for QUEUE in "${QUEUES[@]}"; do
  QUEUE_NAME="pixicred-local-${QUEUE}"
  QUEUE_URL=$(ms sqs get-queue-url --queue-name "${QUEUE_NAME}" --query 'QueueUrl' --output text)
  QUEUE_ARN=$(ms sqs get-queue-attributes \
    --queue-url "${QUEUE_URL}" \
    --attribute-names QueueArn \
    --query 'Attributes.QueueArn' \
    --output text)

  # list-subscriptions-by-topic and check if already subscribed
  ALREADY_SUBSCRIBED=$(ms sns list-subscriptions-by-topic \
    --topic-arn "${TOPIC_ARN}" \
    --query "Subscriptions[?Endpoint=='${QUEUE_ARN}'].SubscriptionArn | [0]" \
    --output text 2>/dev/null || echo "")

  if [ -n "${ALREADY_SUBSCRIBED}" ] && [ "${ALREADY_SUBSCRIBED}" != "None" ]; then
    info "Subscription ${SNS_TOPIC_NAME} → ${QUEUE_NAME}: already exists"
  else
    ms sns subscribe \
      --topic-arn "${TOPIC_ARN}" \
      --protocol sqs \
      --notification-endpoint "${QUEUE_ARN}" \
      >/dev/null
    info "Subscribed ${QUEUE_NAME} to ${SNS_TOPIC_NAME}"
  fi
done

# ── Secrets Manager (local stubs) ───────────────────────────────────────────────
step "Secrets Manager (local stubs)"

# DATABASE_URL points to local Postgres (docker-compose service)
upsert_secret "pixicred-dev-secrets" \
  '{"DATABASE_URL":"postgresql://pixicred:pixicred@localhost:5432/pixicred","JWT_SECRET":"local-dev-secret-not-for-production"}'

# ── SES Sender Identity ──────────────────────────────────────────────────────────
step "SES Sender Identity (local)"

SES_ID_STATUS=$(ms sesv2 get-email-identity \
  --email-identity "${SES_SENDER}" \
  --query 'VerifiedForSendingStatus' \
  --output text 2>/dev/null || echo "NOT_FOUND")

if [ "${SES_ID_STATUS}" = "NOT_FOUND" ]; then
  ms sesv2 create-email-identity \
    --email-identity "${SES_SENDER}" \
    >/dev/null
  info "Created SES identity: ${SES_SENDER}"
else
  info "SES identity ${SES_SENDER}: already exists (status: ${SES_ID_STATUS})"
fi

# ── Summary (local) ──────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  PixiCred Local Bootstrap Complete"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  ✅ MiniStack resources provisioned:"
for QUEUE in "${QUEUES[@]}"; do
  echo "     • pixicred-local-${QUEUE}     (SQS queue)"
  echo "     • pixicred-local-${QUEUE}-dlq (SQS DLQ)"
done
echo "     • ${SNS_TOPIC_NAME}  (SNS topic)"
echo "     • SNS→SQS subscriptions for all 4 queues"
echo "     • pixicred-dev-secrets (Secrets Manager stub)"
echo "     • ${SES_SENDER} (SES identity)"
echo ""
echo "  Next:"
echo "    docker-compose up -d     # start Postgres + MiniStack"
echo "    npm run db:migrate       # run Prisma migrations"
echo "    npm run dev              # start local Express server"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

else
# ════════════════════════════════════════════════════════════════════════════════
#  PRODUCTION MODE — Real AWS
# ════════════════════════════════════════════════════════════════════════════════

banner "PixiCred Bootstrap — PRODUCTION (AWS)"

# ── Pre-flight ──────────────────────────────────────────────────────────────────
step "Pre-flight checks"

command -v aws       >/dev/null 2>&1 || error "AWS CLI not installed. See https://aws.amazon.com/cli/"
command -v terraform >/dev/null 2>&1 || error "Terraform not installed. See https://developer.hashicorp.com/terraform/install"
command -v node      >/dev/null 2>&1 || error "Node.js 20+ not installed. Run: nvm install 20"
command -v docker    >/dev/null 2>&1 || error "Docker not installed. See https://docs.docker.com/get-docker/"

GH_AVAILABLE=false
if command -v gh >/dev/null 2>&1; then
  GH_AVAILABLE=true
  info "gh CLI: found"
else
  warn "gh CLI not installed — GitHub secrets/environment setup will print manual instructions."
  warn "Install: https://cli.github.com"
fi

info "All required tools: OK"

# ── AWS profile validation ─────────────────────────────────────────────────────
step "AWS profile validation"

IDENTITY=$(aws_cmd sts get-caller-identity 2>&1) \
  || error "Cannot authenticate with profile '${AWS_PROFILE}'.\nRun: aws sso login --profile ${AWS_PROFILE}  (SSO)\n  or: aws configure --profile ${AWS_PROFILE}  (static keys)"

ACTUAL_ACCOUNT=$(echo "$IDENTITY" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['Account'])" 2>/dev/null \
  || echo "$IDENTITY" | grep -o '"Account": "[^"]*"' | head -1 | cut -d'"' -f4)

if [ "$ACTUAL_ACCOUNT" != "$AWS_ACCOUNT" ]; then
  error "Profile '${AWS_PROFILE}' authenticates to account ${ACTUAL_ACCOUNT}.\nExpected: ${AWS_ACCOUNT}\nCheck your SSO configuration."
fi

info "AWS profile '${AWS_PROFILE}' → account ${ACTUAL_ACCOUNT}: OK"

# ── Verify pre-provisioned infrastructure ──────────────────────────────────────
# Route 53, ACM certs, and SES identities were provisioned manually before Phase 0.
# This step confirms they are still present; it does not create or modify them.
step "Verify pre-provisioned infrastructure"

ZONE_STATUS=$(aws_cmd route53 get-hosted-zone \
  --id "${HOSTED_ZONE_ID}" \
  --query 'HostedZone.Name' \
  --output text 2>/dev/null || echo "NOT_FOUND")
if [ "${ZONE_STATUS}" = "NOT_FOUND" ]; then
  error "Route 53 hosted zone ${HOSTED_ZONE_ID} not found. It must exist before bootstrap can proceed."
fi
success "Route 53 hosted zone: ${ZONE_STATUS} (${HOSTED_ZONE_ID})"

for CERT_ENV in "dev|${ACM_CERT_ARN_DEV}" "prod|${ACM_CERT_ARN_PROD}"; do
  ENV_NAME="${CERT_ENV%%|*}"
  CERT_ARN="${CERT_ENV#*|}"
  CERT_STATUS=$(aws_cmd acm describe-certificate \
    --certificate-arn "${CERT_ARN}" \
    --query 'Certificate.Status' \
    --output text 2>/dev/null || echo "NOT_FOUND")
  if [ "${CERT_STATUS}" = "ISSUED" ]; then
    success "ACM certificate (${ENV_NAME}): ISSUED"
  else
    warn "ACM certificate (${ENV_NAME}) status: ${CERT_STATUS} — expected ISSUED. ARN: ${CERT_ARN}"
  fi
done

SES_DOMAIN_STATUS=$(aws_cmd sesv2 get-email-identity \
  --email-identity "${SES_DOMAIN}" \
  --query 'VerifiedForSendingStatus' \
  --output text 2>/dev/null || echo "NOT_FOUND")
if [ "${SES_DOMAIN_STATUS}" = "True" ]; then
  success "SES domain identity: ${SES_DOMAIN} (verified)"
else
  warn "SES domain identity ${SES_DOMAIN} status: ${SES_DOMAIN_STATUS} — may require manual DNS verification"
fi

SES_EMAIL_STATUS=$(aws_cmd sesv2 get-email-identity \
  --email-identity "${SES_EMAIL_IDENTITY}" \
  --query 'VerifiedForSendingStatus' \
  --output text 2>/dev/null || echo "NOT_FOUND")
if [ "${SES_EMAIL_STATUS}" = "True" ]; then
  success "SES email identity: ${SES_EMAIL_IDENTITY} (verified)"
else
  warn "SES email identity ${SES_EMAIL_IDENTITY} status: ${SES_EMAIL_STATUS}"
fi

# ── .env setup ──────────────────────────────────────────────────────────────────
step ".env setup"

if [ -f .env ]; then
  info ".env already exists — skipping copy"
else
  if [ ! -f .env.example ]; then
    warn ".env.example not found (Phase 0 scaffold not yet written). Skipping .env creation."
    warn "After Phase 0: cp .env.example .env"
  else
    cp .env.example .env
    info "Created .env from .env.example"
  fi
fi

# ── Terraform state S3 buckets ─────────────────────────────────────────────────
# Using AWS CLI directly because the infra/terraform/bootstrap/ module does not
# exist until Phase 0 scaffold is written. The module is the auditable record;
# this script is the runtime provisioner.
step "Terraform state S3 buckets"

for ENV in "${ENVS[@]}"; do
  BUCKET="pixicred-${ENV}-tf-state"
  if aws_cmd s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
    info "S3 bucket ${BUCKET}: already exists"
  else
    aws_cmd s3api create-bucket \
      --bucket "$BUCKET" \
      >/dev/null
    aws_cmd s3api put-bucket-versioning \
      --bucket "$BUCKET" \
      --versioning-configuration Status=Enabled
    aws_cmd s3api put-bucket-encryption \
      --bucket "$BUCKET" \
      --server-side-encryption-configuration \
        '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
    aws_cmd s3api put-public-access-block \
      --bucket "$BUCKET" \
      --public-access-block-configuration \
        'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'
    info "Created S3 bucket: ${BUCKET} (versioning + encryption + public-access-blocked)"
  fi
done

# ── Terraform state DynamoDB lock tables ────────────────────────────────────────
step "Terraform state DynamoDB lock tables"

for ENV in "${ENVS[@]}"; do
  TABLE="pixicred-${ENV}-tf-locks"
  STATUS=$(aws_cmd dynamodb describe-table \
    --table-name "$TABLE" \
    --query 'Table.TableStatus' \
    --output text 2>/dev/null || echo "NOT_FOUND")
  if [ "$STATUS" != "NOT_FOUND" ]; then
    info "DynamoDB table ${TABLE}: already exists (status: ${STATUS})"
  else
    aws_cmd dynamodb create-table \
      --table-name "$TABLE" \
      --attribute-definitions AttributeName=LockID,AttributeType=S \
      --key-schema AttributeName=LockID,KeyType=HASH \
      --billing-mode PAY_PER_REQUEST \
      >/dev/null
    info "Created DynamoDB table: ${TABLE}"
  fi
done

# ── Migrations audit trail S3 buckets ──────────────────────────────────────────
step "Migrations audit trail S3 buckets"

for ENV in "${ENVS[@]}"; do
  BUCKET="pixicred-${ENV}-migrations"
  if aws_cmd s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
    info "S3 bucket ${BUCKET}: already exists"
  else
    aws_cmd s3api create-bucket \
      --bucket "$BUCKET" \
      >/dev/null
    aws_cmd s3api put-bucket-versioning \
      --bucket "$BUCKET" \
      --versioning-configuration Status=Enabled
    aws_cmd s3api put-bucket-encryption \
      --bucket "$BUCKET" \
      --server-side-encryption-configuration \
        '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
    aws_cmd s3api put-public-access-block \
      --bucket "$BUCKET" \
      --public-access-block-configuration \
        'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'
    info "Created S3 bucket: ${BUCKET} (versioning + encryption + public-access-blocked)"
  fi
done

# ── Lambda packages S3 buckets ─────────────────────────────────────────────────
# CI/CD uploads Lambda ZIPs here before terraform apply picks them up.
# The pre-deploy-check job asserts these buckets exist before any deployment.
step "Lambda packages S3 buckets"

for ENV in "${ENVS[@]}"; do
  BUCKET="pixicred-${ENV}-lambda-packages"
  if aws_cmd s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
    info "S3 bucket ${BUCKET}: already exists"
  else
    aws_cmd s3api create-bucket \
      --bucket "$BUCKET" \
      >/dev/null
    aws_cmd s3api put-bucket-versioning \
      --bucket "$BUCKET" \
      --versioning-configuration Status=Enabled
    aws_cmd s3api put-bucket-encryption \
      --bucket "$BUCKET" \
      --server-side-encryption-configuration \
        '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
    aws_cmd s3api put-public-access-block \
      --bucket "$BUCKET" \
      --public-access-block-configuration \
        'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'
    info "Created S3 bucket: ${BUCKET} (versioning + encryption + public-access-blocked)"
  fi
done

# ── Shared VPC (pixicred — dev + prod share this) ─────────────────────────────
# Lambdas are NOT placed in the VPC (Supabase is external); the VPC exists for
# any future private resources (ElastiCache, RDS, etc.) and is referenced by SSM.
step "Shared VPC (pixicred)"

VPC_ID=$(aws_cmd ec2 describe-vpcs \
  --filters "Name=tag:Name,Values=pixicred" "Name=tag:Project,Values=pixicred" \
  --query 'Vpcs[0].VpcId' \
  --output text 2>/dev/null || echo "None")

if [ "${VPC_ID}" = "None" ] || [ -z "${VPC_ID}" ]; then
  VPC_ID=$(aws_cmd ec2 create-vpc \
    --cidr-block "10.0.0.0/16" \
    --tag-specifications "ResourceType=vpc,Tags=[{Key=Name,Value=pixicred},{Key=Project,Value=pixicred},{Key=ManagedBy,Value=bootstrap}]" \
    --query 'Vpc.VpcId' \
    --output text)
  aws_cmd ec2 modify-vpc-attribute \
    --vpc-id "${VPC_ID}" \
    --enable-dns-hostnames '{"Value":true}'
  aws_cmd ec2 modify-vpc-attribute \
    --vpc-id "${VPC_ID}" \
    --enable-dns-support '{"Value":true}'
  info "Created VPC: ${VPC_ID} (pixicred, 10.0.0.0/16)"
else
  info "VPC pixicred: already exists (${VPC_ID})"
fi

# ── Subnets (2 AZs in us-east-1) ───────────────────────────────────────────────
step "Subnets (2 AZs)"

readonly SUBNET_CONFIGS=(
  "us-east-1a|10.0.1.0/24|pixicred-subnet-1a"
  "us-east-1b|10.0.2.0/24|pixicred-subnet-1b"
)

SUBNET_IDS=()
for SUBNET_CONFIG in "${SUBNET_CONFIGS[@]}"; do
  AZ="${SUBNET_CONFIG%%|*}"
  _rest="${SUBNET_CONFIG#*|}"
  CIDR="${_rest%%|*}"
  SUBNET_NAME="${_rest#*|}"

  EXISTING_SUBNET=$(aws_cmd ec2 describe-subnets \
    --filters "Name=tag:Name,Values=${SUBNET_NAME}" "Name=vpc-id,Values=${VPC_ID}" \
    --query 'Subnets[0].SubnetId' \
    --output text 2>/dev/null || echo "None")

  if [ "${EXISTING_SUBNET}" = "None" ] || [ -z "${EXISTING_SUBNET}" ]; then
    SUBNET_ID=$(aws_cmd ec2 create-subnet \
      --vpc-id "${VPC_ID}" \
      --cidr-block "${CIDR}" \
      --availability-zone "${AZ}" \
      --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${SUBNET_NAME}},{Key=Project,Value=pixicred},{Key=ManagedBy,Value=bootstrap}]" \
      --query 'Subnet.SubnetId' \
      --output text)
    info "Created subnet: ${SUBNET_ID} (${SUBNET_NAME}, ${CIDR}, ${AZ})"
  else
    SUBNET_ID="${EXISTING_SUBNET}"
    info "Subnet ${SUBNET_NAME}: already exists (${SUBNET_ID})"
  fi
  SUBNET_IDS+=("${SUBNET_ID}")
done

# ── SSM Parameters ─────────────────────────────────────────────────────────────
# Terraform reads these at plan time via data "aws_ssm_parameter"; no GitHub
# secrets needed for infra config values that change per-environment.
step "SSM Parameters"

upsert_ssm_param() {
  local name="$1" value="$2"
  aws_cmd ssm put-parameter \
    --name "${name}" \
    --value "${value}" \
    --type "String" \
    --overwrite \
    >/dev/null \
    && info "Upserted SSM parameter: ${name}" \
    || warn "Failed to upsert SSM parameter: ${name}"
}

# Build subnet IDs as JSON array string (e.g. '["subnet-abc","subnet-def"]')
SUBNET_IDS_JSON=$(printf '"%s"\n' "${SUBNET_IDS[@]}" | jq -cs '.')

upsert_ssm_param "/pixicred/vpc_id"                     "${VPC_ID}"
upsert_ssm_param "/pixicred/subnet_ids"                 "${SUBNET_IDS_JSON}"
upsert_ssm_param "/pixicred/dev/acm_certificate_arn"    "${ACM_CERT_ARN_DEV}"
upsert_ssm_param "/pixicred/prod/acm_certificate_arn"   "${ACM_CERT_ARN_PROD}"

# ── GitHub Actions OIDC identity provider ──────────────────────────────────────
step "GitHub Actions OIDC identity provider"

if aws_cmd iam get-open-id-connect-provider \
    --open-id-connect-provider-arn "${OIDC_ARN}" \
    2>/dev/null >/dev/null; then
  info "OIDC provider ${OIDC_HOST}: already exists"
else
  aws_cmd iam create-open-id-connect-provider \
    --url "https://${OIDC_HOST}" \
    --client-id-list "sts.amazonaws.com" \
    --thumbprint-list "6938fd4d98bab03faadb97b34396831e3780aea1" \
    >/dev/null
  info "Created OIDC provider: ${OIDC_HOST}"
fi

# ── GitHub Actions IAM role ────────────────────────────────────────────────────
step "GitHub Actions IAM role"

TRUST_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Federated": "${OIDC_ARN}" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": { "${OIDC_HOST}:aud": "sts.amazonaws.com" },
        "StringLike":   { "${OIDC_HOST}:sub": "repo:${GITHUB_REPO}:*" }
      }
    }
  ]
}
EOF
)

if aws_cmd iam get-role --role-name "${ROLE_NAME}" 2>/dev/null >/dev/null; then
  info "IAM role ${ROLE_NAME}: already exists"
else
  aws_cmd iam create-role \
    --role-name "${ROLE_NAME}" \
    --assume-role-policy-document "${TRUST_POLICY}" \
    --description "GitHub Actions OIDC deployment role for PixiCred (repo: ${GITHUB_REPO})" \
    >/dev/null
  # AdministratorAccess for portfolio simplicity.
  # Production: replace with a scoped policy covering only needed services.
  aws_cmd iam attach-role-policy \
    --role-name "${ROLE_NAME}" \
    --policy-arn "arn:aws:iam::aws:policy/AdministratorAccess"
  info "Created IAM role: ${ROLE_NAME} (ARN: ${ROLE_ARN})"
fi

# ── GitHub environments and secrets ────────────────────────────────────────────
# Environments: dev, prod, prod-approval (approval gate for downstream prod jobs)
# AWS_ROLE_ARN is scoped per environment; AWS_REGION is repo-level (same for all)
step "GitHub Actions secrets and environments"

# Environments that receive AWS_ROLE_ARN as an environment-level secret
readonly GITHUB_ENVS=("dev" "prod" "prod-approval")

print_github_manual_steps() {
  warn "Manual GitHub setup required:"
  warn "  1. Create environments 'dev', 'prod', 'prod-approval':"
  warn "     Repo → Settings → Environments → New environment"
  warn "  2. Add environment secret AWS_ROLE_ARN = ${ROLE_ARN} to each environment"
  warn "  3. Add repo secret AWS_REGION = ${AWS_REGION}:"
  warn "     Repo → Settings → Secrets and variables → Actions → New repository secret"
  warn "  4. Add yourself as a required reviewer on 'prod-approval' only (not prod)"
}

if [ "${GH_AVAILABLE}" = true ]; then
  if gh auth status >/dev/null 2>&1; then
    # AWS_REGION is repo-level — same value across all environments
    gh secret set AWS_REGION \
      --body "${AWS_REGION}" \
      --repo "${GITHUB_REPO}" 2>/dev/null \
      && info "Set GitHub repo secret: AWS_REGION" \
      || warn "Failed to set AWS_REGION"

    # Create each environment and set AWS_ROLE_ARN as an environment-level secret
    for GH_ENV in "${GITHUB_ENVS[@]}"; do
      gh api "repos/${GITHUB_REPO}/environments/${GH_ENV}" \
        --method PUT \
        --silent 2>/dev/null \
        && info "Created/updated GitHub '${GH_ENV}' environment" \
        || warn "Failed to create '${GH_ENV}' environment — do it manually in repo Settings → Environments"

      gh secret set AWS_ROLE_ARN \
        --env "${GH_ENV}" \
        --body "${ROLE_ARN}" \
        --repo "${GITHUB_REPO}" 2>/dev/null \
        && info "Set environment secret AWS_ROLE_ARN for '${GH_ENV}'" \
        || warn "Failed to set AWS_ROLE_ARN for '${GH_ENV}'"
    done

    warn "ACTION REQUIRED: Add required reviewers to the 'prod-approval' environment:"
    warn "  https://github.com/${GITHUB_REPO}/settings/environments"
    warn "  (prod-approval gates all prod work; prod itself requires no additional approval)"
  else
    warn "gh CLI not authenticated — run: gh auth login"
    print_github_manual_steps
  fi
else
  print_github_manual_steps
fi

# ── Secrets Manager secrets ─────────────────────────────────────────────────────
# DATABASE_URL is loaded from .env.secrets (gitignored) if present so the CI
# pre-deploy-check passes without waiting for the first migrate run.
# JWT_SECRET is generated once at bootstrap and never overwritten.
step "Secrets Manager secrets"

# Percent-encode the password component of a postgresql:// URL so that special
# characters (#, @, $, {, }, ;, etc.) don't confuse Node.js/Prisma's strict
# RFC 3986 URL parser.  Uses rfind('@') so passwords containing '@' are handled.
encode_db_url() {
  local url="$1"
  [[ -z "$url" ]] && echo "" && return
  python3 - "$url" << 'PYEOF'
import sys, urllib.parse
raw = sys.argv[1]
scheme, rest = raw.split('://', 1)
last_at = rest.rfind('@')
credentials, host_part = rest[:last_at], rest[last_at+1:]
colon = credentials.index(':')
user, password = credentials[:colon], credentials[colon+1:]
print(f"{scheme}://{user}:{urllib.parse.quote(password, safe='')}@{host_part}")
PYEOF
}

# Load DATABASE_URL values from .env.secrets — reads literals, never sourced,
# so special characters ($, {, }, etc.) in passwords are captured safely.
DEV_DATABASE_URL=""
PROD_DATABASE_URL=""
if [ -f .env.secrets ]; then
  DEV_DATABASE_URL=$(grep -E '^DEV_DATABASE_URL=' .env.secrets | head -1 | cut -d'=' -f2-)
  PROD_DATABASE_URL=$(grep -E '^PROD_DATABASE_URL=' .env.secrets | head -1 | cut -d'=' -f2-)
  [ -n "$DEV_DATABASE_URL" ]  && info "Loaded DEV_DATABASE_URL from .env.secrets"
  [ -n "$PROD_DATABASE_URL" ] && info "Loaded PROD_DATABASE_URL from .env.secrets"
  [ -z "$DEV_DATABASE_URL" ]  && warn ".env.secrets: DEV_DATABASE_URL is empty"
  [ -z "$PROD_DATABASE_URL" ] && warn ".env.secrets: PROD_DATABASE_URL is empty"
else
  warn ".env.secrets not found — DATABASE_URL will remain placeholder in Secrets Manager"
  warn "Create .env.secrets from .env.secrets.example before running bootstrap.sh"
fi

# URL-encode the password so Node.js/Prisma can parse the URL correctly.
# The raw URL (with unencoded special chars) is safe for psql but breaks Prisma.
ENCODED_DEV_URL=$(encode_db_url "$DEV_DATABASE_URL")
ENCODED_PROD_URL=$(encode_db_url "$PROD_DATABASE_URL")

if [ -n "$ENCODED_DEV_URL" ]; then
  info "Encoded dev DATABASE_URL (use this value in GitHub dev environment secret):"
  info "  $ENCODED_DEV_URL"
fi
if [ -n "$ENCODED_PROD_URL" ]; then
  info "Encoded prod DATABASE_URL (use this value in GitHub prod environment secret):"
  info "  $ENCODED_PROD_URL"
fi

GENERATED_JWT=$(openssl rand -hex 32)

for ENV in "${ENVS[@]}"; do
  SECRET_NAME="pixicred-${ENV}-secrets"

  if [ "$ENV" = "dev" ]; then
    DB_URL="$ENCODED_DEV_URL"
  else
    DB_URL="$ENCODED_PROD_URL"
  fi

  if aws_cmd secretsmanager describe-secret \
      --secret-id "${SECRET_NAME}" 2>/dev/null >/dev/null; then
    # Secret exists — update JWT_SECRET if missing; set DATABASE_URL if we have a real value
    EXISTING=$(aws_cmd secretsmanager get-secret-value \
      --secret-id "${SECRET_NAME}" \
      --query 'SecretString' --output text)
    EXISTING_JWT=$(echo "${EXISTING}" | jq -r '.JWT_SECRET // empty')

    UPDATED="$EXISTING"
    CHANGED=false

    if [ -z "${EXISTING_JWT}" ]; then
      UPDATED=$(echo "${UPDATED}" | jq --arg jwt "${GENERATED_JWT}" '. + {JWT_SECRET: $jwt}')
      CHANGED=true
    fi

    if [ -n "$DB_URL" ]; then
      UPDATED=$(echo "${UPDATED}" | jq --arg url "$DB_URL" '. + {DATABASE_URL: $url}')
      CHANGED=true
    fi

    if [ "$CHANGED" = true ]; then
      aws_cmd secretsmanager put-secret-value \
        --secret-id "${SECRET_NAME}" \
        --secret-string "${UPDATED}" >/dev/null
      info "Updated secret: ${SECRET_NAME}"
    else
      info "Secret ${SECRET_NAME}: already up to date"
    fi
  else
    # Create new secret — jq handles JSON-escaping of the DATABASE_URL (safe for special chars)
    SECRET_JSON=$(jq -n \
      --arg db  "${DB_URL:-PLACEHOLDER_set_by_cicd}" \
      --arg jwt "${GENERATED_JWT}" \
      '{DATABASE_URL: $db, JWT_SECRET: $jwt}')
    aws_cmd secretsmanager create-secret \
      --name "${SECRET_NAME}" \
      --description "PixiCred ${ENV} runtime secrets. DATABASE_URL synced from GitHub env secret by CI/CD." \
      --secret-string "$SECRET_JSON" \
      >/dev/null
    info "Created secret: ${SECRET_NAME}"
  fi
done

# ── SES identities ────────────────────────────────────────────────────────────
# Domain identity and email identity were pre-provisioned; DKIM records are in Route 53.
step "SES identities"

SES_STATUS=$(aws_cmd sesv2 get-email-identity \
  --email-identity "${SES_DOMAIN}" \
  --query 'VerifiedForSendingStatus' \
  --output text 2>/dev/null || echo "NOT_FOUND")

if [ "${SES_STATUS}" = "NOT_FOUND" ]; then
  aws_cmd sesv2 create-email-identity \
    --email-identity "${SES_DOMAIN}" \
    >/dev/null
  info "Created SES domain identity: ${SES_DOMAIN}"
  SES_STATUS="PENDING"
  warn "ACTION REQUIRED: Add DKIM CNAME records to Route 53 hosted zone ${HOSTED_ZONE_ID}."
  warn "  Fetch tokens: aws sesv2 get-email-identity --email-identity ${SES_DOMAIN} --profile ${AWS_PROFILE} --query 'DkimAttributes.Tokens'"
else
  info "SES domain identity ${SES_DOMAIN}: already exists (VerifiedForSendingStatus: ${SES_STATUS})"
fi

SES_EMAIL_STATUS=$(aws_cmd sesv2 get-email-identity \
  --email-identity "${SES_EMAIL_IDENTITY}" \
  --query 'VerifiedForSendingStatus' \
  --output text 2>/dev/null || echo "NOT_FOUND")

if [ "${SES_EMAIL_STATUS}" = "NOT_FOUND" ]; then
  aws_cmd sesv2 create-email-identity \
    --email-identity "${SES_EMAIL_IDENTITY}" \
    >/dev/null
  info "Created SES email identity: ${SES_EMAIL_IDENTITY} (check inbox to verify)"
else
  info "SES email identity ${SES_EMAIL_IDENTITY}: already exists (VerifiedForSendingStatus: ${SES_EMAIL_STATUS})"
fi

# Capture statuses for summary (fall back to value set in verification step above)
SES_DOMAIN_STATUS="${SES_DOMAIN_STATUS:-${SES_STATUS}}"

# ── Summary (production) ──────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  PixiCred Production Bootstrap Complete"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  ✅ Pre-provisioned (verified, not modified by this script):"
echo "     • Route 53 hosted zone: pixicred.com (${HOSTED_ZONE_ID})"
echo "     • ACM cert (dev):  ${ACM_CERT_ARN_DEV}"
echo "     • ACM cert (prod): ${ACM_CERT_ARN_PROD}"
echo "     • SES domain identity: ${SES_DOMAIN} (status: ${SES_DOMAIN_STATUS})"
echo "     • SES email identity:  ${SES_EMAIL_IDENTITY} (status: ${SES_EMAIL_STATUS})"
echo ""
echo "  ✅ Provisioned by this script:"
echo "     • .env file (local development)"
echo "     • pixicred-dev-tf-state   (S3, versioned, encrypted)"
echo "     • pixicred-prod-tf-state  (S3, versioned, encrypted)"
echo "     • pixicred-dev-tf-locks   (DynamoDB, PAY_PER_REQUEST)"
echo "     • pixicred-prod-tf-locks  (DynamoDB, PAY_PER_REQUEST)"
echo "     • pixicred-dev-migrations       (S3, versioned, encrypted)"
echo "     • pixicred-prod-migrations      (S3, versioned, encrypted)"
echo "     • pixicred-dev-lambda-packages  (S3, versioned, encrypted)"
echo "     • pixicred-prod-lambda-packages (S3, versioned, encrypted)"
echo "     • VPC: pixicred (10.0.0.0/16, ${VPC_ID})"
echo "     • Subnets: pixicred-subnet-1a (us-east-1a), pixicred-subnet-1b (us-east-1b)"
echo "     • SSM /pixicred/vpc_id"
echo "     • SSM /pixicred/subnet_ids"
echo "     • SSM /pixicred/dev/acm_certificate_arn"
echo "     • SSM /pixicred/prod/acm_certificate_arn"
echo "     • OIDC provider: ${OIDC_HOST}"
echo "     • IAM role: ${ROLE_NAME}"
echo "     • GitHub env secret: AWS_ROLE_ARN (dev, prod, prod-approval)"
echo "     • GitHub repo secret: AWS_REGION"
echo "     • GitHub environments: dev, prod, prod-approval"
if [ -n "$DEV_DATABASE_URL" ]; then
  echo "     • Secrets Manager: pixicred-dev-secrets (DATABASE_URL from .env.secrets + JWT_SECRET)"
else
  echo "     • Secrets Manager: pixicred-dev-secrets (DATABASE_URL placeholder + JWT_SECRET)"
fi
if [ -n "$PROD_DATABASE_URL" ]; then
  echo "     • Secrets Manager: pixicred-prod-secrets (DATABASE_URL from .env.secrets + JWT_SECRET)"
else
  echo "     • Secrets Manager: pixicred-prod-secrets (DATABASE_URL placeholder + JWT_SECRET)"
fi
echo ""
echo "  ⚠️  Required manual steps:"
echo ""
echo "  1. Add required reviewers to the 'prod-approval' GitHub environment:"
echo "     https://github.com/${GITHUB_REPO}/settings/environments"
echo "     (prod-approval is the single approval gate; prod itself has no required reviewers)"
echo ""
echo "  2. Add DATABASE_URL secrets to GitHub environments:"
echo "     GitHub repo → Settings → Environments → dev → Add secret:"
echo "       DATABASE_URL = <Supabase connection pooler URL for dev>"
echo "     Repeat for prod environment."
echo "     CI/CD syncs this value to Secrets Manager on every deploy/migrate run."
echo ""
echo "  3. (Optional) Request SES production access to send to unverified recipients:"
echo "     AWS Console → SES → Account dashboard → Request production access"
echo ""
echo "  ✅ No action needed (already complete):"
echo "     • Route 53 NS delegation — registrar updated"
echo "     • SES DKIM records — in Route 53"
echo "     • ACM cert DNS validation — in Route 53"
echo "     • Custom domain infrastructure (Phase 8) — certs and zone ready"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  See PRE_IMPLEMENTATION_PLAN.md for full context and verification steps."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

fi  # end production mode
