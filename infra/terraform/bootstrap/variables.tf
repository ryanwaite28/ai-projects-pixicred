variable "environment" {
  description = "Deployment environment"
  type        = string

  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "environment must be 'dev' or 'prod'."
  }
}

variable "aws_profile" {
  description = "AWS CLI profile for local development. Set to empty string in CI where credentials are injected via OIDC environment variables."
  type        = string
  default     = "rmw-llc"
}
