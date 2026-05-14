provider "aws" {
  region = "us-east-1"
}

# These resources are pre-created by bootstrap.sh. Import them into state on
# first apply so Terraform can manage them without trying to recreate them.
import {
  to = aws_s3_bucket.lambda_packages
  id = "pixicred-prod-lambda-packages"
}

import {
  to = aws_secretsmanager_secret.app_secrets
  id = "pixicred-prod-secrets"
}

data "aws_caller_identity" "current" {}

data "aws_ssm_parameter" "acm_certificate_arn" {
  name = "/pixicred/${local.env}/acm_certificate_arn"
}

locals {
  env    = "prod"
  region = "us-east-1"

  tags = {
    Project     = "pixicred"
    Environment = local.env
    ManagedBy   = "terraform"
  }

  hosted_zone_id = "Z0511624US25VOVRIJF3"

  service_invoke_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = module.service_lambda.function_arn
    }]
  })

  api_admin_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = module.service_lambda.function_arn
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = module.sqs_billing_lifecycle.queue_arn
      }
    ]
  })

  service_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ses:SendEmail", "ses:SendRawEmail"]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = "sns:Publish"
        Resource = aws_sns_topic.events.arn
      },
      {
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = "arn:aws:secretsmanager:${local.region}:${data.aws_caller_identity.current.account_id}:secret:pixicred-${local.env}-secrets*"
      }
    ]
  })

  credit_check_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = module.service_lambda.function_arn
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = module.sqs_credit_check.queue_arn
      }
    ]
  })

  notification_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = module.service_lambda.function_arn
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = module.sqs_notification.queue_arn
      }
    ]
  })

  statement_gen_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = module.service_lambda.function_arn
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = module.sqs_statement_gen.queue_arn
      }
    ]
  })

  billing_lifecycle_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = module.service_lambda.function_arn
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = module.sqs_billing_lifecycle.queue_arn
      }
    ]
  })

  api_common_env = {
    ENVIRONMENT        = local.env
    SERVICE_LAMBDA_ARN = module.service_lambda.function_arn
  }
}

resource "aws_s3_bucket" "lambda_packages" {
  bucket = "pixicred-${local.env}-lambda-packages"
  tags   = local.tags
}

resource "aws_s3_bucket_versioning" "lambda_packages" {
  bucket = aws_s3_bucket.lambda_packages.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_sns_topic" "events" {
  name = "pixicred-${local.env}-events"
  tags = local.tags
}

module "sqs_credit_check" {
  source                     = "../../modules/sqs"
  name                       = "pixicred-${local.env}-credit-check"
  visibility_timeout_seconds = 60
  max_receive_count          = 3
  tags                       = local.tags
}

module "sqs_notification" {
  source                     = "../../modules/sqs"
  name                       = "pixicred-${local.env}-notification"
  visibility_timeout_seconds = 60
  max_receive_count          = 3
  tags                       = local.tags
}

module "sqs_statement_gen" {
  source                     = "../../modules/sqs"
  name                       = "pixicred-${local.env}-statement-gen"
  visibility_timeout_seconds = 300
  max_receive_count          = 3
  tags                       = local.tags
}

module "sqs_billing_lifecycle" {
  source                     = "../../modules/sqs"
  name                       = "pixicred-${local.env}-billing-lifecycle"
  visibility_timeout_seconds = 300
  max_receive_count          = 3
  tags                       = local.tags
}

resource "aws_sns_topic_subscription" "notification" {
  topic_arn = aws_sns_topic.events.arn
  protocol  = "sqs"
  endpoint  = module.sqs_notification.queue_arn
}

resource "aws_sqs_queue_policy" "notification_sns" {
  queue_url = module.sqs_notification.queue_url
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "sns.amazonaws.com" }
      Action    = "sqs:SendMessage"
      Resource  = module.sqs_notification.queue_arn
      Condition = {
        ArnEquals = { "aws:SourceArn" = aws_sns_topic.events.arn }
      }
    }]
  })
}


