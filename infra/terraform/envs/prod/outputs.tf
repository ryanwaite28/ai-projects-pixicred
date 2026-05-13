output "api_endpoint" {
  value       = module.api_gateway.api_endpoint
  description = "API Gateway default endpoint"
}

output "frontend_url" {
  value       = "https://pixicred.com"
  description = "Frontend URL"
}

output "cloudfront_domain_name" {
  value       = module.frontend.cloudfront_domain_name
  description = "CloudFront distribution domain name"
}

output "cloudfront_distribution_id" {
  value       = module.frontend.cloudfront_distribution_id
  description = "CloudFront distribution ID (used by CI for cache invalidation)"
}
