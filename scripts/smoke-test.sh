#!/usr/bin/env bash
# PixiCred smoke test — verifies a deployed environment is healthy.
# Checks that all AWS resources exist, Secrets Manager is populated,
# and HTTP endpoints are reachable. Read-only — no side effects.
#
# Usage:
#   ./scripts/smoke-test.sh --env dev    # OIDC in CI; rmw-llc profile locally
#   ./scripts/smoke-test.sh --env prod

set -uo pipefail

# ── Args ───────────────────────────────────────────────────────────────────────
ENV=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

[[ -z "$ENV" ]] && { echo "Usage: $0 --env <dev|prod>" >&2; exit 1; }
[[ "$ENV" != "dev" && "$ENV" != "prod" ]] && { echo "ENV must be 'dev' or 'prod'" >&2; exit 1; }

# ── Output helpers ─────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
pass()  { echo -e "  ${GREEN}✅${NC} $*"; }
fail()  { echo -e "  ${RED}❌${NC} $*"; FAILURES=$((FAILURES + 1)); }
skip()  { echo -e "  ${YELLOW}⚠️ ${NC} $*"; }
step()  { echo -e "\n${BLUE}${BOLD}── $* ──${NC}"; }
FAILURES=0

# ── AWS CLI wrapper ────────────────────────────────────────────────────────────
# CI: aws-actions/configure-aws-credentials sets AWS_ACCESS_KEY_ID via OIDC.
# Local: use rmw-llc named profile.
if [[ -n "${AWS_ACCESS_KEY_ID:-}" ]]; then
  aws_cmd() { aws --region us-east-1 "$@"; }
else
  aws_cmd() { aws --profile rmw-llc --region us-east-1 "$@"; }
fi

# ── Derived values ─────────────────────────────────────────────────────────────
if [[ "$ENV" == "prod" ]]; then
  API_URL="https://api.pixicred.com"
  FRONTEND_URL="https://pixicred.com"
else
  API_URL="https://api.dev.pixicred.com"
  FRONTEND_URL="https://dev.pixicred.com"
fi

# ── Banner ─────────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  PixiCred Smoke Test — ${ENV}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Lambda functions ───────────────────────────────────────────────────────────
step "Lambda functions"

LAMBDA_NAMES=(
  "pixicred-${ENV}-service"
  "pixicred-${ENV}-api-applications"
  "pixicred-${ENV}-api-accounts"
  "pixicred-${ENV}-api-transactions"
  "pixicred-${ENV}-api-payments"
  "pixicred-${ENV}-api-statements"
  "pixicred-${ENV}-api-notifications"
  "pixicred-${ENV}-api-auth"
  "pixicred-${ENV}-api-admin"
  "pixicred-${ENV}-api-health"
  "pixicred-${ENV}-credit-check"
  "pixicred-${ENV}-notification"
  "pixicred-${ENV}-statement-gen"
  "pixicred-${ENV}-billing-lifecycle"
)

for FN in "${LAMBDA_NAMES[@]}"; do
  STATE=$(aws_cmd lambda get-function-configuration \
    --function-name "$FN" \
    --query 'State' --output text 2>/dev/null || echo "NOT_FOUND")
  if [[ "$STATE" == "Active" ]]; then
    pass "Lambda ${FN}: Active"
  elif [[ "$STATE" == "NOT_FOUND" ]]; then
    fail "Lambda ${FN}: not found"
  else
    fail "Lambda ${FN}: unexpected state (${STATE})"
  fi
done

# ── SQS queues ─────────────────────────────────────────────────────────────────
step "SQS queues"

SQS_QUEUES=(
  "pixicred-${ENV}-credit-check"
  "pixicred-${ENV}-credit-check-dlq"
  "pixicred-${ENV}-notification"
  "pixicred-${ENV}-notification-dlq"
  "pixicred-${ENV}-statement-gen"
  "pixicred-${ENV}-statement-gen-dlq"
  "pixicred-${ENV}-billing-lifecycle"
  "pixicred-${ENV}-billing-lifecycle-dlq"
)

for QUEUE in "${SQS_QUEUES[@]}"; do
  URL=$(aws_cmd sqs get-queue-url --queue-name "$QUEUE" \
    --query 'QueueUrl' --output text 2>/dev/null || echo "")
  if [[ -n "$URL" && "$URL" != "None" ]]; then
    pass "SQS ${QUEUE}: exists"
  else
    fail "SQS ${QUEUE}: not found"
  fi
done

# ── SNS topic ──────────────────────────────────────────────────────────────────
step "SNS topic"

SNS_TOPIC_NAME="pixicred-${ENV}-events"
TOPIC_ARN=$(aws_cmd sns list-topics \
  --query "Topics[?ends_with(TopicArn,':${SNS_TOPIC_NAME}')].TopicArn | [0]" \
  --output text 2>/dev/null || echo "")