module "service_lambda" {
  source        = "../../modules/lambda"
  function_name = "pixicred-${local.env}-service"
  memory_size   = 512
  timeout       = 60
  s3_bucket     = aws_s3_bucket.lambda_packages.bucket
  s3_key        = "service/index.zip"
  policy_json   = local.service_policy
  tags          = local.tags

  environment = {
    ENVIRONMENT                 = local.env
    AWS_SECRET_NAME             = "pixicred-${local.env}-secrets"
    SNS_TOPIC_ARN               = aws_sns_topic.events.arn
    CREDIT_CHECK_QUEUE_URL      = module.sqs_credit_check.queue_url
    NOTIFICATION_QUEUE_URL      = module.sqs_notification.queue_url
    STATEMENT_GEN_QUEUE_URL     = module.sqs_statement_gen.queue_url
    BILLING_LIFECYCLE_QUEUE_URL = module.sqs_billing_lifecycle.queue_url
  }
}

module "api_applications" {
  source        = "../../modules/lambda"
  function_name = "pixicred-${local.env}-api-applications"
  memory_size   = 256
  timeout       = 30
  s3_bucket     = aws_s3_bucket.lambda_packages.bucket
  s3_key        = "api-applications/index.zip"
  policy_json   = local.service_invoke_policy
  environment   = local.api_common_env
  tags          = local.tags
}

module "api_accounts" {
  source        = "../../modules/lambda"
  function_name = "pixicred-${local.env}-api-accounts"
  memory_size   = 256
  timeout       = 30
  s3_bucket     = aws_s3_bucket.lambda_packages.bucket
  s3_key        = "api-accounts/index.zip"
  policy_json   = local.service_invoke_policy
  environment   = local.api_common_env
  tags          = local.tags
}

module "api_transactions" {
  source        = "../../modules/lambda"
  function_name = "pixicred-${local.env}-api-transactions"
  memory_size   = 256
  timeout       = 30
  s3_bucket     = aws_s3_bucket.lambda_packages.bucket
  s3_key        = "api-transactions/index.zip"
  policy_json   = local.service_invoke_policy
  environment   = local.api_common_env
  tags          = local.tags
}

module "api_payments" {
  source        = "../../modules/lambda"
  function_name = "pixicred-${local.env}-api-payments"
  memory_size   = 256
  timeout       = 30
  s3_bucket     = aws_s3_bucket.lambda_packages.bucket
  s3_key        = "api-payments/index.zip"
  policy_json   = local.service_invoke_policy
  environment   = local.api_common_env
  tags          = local.tags
}

module "api_statements" {
  source        = "../../modules/lambda"
  function_name = "pixicred-${local.env}-api-statements"
  memory_size   = 256
  timeout       = 30
  s3_bucket     = aws_s3_bucket.lambda_packages.bucket
  s3_key        = "api-statements/index.zip"
  policy_json   = local.service_invoke_policy
  environment   = local.api_common_env
  tags          = local.tags
}

module "api_notifications" {
  source        = "../../modules/lambda"
  function_name = "pixicred-${local.env}-api-notifications"
  memory_size   = 256
  timeout       = 30
  s3_bucket     = aws_s3_bucket.lambda_packages.bucket
  s3_key        = "api-notifications/index.zip"
  policy_json   = local.service_invoke_policy
  environment   = local.api_common_env
  tags          = local.tags
}

module "api_auth" {
  source        = "../../modules/lambda"
  function_name = "pixicred-${local.env}-api-auth"
  memory_size   = 256
  timeout       = 30
  s3_bucket     = aws_s3_bucket.lambda_packages.bucket
  s3_key        = "api-auth/index.zip"
  policy_json   = local.service_invoke_policy
  environment   = local.api_common_env
  tags          = local.tags
}

module "api_admin" {
  source        = "../../modules/lambda"
  function_name = "pixicred-${local.env}-api-admin"
  memory_size   = 256
  timeout       = 30
  s3_bucket     = aws_s3_bucket.lambda_packages.bucket
  s3_key        = "api-admin/index.zip"
  policy_json   = local.api_admin_policy
  tags          = local.tags

