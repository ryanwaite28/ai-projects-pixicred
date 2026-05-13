variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "dev"
}

variable "vpc_id" {
  description = "VPC ID for RDS security group"
  type        = string
}

variable "subnet_ids" {
  description = "Subnet IDs for RDS subnet group (at least two AZs)"
  type        = list(string)
}

variable "db_password" {
  description = "RDS master password — stored in Secrets Manager; never used by the application at runtime"
  type        = string
  sensitive   = true
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN (us-east-1) for CloudFront and API Gateway custom domains"
  type        = string
}

variable "lambda_s3_bucket" {
  description = "S3 bucket where CI/CD uploads Lambda zip packages"
  type        = string
  default     = "pixicred-dev-lambda-packages"
}
