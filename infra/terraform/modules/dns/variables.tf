variable "hosted_zone_id" {
  type        = string
  description = "Route 53 hosted zone ID for pixicred.com"
}

variable "cloudfront_domain_name" {
  type        = string
  description = "CloudFront distribution domain name"
}

variable "cloudfront_hosted_zone_id" {
  type        = string
  description = "CloudFront hosted zone ID"
}

variable "api_gateway_domain_name" {
  type        = string
  description = "API Gateway regional custom domain name target"
}

variable "api_gateway_hosted_zone_id" {
  type        = string
  description = "API Gateway hosted zone ID"
}

variable "tags" {
  type        = map(string)
  description = "Resource tags"
  default     = {}
}
