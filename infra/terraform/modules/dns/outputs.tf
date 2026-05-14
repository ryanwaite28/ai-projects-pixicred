output "apex_record_fqdn" {
  value       = var.create_apex_records ? aws_route53_record.apex[0].fqdn : null
  description = "FQDN of the apex A record (null when create_apex_records = false)"
}

output "api_record_fqdn" {
  value       = aws_route53_record.api.fqdn
  description = "FQDN of the API A record"
}
