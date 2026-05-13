output "api_endpoint" {
  value       = aws_apigatewayv2_api.this.api_endpoint
  description = "Default API Gateway endpoint URL"
}

output "domain_name_target" {
  value       = aws_apigatewayv2_domain_name.this.domain_name_configuration[0].target_domain_name
  description = "Target domain name for the Route 53 alias record"
}

output "domain_name_hosted_zone_id" {
  value       = aws_apigatewayv2_domain_name.this.domain_name_configuration[0].hosted_zone_id
  description = "Hosted zone ID for the Route 53 alias record"
}
