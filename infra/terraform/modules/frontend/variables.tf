variable "env" {
  type        = string
  description = "Environment name (dev or prod)"
}

variable "acm_certificate_arn" {
  type        = string
  description = "ACM certificate ARN in us-east-1 (required for CloudFront)"
}

variable "hosted_zone_id" {
  type        = string
  description = "Route 53 hosted zone ID for pixicred.com"
}

variable "tags" {
  type        = map(string)
  description = "Resource tags"
  default     = {}
}
