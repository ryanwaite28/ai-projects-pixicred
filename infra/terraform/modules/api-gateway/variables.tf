variable "name" {
  type        = string
  description = "API Gateway name"
}

variable "integrations" {
  type = map(object({
    lambda_arn = string
    invoke_arn = string
    routes     = list(object({ method = string, path = string }))
  }))
  description = "Map of integration name to Lambda ARN + routes"
}

variable "domain_name" {
  type        = string
  description = "Custom domain for the API (e.g. api.pixicred.com)"
}

variable "acm_certificate_arn" {
  type        = string
  description = "ACM certificate ARN for the custom domain (must be in same region)"
}

variable "tags" {
  type        = map(string)
  description = "Resource tags"
  default     = {}
}
