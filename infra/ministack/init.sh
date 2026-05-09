#!/bin/bash
set -e

ENDPOINT=http://localhost:4566
REGION=us-east-1
ACCOUNT=000000000000

# Wait for MiniStack to be ready
echo "Waiting for MiniStack to be ready..."
until curl -sf "${ENDPOINT}/_ministack/health" > /dev/null 2>&1; do
  echo "  MiniStack not ready — retrying in 2s..."
  sleep 2
done
echo "MiniStack is ready."

QUEUES=(credit-check notifications statement-gen billing-lifecycle)

# Create DLQs first (referenced in main queue redrive policies)
for QUEUE in "${QUEUES[@]}"; do
  DLQ_NAME="pixicred-local-${QUEUE}-dlq"
  echo "Creating DLQ: ${DLQ_NAME}"
  aws --endpoint-url "${ENDPOINT}" --region "${REGION}" sqs create-queue \
    --queue-name "${DLQ_NAME}"
done

# Create main queues with redrive policies pointing to their DLQs
for QUEUE in "${QUEUES[@]}"; do
  QUEUE_NAME="pixicred-local-${QUEUE}"
  DLQ_ARN="arn:aws:sqs:${REGION}:${ACCOUNT}:pixicred-local-${QUEUE}-dlq"
  REDRIVE=$(printf '{"deadLetterTargetArn":"%s","maxReceiveCount":"3"}' "${DLQ_ARN}")

  echo "Creating queue: ${QUEUE_NAME}"
  aws --endpoint-url "${ENDPOINT}" --region "${REGION}" sqs create-queue \
    --queue-name "${QUEUE_NAME}" \
    --attributes "RedrivePolicy=${REDRIVE}"
done

# Create SNS topic
echo "Creating SNS topic: pixicred-local-events"
SNS_ARN=$(aws --endpoint-url "${ENDPOINT}" --region "${REGION}" sns create-topic \
  --name pixicred-local-events \
  --query 'TopicArn' --output text)
echo "SNS topic ARN: ${SNS_ARN}"

# Subscribe all consumer queues to the SNS topic
for QUEUE in "${QUEUES[@]}"; do
  QUEUE_ARN="arn:aws:sqs:${REGION}:${ACCOUNT}:pixicred-local-${QUEUE}"
  echo "Subscribing pixicred-local-${QUEUE} to SNS topic..."
  aws --endpoint-url "${ENDPOINT}" --region "${REGION}" sns subscribe \
    --topic-arn "${SNS_ARN}" \
    --protocol sqs \
    --notification-endpoint "${QUEUE_ARN}"
done

echo ""
echo "MiniStack initialization complete."
echo "Queues:"
aws --endpoint-url "${ENDPOINT}" --region "${REGION}" sqs list-queues --query 'QueueUrls[]' --output text
echo "Topics:"
aws --endpoint-url "${ENDPOINT}" --region "${REGION}" sns list-topics --query 'Topics[*].TopicArn' --output text