if [[ -n "$TOPIC_ARN" && "$TOPIC_ARN" != "None" ]]; then
  pass "SNS topic ${SNS_TOPIC_NAME}: ${TOPIC_ARN}"
else
  fail "SNS topic ${SNS_TOPIC_NAME}: not found"
fi

# ── S3 buckets ─────────────────────────────────────────────────────────────────
step "S3 buckets"

S3_BUCKETS=(
  "pixicred-${ENV}-lambda-packages"
  "pixicred-${ENV}-frontend"
  "pixicred-${ENV}-migrations"
)

for BUCKET in "${S3_BUCKETS[@]}"; do
  if aws_cmd s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
    pass "S3 ${BUCKET}: exists"
  else
    fail "S3 ${BUCKET}: not found"
  fi
done

# ── Secrets Manager ────────────────────────────────────────────────────────────
step "Secrets Manager"

SECRET=$(aws_cmd secretsmanager get-secret-value \
  --secret-id "pixicred-${ENV}-secrets" \
  --query 'SecretString' --output text 2>/dev/null || echo "")

if [[ -z "$SECRET" ]]; then
  fail "pixicred-${ENV}-secrets: not found"
else
  DB_URL=$(echo "$SECRET" | jq -r '.DATABASE_URL // empty')
  JWT=$(echo "$SECRET" | jq -r '.JWT_SECRET // empty')

  if [[ -n "$DB_URL" ]] && ! echo "$DB_URL" | grep -qi "placeholder"; then
    pass "Secrets Manager: DATABASE_URL present"
  else
    fail "Secrets Manager: DATABASE_URL missing or is placeholder"
  fi

  if [[ -n "$JWT" ]]; then
    pass "Secrets Manager: JWT_SECRET present"
  else
    fail "Secrets Manager: JWT_SECRET missing"
  fi
fi

# ── CloudFront distribution ────────────────────────────────────────────────────
step "CloudFront distribution"

CF_JSON=$(aws_cmd cloudfront list-distributions \
  --query "DistributionList.Items[?Origins.Items[?contains(DomainName,'pixicred-${ENV}-frontend')]].{Id:Id,Status:Status,Enabled:Enabled} | [0]" \
  --output json 2>/dev/null || echo "null")

CF_ID=$(echo "$CF_JSON" | jq -r '.Id // empty')
CF_STATUS=$(echo "$CF_JSON" | jq -r '.Status // empty')
CF_ENABLED=$(echo "$CF_JSON" | jq -r '.Enabled // empty')

if [[ -z "$CF_ID" || "$CF_ID" == "null" ]]; then
  fail "CloudFront distribution for pixicred-${ENV}-frontend: not found"
elif [[ "$CF_STATUS" == "Deployed" && "$CF_ENABLED" == "true" ]]; then
  pass "CloudFront ${CF_ID}: Deployed and Enabled"
elif [[ "$CF_STATUS" == "InProgress" ]]; then
  skip "CloudFront ${CF_ID}: InProgress (still propagating)"
else
  fail "CloudFront ${CF_ID}: status=${CF_STATUS}, enabled=${CF_ENABLED}"
fi

# ── API HTTP check ─────────────────────────────────────────────────────────────
step "API HTTP check"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  --max-time 15 \
  "${API_URL}/health" 2>/dev/null || echo "000")

if [[ "$HTTP_CODE" == "200" ]]; then
  pass "API ${API_URL}/health → 200 OK"
elif [[ "$HTTP_CODE" == "000" ]]; then
  fail "API ${API_URL}/health → connection failed (timeout or DNS)"
else
  fail "API ${API_URL}/health → ${HTTP_CODE} (expected 200)"
fi

# ── Frontend HTTP check ────────────────────────────────────────────────────────
step "Frontend HTTP check"

FE_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  --max-time 15 \
  "${FRONTEND_URL}/" 2>/dev/null || echo "000")
if [[ "$FE_CODE" == "200" ]]; then
  pass "Frontend ${FRONTEND_URL}/ → 200 OK"
elif [[ "$FE_CODE" == "000" ]]; then
  fail "Frontend ${FRONTEND_URL}/ → connection failed (timeout or DNS)"
else
  fail "Frontend ${FRONTEND_URL}/ → ${FE_CODE}"
fi

# ── Summary ────────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [[ "$FAILURES" -eq 0 ]]; then
  echo -e "  ${GREEN}${BOLD}✅ All smoke tests passed (${ENV})${NC}"
else
  echo -e "  ${RED}${BOLD}❌ ${FAILURES} smoke test(s) FAILED (${ENV})${NC}"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

exit "$FAILURES"
