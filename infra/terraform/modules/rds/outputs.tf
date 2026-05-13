output "endpoint" {
  value       = aws_db_instance.this.endpoint
  description = "RDS endpoint (host:port)"
}

output "port" {
  value       = aws_db_instance.this.port
  description = "RDS port"
}

output "db_name" {
  value       = aws_db_instance.this.db_name
  description = "Database name"
}

output "db_resource_id" {
  value       = aws_db_instance.this.resource_id
  description = "RDS resource ID — used in iam:rds-db:connect ARN for IAM database authentication"
}