  environment = merge(local.api_common_env, {
    BILLING_LIFECYCLE_QUEUE_URL = module.sqs_billing_lifecycle.queue_url
  })
}

module "lambda_credit_check" {
  source        = "../../modules/lambda"
  function_name = "pixicred-${local.env}-credit-check"
  memory_size   = 256
  timeout       = 60
  s3_bucket     = aws_s3_bucket.lambda_packages.bucket
  s3_key        = "credit-check/index.zip"
  policy_json   = local.credit_check_policy
  environment   = { ENVIRONMENT = local.env, SERVICE_LAMBDA_ARN = module.service_lambda.function_arn }
  tags          = local.tags
}

module "lambda_notification" {
  source        = "../../modules/lambda"
  function_name = "pixicred-${local.env}-notification"
  memory_size   = 256
  timeout       = 60
  s3_bucket     = aws_s3_bucket.lambda_packages.bucket
  s3_key        = "notification/index.zip"
  policy_json   = local.notification_policy
  environment   = { ENVIRONMENT = local.env, SERVICE_LAMBDA_ARN = module.service_lambda.function_arn }
  tags          = local.tags
}

module "lambda_statement_gen" {
  source        = "../../modules/lambda"
  function_name = "pixicred-${local.env}-statement-gen"
  memory_size   = 512
  timeout       = 300
  s3_bucket     = aws_s3_bucket.lambda_packages.bucket
  s3_key        = "statement-gen/index.zip"
  policy_json   = local.statement_gen_policy
  environment   = { ENVIRONMENT = local.env, SERVICE_LAMBDA_ARN = module.service_lambda.function_arn }
  tags          = local.tags
}

module "lambda_billing_lifecycle" {
  source        = "../../modules/lambda"
  function_name = "pixicred-${local.env}-billing-lifecycle"
  memory_size   = 256
  timeout       = 300
  s3_bucket     = aws_s3_bucket.lambda_packages.bucket
  s3_key        = "billing-lifecycle/index.zip"
  policy_json   = local.billing_lifecycle_policy
  environment   = { ENVIRONMENT = local.env, SERVICE_LAMBDA_ARN = module.service_lambda.function_arn }
  tags          = local.tags
}

resource "aws_lambda_event_source_mapping" "credit_check" {
  event_source_arn = module.sqs_credit_check.queue_arn
  function_name    = module.lambda_credit_check.function_arn
  batch_size       = 1
}

resource "aws_lambda_event_source_mapping" "notification" {
  event_source_arn = module.sqs_notification.queue_arn
  function_name    = module.lambda_notification.function_arn
  batch_size       = 1
}

resource "aws_lambda_event_source_mapping" "statement_gen" {
  event_source_arn = module.sqs_statement_gen.queue_arn
  function_name    = module.lambda_statement_gen.function_arn
  batch_size       = 1
}

resource "aws_lambda_event_source_mapping" "billing_lifecycle" {
  event_source_arn = module.sqs_billing_lifecycle.queue_arn
  function_name    = module.lambda_billing_lifecycle.function_arn
  batch_size       = 1
}

resource "aws_cloudwatch_event_rule" "billing_lifecycle_daily" {
  name                = "pixicred-${local.env}-billing-lifecycle-daily"
  description         = "Daily billing lifecycle sweep — auto-close and payment reminders"
  schedule_expression = "cron(0 8 * * ? *)"
  tags                = local.tags
}

resource "aws_cloudwatch_event_target" "billing_lifecycle_daily" {
  rule      = aws_cloudwatch_event_rule.billing_lifecycle_daily.name
  target_id = "BillingLifecycleSqs"
  arn       = module.sqs_billing_lifecycle.queue_arn
  input     = jsonencode({ lookaheadDays = 7 })
}

