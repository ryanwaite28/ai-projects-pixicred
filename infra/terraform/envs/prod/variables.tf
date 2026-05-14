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
