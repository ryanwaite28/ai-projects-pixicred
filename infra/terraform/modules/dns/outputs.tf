output "apex_record_fqdn" {
  value       = aws_route53_record.apex.fqdn
  description = "FQDN of the apex A record"
}

output "api_record_fqdn" {
  value       = aws_route53_record.api.fqdn
  description = "FQDN of the API A record"
}
