variable "function_name" {
  type        = string
  description = "Lambda function name"
}

variable "handler" {
  type        = string
  description = "Handler entry point (e.g. index.handler)"
  default     = "index.handler"
}

variable "memory_size" {
  type        = number
  description = "Lambda memory in MB"
  default     = 256
}

variable "timeout" {
  type        = number
  description = "Lambda timeout in seconds"
  default     = 30
}

variable "environment" {
  type        = map(string)
  description = "Environment variables for the Lambda function"
  default     = {}
}

variable "policy_json" {
  type        = string
  description = "IAM policy document JSON for the Lambda execution role"
}

variable "s3_bucket" {
  type        = string
  description = "S3 bucket containing the Lambda package"
}

variable "s3_key" {
  type        = string
  description = "S3 key for the Lambda package zip"
}

variable "tags" {
  type        = map(string)
  description = "Resource tags"
  default     = {}
}