resource "aws_sqs_queue_policy" "billing_lifecycle_eventbridge" {
  queue_url = module.sqs_billing_lifecycle.queue_url
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "events.amazonaws.com" }
      Action    = "sqs:SendMessage"
      Resource  = module.sqs_billing_lifecycle.queue_arn
      Condition = {
        ArnEquals = { "aws:SourceArn" = aws_cloudwatch_event_rule.billing_lifecycle_daily.arn }
      }
    }]
  })
}

resource "aws_cloudwatch_event_rule" "stmt_weekly" {
  name                = "pixicred-${local.env}-stmt-weekly"
  description         = "Weekly statement generation"
  schedule_expression = "cron(0 0 ? * MON *)"
  tags                = local.tags
}

resource "aws_cloudwatch_event_target" "stmt_weekly" {
  rule      = aws_cloudwatch_event_rule.stmt_weekly.name
  target_id = "StatementGenWeeklySqs"
  arn       = module.sqs_statement_gen.queue_arn
  input     = jsonencode({ period = "weekly" })
}

resource "aws_cloudwatch_event_rule" "stmt_monthly" {
  name                = "pixicred-${local.env}-stmt-monthly"
  description         = "Monthly statement generation"
  schedule_expression = "cron(0 0 1 * ? *)"
  tags                = local.tags
}

resource "aws_cloudwatch_event_target" "stmt_monthly" {
  rule      = aws_cloudwatch_event_rule.stmt_monthly.name
  target_id = "StatementGenMonthlySqs"
  arn       = module.sqs_statement_gen.queue_arn
  input     = jsonencode({ period = "monthly" })
}

resource "aws_sqs_queue_policy" "statement_gen_eventbridge" {
  queue_url = module.sqs_statement_gen.queue_url
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "events.amazonaws.com" }
      Action    = "sqs:SendMessage"
      Resource  = module.sqs_statement_gen.queue_arn
      Condition = {
        ArnLike = {
          "aws:SourceArn" = [
            aws_cloudwatch_event_rule.stmt_weekly.arn,
            aws_cloudwatch_event_rule.stmt_monthly.arn,
          ]
        }
      }
    }]
  })
}

module "api_gateway" {
  source              = "../../modules/api-gateway"
  name                = "pixicred-${local.env}-api"
  domain_name         = "api.pixicred.com"
  acm_certificate_arn = data.aws_ssm_parameter.acm_certificate_arn.value
  tags                = local.tags

  integrations = {
    applications = {
      lambda_arn = module.api_applications.function_arn
      invoke_arn = module.api_applications.invoke_arn
      routes = [
        { method = "POST", path = "/applications" },
        { method = "GET",  path = "/applications/{applicationId}" },
      ]
    }
    accounts = {
      lambda_arn = module.api_accounts.function_arn
      invoke_arn = module.api_accounts.invoke_arn
      routes = [
        { method = "GET",    path = "/accounts/{accountId}" },
        { method = "DELETE", path = "/accounts/{accountId}" },
      ]
    }
    transactions = {
      lambda_arn = module.api_transactions.function_arn
      invoke_arn = module.api_transactions.invoke_arn
      routes = [
        { method = "POST", path = "/accounts/{accountId}/transactions" },
        { method = "GET",  path = "/accounts/{accountId}/transactions" },
      ]
    }
    payments = {
      lambda_arn = module.api_payments.function_arn
      invoke_arn = module.api_payments.invoke_arn
      routes = [
        { method = "POST", path = "/accounts/{accountId}/payments" },
      ]
    }
    statements = {
      lambda_arn = module.api_statements.function_arn
      invoke_arn = module.api_statements.invoke_arn
      routes = [
        { method = "GET",  path = "/accounts/{accountId}/statements" },
        { method = "GET",  path = "/accounts/{accountId}/statements/{statementId}" },
        { method = "POST", path = "/accounts/{accountId}/statements" },
      ]
    }
    notifications = {
      lambda_arn = module.api_notifications.function_arn
      invoke_arn = module.api_notifications.invoke_arn
      routes = [
        { method = "GET",   path = "/accounts/{accountId}/notifications" },
        { method = "PATCH", path = "/accounts/{accountId}/notifications" },
      ]
    }
    auth = {
      lambda_arn = module.api_auth.function_arn
      invoke_arn = module.api_auth.invoke_arn
      routes = [
        { method = "POST", path = "/auth/register" },
        { method = "POST", path = "/auth/login" },
      ]
    }
    admin = {
      lambda_arn = module.api_admin.function_arn
      invoke_arn = module.api_admin.invoke_arn
      routes = [
        { method = "POST", path = "/admin/billing-lifecycle" },
      ]
    }
  }
}

