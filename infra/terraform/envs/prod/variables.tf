variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "prod"
}

variable "lambda_s3_bucket" {
  description = "S3 bucket where CI/CD uploads Lambda zip packages"
  type        = string
  default     = "pixicred-prod-lambda-packages"
}

variable "aws_profile" {
  description = "AWS CLI profile for local development. Set to empty string in CI where credentials are injected via OIDC environment variables."
  type        = string
  default     = "rmw-llc"
}