module "frontend" {
  source              = "../../modules/frontend"
  env                 = local.env
  acm_certificate_arn = data.aws_ssm_parameter.acm_certificate_arn.value
  hosted_zone_id      = local.hosted_zone_id
  tags                = local.tags
}

module "dns" {
  source                     = "../../modules/dns"
  hosted_zone_id             = local.hosted_zone_id
  api_subdomain              = "api.pixicred.com"
  create_apex_records        = true
  cloudfront_domain_name     = module.frontend.cloudfront_domain_name
  cloudfront_hosted_zone_id  = module.frontend.cloudfront_hosted_zone_id
  api_gateway_domain_name    = module.api_gateway.domain_name_target
  api_gateway_hosted_zone_id = module.api_gateway.domain_name_hosted_zone_id
  tags                       = local.tags
}

# ── Secrets Manager ───────────────────────────────────────────────────────

resource "aws_secretsmanager_secret" "app_secrets" {
  name        = "pixicred-${local.env}-secrets"
  description = "Runtime secrets for PixiCred ${local.env} — DATABASE_URL_POOLER, DATABASE_URL_DIRECT, JWT_SECRET"
  tags        = local.tags
}

# ── CloudWatch alerts SNS topic ───────────────────────────────────────────

resource "aws_sns_topic" "alerts" {
  name = "pixicred-${local.env}-alerts"
  tags = local.tags
}

# ── CloudWatch alarms: DLQ depth ─────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "dlq_credit_check" {
  alarm_name          = "pixicred-${local.env}-dlq-credit-check-depth"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Messages in credit-check DLQ"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  tags                = local.tags

  dimensions = {
    QueueName = split(":", module.sqs_credit_check.dlq_arn)[5]
  }
}

resource "aws_cloudwatch_metric_alarm" "dlq_notification" {
  alarm_name          = "pixicred-${local.env}-dlq-notification-depth"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Messages in notification DLQ"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  tags                = local.tags

  dimensions = {
    QueueName = split(":", module.sqs_notification.dlq_arn)[5]
  }
}

resource "aws_cloudwatch_metric_alarm" "dlq_statement_gen" {
  alarm_name          = "pixicred-${local.env}-dlq-statement-gen-depth"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Messages in statement-gen DLQ"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  tags                = local.tags

  dimensions = {
    QueueName = split(":", module.sqs_statement_gen.dlq_arn)[5]
  }
}

resource "aws_cloudwatch_metric_alarm" "dlq_billing_lifecycle" {
  alarm_name          = "pixicred-${local.env}-dlq-billing-lifecycle-depth"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Messages in billing-lifecycle DLQ"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  tags                = local.tags

  dimensions = {
    QueueName = split(":", module.sqs_billing_lifecycle.dlq_arn)[5]
  }
}

# ── CloudWatch alarms: Lambda errors ─────────────────────────────────────

locals {
  monitored_lambdas = {
    service           = module.service_lambda.function_name
    credit_check      = module.lambda_credit_check.function_name
    notification      = module.lambda_notification.function_name
    statement_gen     = module.lambda_statement_gen.function_name
    billing_lifecycle = module.lambda_billing_lifecycle.function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each            = local.monitored_lambdas
  alarm_name          = "pixicred-${local.env}-lambda-errors-${each.key}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 5
  alarm_description   = "Lambda error rate > 5 in 5 minutes for ${each.value}"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  tags                = local.tags

  dimensions = {
    FunctionName = each.value
  }
}
